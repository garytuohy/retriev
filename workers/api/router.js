/**
 * Retriev — API Router
 * Entry point for Cloudflare Worker
 */

import { handleWebhook } from './webhook.js';
import { handleAuth } from './auth.js';
import { handleWaitlist } from './waitlist.js';
import { handleStripe } from './stripe.js';
import { processRetryQueue } from './dunning.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Route requests
    if (path === '/api/webhook') return handleWebhook(request, env);
    if (path.startsWith('/api/auth')) return handleAuth(request, env, path);
    if (path === '/api/waitlist') return handleWaitlist(request, env);
    if (path.startsWith('/api/stripe')) return handleStripe(request, env, path);

    // Health check
    if (path === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Admin: list waitlist (remove in production)
    if (path === '/api/admin/waitlist') {
      const count = await env.KV.get('waitlist:count');
      const keys = await env.KV.list({ prefix: 'waitlist:' });
      const entries = await Promise.all(
        keys.keys
          .filter(k => k.name !== 'waitlist:count')
          .map(async k => {
            const data = await env.KV.get(k.name);
            try {
              return JSON.parse(data);
            } catch {
              return { email: k.name.replace('waitlist:', ''), raw: data };
            }
          })
      );
      return new Response(JSON.stringify({ count, total: entries.length, emails: entries.map(e => e.email) }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  /**
   * Scheduled handler — runs daily via Cloudflare Cron
   * Processes failed payment recovery queue
   */
  async scheduled(event, env, ctx) {
    console.log('Dunning cron triggered:', new Date().toISOString());
    console.log('Event:', event);

    // Process retry queue
    const result = await processRetryQueue(env);

    console.log('Dunning cron complete:', result);
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
