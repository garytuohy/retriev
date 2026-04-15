/**
 * Retriev — Waitlist API
 * POST /api/waitlist — adds email to KV, sends welcome email via Resend
 *
 * Wire up: Set RESEND_API_KEY via `wrangler secret put RESEND_API_KEY`
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

export async function handleWaitlist(request, env) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return corsResponse();
  }

  if (request.method !== 'POST') {
    return jsonError('Method Not Allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { email, name } = body;

  if (!email) {
    return jsonError('Email is required', 400);
  }

  if (!isValidEmail(email)) {
    return jsonError('Invalid email address', 400);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  // Check for duplicate
  const existing = await env.KV.get(`waitlist:${normalizedEmail}`);
  if (existing) {
    return jsonResponse({
      success: true,
      message: "You're already on the list! We'll be in touch soon.",
    });
  }

  // Store in KV
  await env.KV.put(
    `waitlist:${normalizedEmail}`,
    JSON.stringify({ email: normalizedEmail, name: name || '', joinedAt: now }),
    { expirationTtl: 60 * 60 * 24 * 365 * 2 } // 2 years
  );

  // Increment counter
  const countRaw = await env.KV.get('waitlist:count');
  const count = parseInt(countRaw || '0', 10) + 1;
  await env.KV.put('waitlist:count', String(count));

  // Send welcome email via Resend
  let emailSent = false;
  if (env.RESEND_API_KEY) {
    emailSent = await sendWelcomeEmail(normalizedEmail, name, env);
  }

  console.log(`Waitlist signup: ${normalizedEmail} (total: ${count}, email sent: ${emailSent})`);

  return jsonResponse({
    success: true,
    message: "You're on the list! Check your inbox for a welcome email.",
    position: count,
  });
}

async function sendWelcomeEmail(email, name, env) {
  const firstName = name ? name.split(' ')[0] : 'there';

  const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Welcome to Retriev</title></head>
<body style="margin:0;padding:0;background:#080a0f;font-family:Inter,-apple-system,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="font-size:24px;font-weight:800;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:32px;">
      Retriev
    </div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
      <h1 style="font-size:28px;font-weight:800;color:#ffffff;margin:0 0 16px;letter-spacing:-1px;">
        You're in, ${firstName}! 🎉
      </h1>
      <p style="font-size:16px;color:rgba(255,255,255,0.65);line-height:1.7;margin:0 0 24px;">
        Welcome to Retriev. You've secured your spot on the early access list — we'll reach out personally when your account is ready.
      </p>
      <p style="font-size:16px;color:rgba(255,255,255,0.65);line-height:1.7;margin:0 0 32px;">
        In the meantime: the average Retriev customer recovers <strong style="color:#ffffff">$2,800/month</strong> in previously lost revenue within their first 30 days. We can't wait to show you what's possible.
      </p>
      <a href="https://retriev.pages.dev" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
        Visit Retriev →
      </a>
    </div>
    <p style="font-size:13px;color:rgba(255,255,255,0.3);margin-top:24px;text-align:center;">
      You're receiving this because you signed up at retriev.pages.dev.<br>
      <a href="#" style="color:rgba(255,255,255,0.4);">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Retriev <onboarding@resend.dev>',
        to: [email],
        subject: "You're on the Retriev early access list 🎉",
        html: emailHtml,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to send welcome email:', err);
    return false;
  }
}

// ── UTIL HELPERS ──

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, status);
}
