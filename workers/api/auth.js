/**
 * Retriev — Auth API
 * Endpoints: POST /api/auth/signup, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
 *
 * Uses Cloudflare KV for session storage.
 * Wire up: Set SESSION_SECRET via `wrangler secret put SESSION_SECRET`
 */

const SESSION_COOKIE = 'retriev_session';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days in seconds

export async function handleAuth(request, env, pathname) {
  const url = new URL(request.url);
  const path = pathname || url.pathname;

  if (request.method === 'POST' && path.endsWith('/signup')) {
    return handleSignup(request, env);
  }
  if (request.method === 'POST' && path.endsWith('/login')) {
    return handleLogin(request, env);
  }
  if (request.method === 'POST' && path.endsWith('/logout')) {
    return handleLogout(request, env);
  }
  if (request.method === 'GET' && path.endsWith('/me')) {
    return handleMe(request, env);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleSignup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { email, password, firstName, lastName, company } = body;

  if (!email || !password) {
    return jsonError('Email and password are required', 400);
  }

  if (!isValidEmail(email)) {
    return jsonError('Invalid email address', 400);
  }

  if (password.length < 8) {
    return jsonError('Password must be at least 8 characters', 400);
  }

  // Check if user already exists
  const existingUser = await env.KV.get(`user:email:${email.toLowerCase()}`);
  if (existingUser) {
    return jsonError('An account with this email already exists', 409);
  }

  // Hash password
  const passwordHash = await hashPassword(password);
  const userId = generateId();
  const now = new Date().toISOString();

  const user = {
    id: userId,
    email: email.toLowerCase(),
    passwordHash,
    firstName: firstName || '',
    lastName: lastName || '',
    company: company || '',
    plan: 'trial',
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
  };

  // Store user
  await env.KV.put(`user:${userId}`, JSON.stringify(user));
  await env.KV.put(`user:email:${email.toLowerCase()}`, userId);

  // Create session
  const sessionToken = await createSession(userId, env);

  // TODO: Send welcome email via Resend
  // await sendWelcomeEmail(email, firstName, env);

  return jsonResponse(
    {
      message: 'Account created successfully',
      user: sanitizeUser(user),
    },
    201,
    { 'Set-Cookie': buildSessionCookie(sessionToken) }
  );
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return jsonError('Email and password are required', 400);
  }

  // Look up user
  const userId = await env.KV.get(`user:email:${email.toLowerCase()}`);
  if (!userId) {
    return jsonError('Invalid email or password', 401);
  }

  const userRaw = await env.KV.get(`user:${userId}`);
  if (!userRaw) {
    return jsonError('Invalid email or password', 401);
  }

  const user = JSON.parse(userRaw);

  // Verify password
  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    return jsonError('Invalid email or password', 401);
  }

  // Create session
  const sessionToken = await createSession(userId, env);

  return jsonResponse(
    { message: 'Logged in successfully', user: sanitizeUser(user) },
    200,
    { 'Set-Cookie': buildSessionCookie(sessionToken) }
  );
}

async function handleLogout(request, env) {
  const sessionToken = getSessionToken(request);
  if (sessionToken) {
    await env.KV.delete(`session:${sessionToken}`);
  }

  return jsonResponse(
    { message: 'Logged out' },
    200,
    { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }
  );
}

async function handleMe(request, env) {
  const sessionToken = getSessionToken(request);
  if (!sessionToken) {
    return jsonError('Not authenticated', 401);
  }

  const sessionRaw = await env.KV.get(`session:${sessionToken}`);
  if (!sessionRaw) {
    return jsonError('Session expired or invalid', 401);
  }

  const session = JSON.parse(sessionRaw);
  const userRaw = await env.KV.get(`user:${session.userId}`);
  if (!userRaw) {
    return jsonError('User not found', 404);
  }

  const user = JSON.parse(userRaw);
  return jsonResponse({ user: sanitizeUser(user) });
}

// ── SESSION HELPERS ──

async function createSession(userId, env) {
  const token = generateId(48);
  const session = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL * 1000).toISOString(),
  };
  await env.KV.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return token;
}

function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

// ── CRYPTO HELPERS ──

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, storedHash] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256
  );
  const computedHash = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');

  return computedHash === storedHash;
}

function generateId(length = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, length);
}

// ── UTIL HELPERS ──

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, status);
}
