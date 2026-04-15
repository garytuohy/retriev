/**
 * Retriev — Stripe Connect Integration
 * Handles OAuth flow for connecting merchant Stripe accounts
 * 
 * Endpoints:
 * - GET /api/stripe/connect - Redirect to Stripe OAuth
 * - GET /api/stripe/callback - Handle OAuth callback
 * - GET /api/stripe/status - Check if user has connected Stripe
 */

const STRIPE_CLIENT_ID = 'ca_NfR9ytfacXbB1Vti5tGVCChbNfzaEWkd0AyyPq2u4fb6e020'; // Placeholder - replace with your Stripe Connect client ID
const STRIPE_AUTHORIZE_URL = 'https://connect.stripe.com/oauth/authorize';
const STRIPE_TOKEN_URL = 'https://connect.stripe.com/oauth/token';

export async function handleStripe(request, env, pathname) {
  const url = new URL(request.url);
  const path = pathname || url.pathname;

  if (path === '/api/stripe/connect' && request.method === 'GET') {
    return handleConnect(request, env);
  }
  
  if (path === '/api/stripe/callback' && request.method === 'GET') {
    return handleCallback(request, env);
  }
  
  if (path === '/api/stripe/status' && request.method === 'GET') {
    return handleStatus(request, env);
  }

  return jsonResponse({ error: 'Not Found' }, 404);
}

/**
 * Initiate Stripe Connect OAuth flow
 * User clicks "Connect with Stripe" → redirects here → redirects to Stripe
 */
async function handleConnect(request, env) {
  // Get user from session
  const sessionToken = getSessionFromRequest(request);
  if (!sessionToken) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const userId = await env.KV.get(`session:${sessionToken}`);
  if (!userId) {
    return jsonResponse({ error: 'Session expired' }, 401);
  }

  // Generate state for CSRF protection
  const state = generateId();
  await env.KV.put(`stripe_state:${state}`, userId, { expirationTtl: 600 }); // 10 min

  // Build Stripe OAuth URL
  const redirectUri = `${env.APP_URL || 'https://retriev.pages.dev'}/api/stripe/callback`;
  const stripeUrl = `${STRIPE_AUTHORIZE_URL}?response_type=code&client_id=${STRIPE_CLIENT_ID}&scope=read_write&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  return Response.redirect(stripeUrl, 302);
}

/**
 * Handle callback from Stripe OAuth
 * Exchanges code for credentials, stores in user record
 */
async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle errors
  if (error) {
    const errorDesc = url.searchParams.get('error_description') || error;
    return redirectWithError(env, `Stripe connection failed: ${errorDesc}`);
  }

  if (!code || !state) {
    return redirectWithError(env, 'Invalid callback - missing parameters');
  }

  // Verify state
  const userId = await env.KV.get(`stripe_state:${state}`);
  if (!userId) {
    return redirectWithError(env, 'Invalid state - please try again');
  }

  // Clean up state
  await env.KV.delete(`stripe_state:${state}`);

  // Exchange code for token
  try {
    const tokenResponse = await fetch(STRIPE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_secret: env.STRIPE_SECRET_KEY,
      }).toString(),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error('Stripe token error:', tokens.error);
      return redirectWithError(env, 'Failed to connect Stripe account');
    }

    // Get user and update with Stripe credentials
    const userStr = await env.KV.get(`user:${userId}`);
    if (!userStr) {
      return redirectWithError(env, 'User not found');
    }

    const user = JSON.parse(userStr);
    user.stripeUserId = tokens.stripe_user_id;
    user.stripeConnectedAt = new Date().toISOString();
    user.stripePublicKey = tokens.stripe_publishable_key;
    
    // Store refresh token securely
    await env.KV.put(`stripe_refresh:${tokens.stripe_user_id}`, tokens.refresh_token, { expirationTtl: 60 * 60 * 24 * 365 }); // 1 year
    
    // Store access token (shorter lived)
    if (tokens.access_token) {
      await env.KV.put(`stripe_access:${tokens.stripe_user_id}`, tokens.access_token, { expirationTtl: 60 * 60 * 24 * 30 }); // 30 days
    }

    await env.KV.put(`user:${userId}`, JSON.stringify(user));

    // Redirect to onboarding success or dashboard
    const appUrl = env.APP_URL || 'https://retriev.pages.dev';
    return Response.redirect(`${appUrl}/dashboard.html?stripe=connected`, 302);

  } catch (err) {
    console.error('Stripe callback error:', err);
    return redirectWithError(env, 'Connection failed - please try again');
  }
}

/**
 * Check if user has connected their Stripe account
 */
async function handleStatus(request, env) {
  const sessionToken = getSessionFromRequest(request);
  if (!sessionToken) {
    return jsonResponse({ connected: false }, 200);
  }

  const userId = await env.KV.get(`session:${sessionToken}`);
  if (!userId) {
    return jsonResponse({ connected: false }, 200);
  }

  const userStr = await env.KV.get(`user:${userId}`);
  if (!userStr) {
    return jsonResponse({ connected: false }, 200);
  }

  const user = JSON.parse(userStr);
  
  return jsonResponse({
    connected: !!user.stripeUserId,
    connectedAt: user.stripeConnectedAt || null,
  });
}

// ── HELPERS ──

function getSessionFromRequest(request) {
  // Check Authorization header
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  
  // Check cookie
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/retriev_session=([^;]+)/);
  if (match) {
    return match[1];
  }
  
  return null;
}

function redirectWithError(env, message) {
  const appUrl = env.APP_URL || 'https://retriev.pages.dev';
  return Response.redirect(`${appUrl}/onboarding.html?error=${encodeURIComponent(message)}`, 302);
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

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(36).padStart(2, '0'))
    .join('');
}