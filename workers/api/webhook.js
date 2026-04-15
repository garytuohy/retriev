/**
 * Retriev — Stripe Webhook Handler
 * Handles: payment_intent.payment_failed, invoice.payment_failed,
 *          customer.subscription.deleted, payment_intent.succeeded
 *
 * Wire up: Set STRIPE_WEBHOOK_SECRET via `wrangler secret put STRIPE_WEBHOOK_SECRET`
 * Stripe dashboard → Webhooks → Add endpoint → https://your-worker.workers.dev/api/webhook
 */

import { sendDunningEmail } from './dunning.js';

const RELEVANT_EVENTS = new Set([
  'payment_intent.payment_failed',
  'payment_intent.succeeded',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'invoice.payment_action_required',
  'customer.subscription.deleted',
  'customer.subscription.updated',
]);

export async function handleWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const rawBody = await request.text();

  // Verify Stripe webhook signature
  let event;
  try {
    event = await verifyStripeWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Ignore events we don't care about
  if (!RELEVANT_EVENTS.has(event.type)) {
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`Processing event: ${event.type} [${event.id}]`);

  try {
    switch (event.type) {
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object, env);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object, env);
        break;

      case 'payment_intent.succeeded':
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object, env);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object, env);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`Error processing event ${event.type}:`, err);
    // Return 200 so Stripe doesn't retry — log to your error tracker instead
    return new Response(JSON.stringify({ received: true, error: err.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle a failed PaymentIntent
 */
async function handlePaymentFailed(paymentIntent, env) {
  const { id, customer, amount, currency, last_payment_error } = paymentIntent;

  const failureRecord = {
    paymentIntentId: id,
    customerId: customer,
    amount,
    currency,
    failureCode: last_payment_error?.code,
    failureMessage: last_payment_error?.message,
    failedAt: new Date().toISOString(),
    status: 'pending_recovery',
    retryCount: 0,
    nextRetryAt: calculateNextRetry(last_payment_error?.code),
  };

  // Store in KV for recovery queue
  await env.KV.put(
    `failed_payment:${id}`,
    JSON.stringify(failureRecord),
    { expirationTtl: 60 * 60 * 24 * 30 } // 30 days
  );

  // Add to recovery queue
  const queueKey = `recovery_queue:${new Date().toISOString().split('T')[0]}`;
  const existingQueue = JSON.parse(await env.KV.get(queueKey) || '[]');
  existingQueue.push(id);
  await env.KV.put(queueKey, JSON.stringify(existingQueue), { expirationTtl: 60 * 60 * 24 * 31 });

  console.log(`Queued recovery for PaymentIntent ${id}, customer ${customer}`);

  // Send Day 1 dunning email
  const customerData = await getCustomerData(customer, env);
  if (customerData?.email) {
    await sendDunningEmail({
      email: customerData.email,
      firstName: customerData.firstName,
      day: 1,
      failureData: {
        ...failureRecord,
        cardBrand: customerData.cardBrand,
        cardLast4: customerData.cardLast4,
      },
    }, env);
  }
}

/**
 * Handle a failed Invoice (subscription payment)
 */
async function handleInvoicePaymentFailed(invoice, env) {
  const { id, customer, subscription, amount_due, currency, attempt_count } = invoice;

  const failureRecord = {
    invoiceId: id,
    customerId: customer,
    subscriptionId: subscription,
    amount: amount_due,
    currency,
    attemptCount: attempt_count,
    failedAt: new Date().toISOString(),
    status: 'pending_recovery',
  };

  await env.KV.put(
    `failed_invoice:${id}`,
    JSON.stringify(failureRecord),
    { expirationTtl: 60 * 60 * 24 * 30 }
  );

  console.log(`Queued invoice recovery for invoice ${id}, attempt ${attempt_count}`);
}

/**
 * Handle successful payment — mark as recovered
 */
async function handlePaymentSucceeded(payment, env) {
  const piId = payment.payment_intent || payment.id;
  const existing = await env.KV.get(`failed_payment:${piId}`);

  if (existing) {
    const record = JSON.parse(existing);
    record.status = 'recovered';
    record.recoveredAt = new Date().toISOString();
    await env.KV.put(`failed_payment:${piId}`, JSON.stringify(record));
    console.log(`Marked payment ${piId} as recovered`);
  }
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionDeleted(subscription, env) {
  const { id, customer } = subscription;
  await env.KV.put(
    `churned:${customer}`,
    JSON.stringify({ subscriptionId: id, churnedAt: new Date().toISOString() }),
    { expirationTtl: 60 * 60 * 24 * 365 }
  );
  console.log(`Marked customer ${customer} as churned`);
}

/**
 * Calculate smart retry timing based on failure code
 * In production: use ML model to predict optimal retry window
 */
function calculateNextRetry(failureCode) {
  const retryDelays = {
    'card_declined': 24 * 60 * 60 * 1000,         // 24 hours
    'insufficient_funds': 3 * 24 * 60 * 60 * 1000, // 3 days (wait for payday)
    'expired_card': 0,                              // Immediate — needs card update
    'do_not_honor': 48 * 60 * 60 * 1000,           // 48 hours
    'processing_error': 4 * 60 * 60 * 1000,        // 4 hours
  };

  const delay = retryDelays[failureCode] || 24 * 60 * 60 * 1000;
  return new Date(Date.now() + delay).toISOString();
}

/**
 * Get customer data from Stripe
 */
async function getCustomerData(customerId, env) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
    });

    if (!res.ok) return null;

    const customer = await res.json();

    // Get default payment method card info
    let cardBrand = null;
    let cardLast4 = null;

    if (customer.invoice_settings?.default_payment_method) {
      const pmRes = await fetch(`https://api.stripe.com/v1/payment_methods/${customer.invoice_settings.default_payment_method}`, {
        headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
      });

      if (pmRes.ok) {
        const pm = await pmRes.json();
        cardBrand = pm.card?.brand;
        cardLast4 = pm.card?.last4;
      }
    }

    return {
      email: customer.email,
      firstName: customer.name?.split(' ')[0] || null,
      cardBrand,
      cardLast4,
    };
  } catch (err) {
    console.error('Failed to fetch customer:', err);
    return null;
  }
}

/**
 * Verify Stripe webhook signature using Web Crypto API
 * Compatible with Cloudflare Workers
 */
async function verifyStripeWebhook(payload, signature, secret) {
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const expectedSig = parts['v1'];

  if (!timestamp || !expectedSig) {
    throw new Error('Invalid signature format');
  }

  // Check timestamp tolerance (5 minutes)
  const tolerance = 5 * 60;
  const webhookTimestamp = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - webhookTimestamp) > tolerance) {
    throw new Error('Timestamp outside tolerance window');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computed !== expectedSig) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(payload);
}
