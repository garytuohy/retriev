/**
 * Retriev — Dunning Email Sender
 * Sends payment recovery emails via Resend
 * 
 * Used by:
 * - webhook.js on payment failure
 * - Scheduled handler for retry attempts
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

// Email templates stored in KV or fallback inline
const DUNNING_SUBJECTS = {
  1: "Hey {firstName}, your payment didn't go through",
  2: "Quick reminder about your payment",
  3: "Final notice — your subscription is at risk",
};

/**
 * Send a dunning email
 * @param {Object} params
 * @param {string} params.email - Customer email
 * @param {string} params.firstName - Customer first name
 * @param {number} params.day - Dunning day (1, 3, or 7)
 * @param {Object} params.failureData - Payment failure details
 * @param {Object} env - Cloudflare Worker env
 */
export async function sendDunningEmail({ email, firstName, day, failureData }, env) {
  const templateHtml = await getDunningTemplate(day, env);
  
  // Template variables
  const vars = {
    firstName: firstName || 'there',
    amount: formatAmount(failureData.amount, failureData.currency),
    cardBrand: failureData.cardBrand || 'card',
    cardLast4: failureData.cardLast4 || '****',
    failureReason: formatFailureReason(failureData.failureCode),
    nextRetryDate: failureData.nextRetryAt 
      ? formatDate(failureData.nextRetryAt)
      : '24 hours',
    merchantName: 'Retriev', // TODO: Make dynamic for multi-tenant
    updatePaymentUrl: `${env.APP_URL || 'https://retriev.pages.dev'}/dashboard.html?update_payment=true`,
    unsubscribeUrl: `${env.APP_URL || 'https://retriev.pages.dev'}/unsubscribe?email=${encodeURIComponent(email)}`,
  };

  const html = interpolateTemplate(templateHtml, vars);
  const subject = interpolateTemplate(DUNNING_SUBJECTS[day] || DUNNING_SUBJECTS[1], vars);

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Retriev <payments@retriev.pages.dev>',
        to: [email],
        subject,
        html,
        headers: {
          'X-Entity-ID': failureData.paymentIntentId || failureData.invoiceId,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend dunning error:', err);
      return { success: false, error: err };
    }

    const result = await res.json();
    console.log(`Dunning email sent (day ${day}) to ${email}:`, result.id);
    return { success: true, id: result.id };
  } catch (err) {
    console.error('Failed to send dunning email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get dunning template HTML
 * Priority: KV storage → fallback inline
 */
async function getDunningTemplate(day, env) {
  // Try KV first
  const kvTemplate = await env.KV.get(`email:template:dunning-${day}`);
  if (kvTemplate) {
    return kvTemplate;
  }

  // Fallback inline templates
  return INLINE_DUNNING_TEMPLATES[day] || INLINE_DUNNING_TEMPLATES[1];
}

/**
 * Process failed payments scheduled for retry
 * Called by Cloudflare Cron
 */
export async function processRetryQueue(env) {
  const today = new Date().toISOString().split('T')[0];
  const queueKey = `recovery_queue:${today}`;
  
  const queueRaw = await env.KV.get(queueKey);
  if (!queueRaw) {
    console.log('No recovery queue for today');
    return { processed: 0 };
  }

  const queue = JSON.parse(queueRaw);
  let processed = 0;
  let recovered = 0;
  let escalated = 0;

  for (const paymentIntentId of queue) {
    const recordRaw = await env.KV.get(`failed_payment:${paymentIntentId}`);
    if (!recordRaw) continue;

    const record = JSON.parse(recordRaw);

    // Skip already recovered
    if (record.status === 'recovered') {
      continue;
    }

    // Check if it's time to retry
    if (record.nextRetryAt && new Date(record.nextRetryAt) > new Date()) {
      continue;
    }

    // Increment retry count
    record.retryCount = (record.retryCount || 0) + 1;

    // Determine dunning day based on retry count
    let dunningDay;
    if (record.retryCount === 1) dunningDay = 1;
    else if (record.retryCount === 2) dunningDay = 3;
    else if (record.retryCount >= 3) dunningDay = 7;

    // Get customer email from Stripe
    const customerData = await getCustomerFromStripe(record.customerId, env);
    if (!customerData) {
      console.warn(`No customer data for ${record.customerId}`);
      continue;
    }

    // Send dunning email
    await sendDunningEmail({
      email: customerData.email,
      firstName: customerData.firstName,
      day: dunningDay,
      failureData: {
        ...record,
        cardBrand: customerData.cardBrand,
        cardLast4: customerData.cardLast4,
      },
    }, env);

    // Calculate next retry
    record.nextRetryAt = calculateNextRetry(record.failureCode, record.retryCount);
    record.lastRetryAt = new Date().toISOString();

    // Update record
    if (record.retryCount >= 3) {
      record.status = 'escalated';
      escalated++;
    }

    await env.KV.put(`failed_payment:${paymentIntentId}`, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 30,
    });

    processed++;
  }

  console.log(`Retry queue processed: ${processed} attempts, ${escalated} escalated`);
  return { processed, recovered, escalated };
}

/**
 * Get customer data from Stripe
 */
async function getCustomerFromStripe(customerId, env) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      },
    });

    if (!res.ok) return null;

    const customer = await res.json();
    
    // Get default payment method
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
 * Calculate next retry date based on failure code and attempt count
 */
function calculateNextRetry(failureCode, attemptCount) {
  // Progressive delays
  const delays = {
    1: 24 * 60 * 60 * 1000,         // 1 day
    2: 3 * 24 * 60 * 60 * 1000,    // 3 days
    3: 7 * 24 * 60 * 60 * 1000,    // 7 days
  };

  const delay = delays[Math.min(attemptCount, 3)] || delays[3];
  return new Date(Date.now() + delay).toISOString();
}

// ── UTILS ──

function formatAmount(amount, currency = 'usd') {
  const val = amount / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(val);
}

function formatFailureReason(code) {
  const reasons = {
    'card_declined': 'Your card was declined by the bank',
    'insufficient_funds': 'Insufficient funds available',
    'expired_card': 'Your card has expired',
    'do_not_honor': 'The bank declined the transaction',
    'processing_error': 'A temporary processing error occurred',
    'incorrect_cvc': 'The security code was incorrect',
    'card_velocity_exceeded': 'Too many attempts in a short time',
  };
  return reasons[code] || 'The payment could not be processed';
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  });
}

function interpolateTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

// Inline fallback templates
const INLINE_DUNNING_TEMPLATES = {
  1: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Payment Issue</title></head>
<body style="margin:0;padding:0;background-color:#080a0f;font-family:Inter,-apple-system,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:48px 24px;">
    <div style="font-size:22px;font-weight:800;color:#6366f1;margin-bottom:40px;">Retriev</div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden;">
      <div style="height:4px;background:linear-gradient(90deg,#f59e0b,#f97316);"></div>
      <div style="padding:48px 40px;">
        <div style="font-size:40px;margin-bottom:16px;">⚠️</div>
        <h1 style="font-size:26px;font-weight:800;color:#ffffff;margin:0 0 16px;">Hey {{firstName}}, your payment didn't go through</h1>
        <p style="font-size:16px;color:rgba(255,255,255,0.65);line-height:1.75;margin:0 0 20px;">
          We tried to charge <strong style="color:#ffffff;">{{amount}}</strong> but it was declined.
        </p>
        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:16px 20px;margin-bottom:32px;">
          <p style="font-size:14px;color:rgba(255,255,255,0.7);margin:0;"><strong style="color:#f59e0b;">Reason:</strong> {{failureReason}}</p>
        </div>
        <a href="{{updatePaymentUrl}}" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;">Update Payment Method →</a>
      </div>
    </div>
  </div>
</body>
</html>`,
  3: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Payment Reminder</title></head>
<body style="margin:0;padding:0;background-color:#080a0f;font-family:Inter,-apple-system,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:48px 24px;">
    <div style="font-size:22px;font-weight:800;color:#6366f1;margin-bottom:40px;">Retriev</div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden;">
      <div style="height:4px;background:linear-gradient(90deg,#f59e0b,#f97316);"></div>
      <div style="padding:48px 40px;">
        <h1 style="font-size:26px;font-weight:800;color:#ffffff;margin:0 0 16px;">Quick reminder about your payment</h1>
        <p style="font-size:16px;color:rgba(255,255,255,0.65);line-height:1.75;margin:0 0 32px;">
          Hey {{firstName}}, we're still having trouble with your payment. This is a friendly reminder to update your card when you get a chance.
        </p>
        <a href="{{updatePaymentUrl}}" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;">Update Payment Method →</a>
      </div>
    </div>
  </div>
</body>
</html>`,
  7: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Final Notice</title></head>
<body style="margin:0;padding:0;background-color:#080a0f;font-family:Inter,-apple-system,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:48px 24px;">
    <div style="font-size:22px;font-weight:800;color:#6366f1;margin-bottom:40px;">Retriev</div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(239,68,68,0.3);border-radius:16px;overflow:hidden;">
      <div style="height:4px;background:linear-gradient(90deg,#ef4444,#dc2626);"></div>
      <div style="padding:48px 40px;">
        <div style="font-size:40px;margin-bottom:16px;">🚨</div>
        <h1 style="font-size:26px;font-weight:800;color:#ffffff;margin:0 0 16px;">Final notice — your subscription is at risk</h1>
        <p style="font-size:16px;color:rgba(255,255,255,0.65);line-height:1.75;margin:0 0 32px;">
          Hey {{firstName}}, we've tried multiple times to process your payment without success. Please update your payment method within 48 hours to avoid service interruption.
        </p>
        <a href="{{updatePaymentUrl}}" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;">Update Payment Now →</a>
      </div>
    </div>
  </div>
</body>
</html>`,
};