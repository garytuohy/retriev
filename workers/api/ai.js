/**
 * Retriev — AI Engine
 * Real AI integration using Cloudflare AI Workers
 * 
 * Endpoints:
 * - POST /api/ai/generate-email — Generate personalized recovery email
 * - POST /api/ai/analyze-customer — Predict churn risk for a customer
 * - POST /api/ai/insights — Generate insights from dashboard data
 * - GET /api/ai/query — Natural language query for dashboard
 */

// Cloudflare AI bindings available: env.AI
// Models available: @cf/meta/llama-2-7b-chat-int8, @cf/mistral/mistral-7b-instruct-v0.1

export async function handleAI(request, env, pathname) {
  const url = new URL(request.url);
  const path = pathname || url.pathname;

  if (request.method === 'POST' && path.endsWith('/generate-email')) {
    return handleGenerateEmail(request, env);
  }
  if (request.method === 'POST' && path.endsWith('/analyze-customer')) {
    return handleAnalyzeCustomer(request, env);
  }
  if (request.method === 'POST' && path.endsWith('/insights')) {
    return handleInsights(request, env);
  }
  if (request.method === 'POST' && path.endsWith('/query')) {
    return handleNaturalQuery(request, env);
  }

  return new Response('Not Found', { status: 404 });
}

/**
 * Generate a personalized recovery email using AI
 * POST /api/ai/generate-email
 * Body: { customerName, amount, failureReason, daysSinceFailure, previousAttempts, tone }
 */
async function handleGenerateEmail(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { customerName, amount, failureReason, daysSinceFailure, previousAttempts = 0, tone = 'professional' } = body;

  if (!customerName || !amount) {
    return jsonError('customerName and amount are required', 400);
  }

  const toneGuidance = {
    professional: 'Use a professional, business-like tone. Be direct but polite.',
    friendly: 'Use a warm, friendly tone. Be helpful and understanding.',
    urgent: 'Use an urgent tone for final attempts. Emphasize time sensitivity.'
  };

  const prompt = `You are an AI assistant for Retriev, a payment recovery service. Write a personalized email to help recover a failed payment.

Customer: ${customerName}
Amount: $${amount}
Failure reason: ${failureReason || 'Card declined'}
Days since failure: ${daysSinceFailure || 1}
Previous attempts: ${previousAttempts}

${toneGuidance[tone] || toneGuidance.professional}

Requirements:
- Keep it under 150 words
- Include a clear call-to-action to update payment method
- Don't mention this is AI-generated
- Make it feel personal and human
- Subject line should be concise

Respond in JSON format:
{
  "subject": "...",
  "body": "..."
}`;

  try {
    // Use Cloudflare AI Workers
    const response = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.1', {
      prompt,
      max_tokens: 300,
      temperature: 0.7,
    });

    let email;
    try {
      // Try to parse as JSON
      const text = response.response || response;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        email = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback if AI doesn't return valid JSON
        email = {
          subject: `Payment update needed for your subscription`,
          body: `Hi ${customerName},\n\nWe noticed your recent payment of $${amount} didn't go through. This can happen when cards expire or have temporary issues.\n\nPlease take a moment to update your payment method to keep your subscription active.\n\nUpdate payment: {{updatePaymentUrl}}\n\nLet us know if you have any questions.\n\nThanks,\nThe Team`
        };
      }
    } catch (parseError) {
      // Fallback email
      email = {
        subject: `Payment update needed for your subscription`,
        body: `Hi ${customerName},\n\nWe noticed your recent payment of $${amount} didn't go through.\n\nPlease update your payment method: {{updatePaymentUrl}}\n\nThanks!`
      };
    }

    return jsonResponse({
      success: true,
      email,
      model: 'mistral-7b-instruct',
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('AI generation error:', error);
    
    // Fallback to template if AI fails
    return jsonResponse({
      success: true,
      email: {
        subject: `Payment update needed`,
        body: `Hi ${customerName},\n\nYour payment of $${amount} didn't go through. Please update your payment method.\n\nUpdate: {{updatePaymentUrl}}\n\nThanks!`
      },
      fallback: true,
      error: error.message
    });
  }
}

/**
 * Analyze customer churn risk using AI
 * POST /api/ai/analyze-customer
 * Body: { customerId, paymentHistory, failedPayments, subscriptionValue, daysActive }
 */
async function handleAnalyzeCustomer(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { customerId, paymentHistory = [], failedPayments = 0, subscriptionValue = 0, daysActive = 0 } = body;

  if (!customerId) {
    return jsonError('customerId is required', 400);
  }

  // Calculate risk factors
  const failedRate = paymentHistory.length > 0 ? failedPayments / paymentHistory.length : 0;
  const avgPaymentValue = paymentHistory.length > 0 
    ? paymentHistory.reduce((a, b) => a + b, 0) / paymentHistory.length 
    : subscriptionValue;

  // Risk scoring algorithm
  let riskScore = 0;
  const signals = [];

  if (failedPayments >= 2) {
    riskScore += 30;
    signals.push('Multiple failed payments');
  }
  if (failedRate > 0.2) {
    riskScore += 25;
    signals.push('High failure rate');
  }
  if (subscriptionValue > 100) {
    riskScore += 10; // Higher value = more to lose
    signals.push('High-value subscription');
  }
  if (daysActive < 30) {
    riskScore += 15;
    signals.push('New customer');
  }
  if (daysActive > 180) {
    riskScore -= 10; // Loyal customer
    signals.push('Long-term customer');
  }

  riskScore = Math.min(100, Math.max(0, riskScore));

  const riskLevel = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low';

  // Generate AI explanation
  const prompt = `Analyze this customer's churn risk and provide a brief explanation:

Customer ID: ${customerId}
Failed payments: ${failedPayments}
Payment history length: ${paymentHistory.length}
Failure rate: ${(failedRate * 100).toFixed(1)}%
Subscription value: $${subscriptionValue}/mo
Days active: ${daysActive}
Risk score: ${riskScore}/100

Provide a 1-2 sentence explanation of the risk and one specific recommendation.`;

  let aiInsight = '';
  try {
    if (env.AI) {
      const response = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.1', {
        prompt,
        max_tokens: 100,
        temperature: 0.5,
      });
      aiInsight = response.response || response;
    }
  } catch (e) {
    aiInsight = '';
  }

  return jsonResponse({
    customerId,
    riskScore,
    riskLevel,
    signals,
    recommendation: aiInsight || 'Monitor this customer closely and consider proactive outreach.',
    analyzedAt: new Date().toISOString()
  });
}

/**
 * Generate AI insights from dashboard data
 * POST /api/ai/insights
 * Body: { stats: { recovered, rate, sequences, total }, trends: [...] }
 */
async function handleInsights(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { stats, trends = [] } = body;
  
  // Build insights from data patterns
  const insights = [];

  // Revenue insight
  if (stats?.recovered > 10000) {
    insights.push({
      type: 'positive',
      icon: 'trending-up',
      title: 'Strong recovery this month',
      detail: `$${(stats.recovered / 1000).toFixed(1)}K recovered. Keep current sequences running.`
    });
  }

  // Rate insight
  if (stats?.rate < 0.6) {
    insights.push({
      type: 'warning',
      icon: 'alert',
      title: 'Recovery rate below target',
      detail: `Current rate: ${(stats.rate * 100).toFixed(1)}%. Consider adjusting email timing.`
    });
  } else if (stats?.rate > 0.7) {
    insights.push({
      type: 'positive',
      icon: 'check',
      title: 'Above-average recovery rate',
      detail: `${(stats.rate * 100).toFixed(1)}% recovery. Your sequences are performing well.`
    });
  }

  // Generate AI narrative
  const prompt = `Generate 3 brief, actionable insights for a SaaS payment recovery dashboard:

Stats: ${JSON.stringify(stats)}
Recent trend: ${trends.slice(-7).join(', ')}

Format each as:
- type: positive/warning/negative
- title: short title
- detail: one sentence explanation

Respond in JSON array format.`;

  let aiInsights = [];
  try {
    if (env.AI) {
      const response = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.1', {
        prompt,
        max_tokens: 200,
        temperature: 0.6,
      });
      
      const text = response.response || response;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        aiInsights = JSON.parse(jsonMatch[0]);
      }
    }
  } catch (e) {
    // Use fallback insights
  }

  const finalInsights = aiInsights.length > 0 ? aiInsights : insights;

  return jsonResponse({
    insights: finalInsights,
    generatedAt: new Date().toISOString(),
    model: env.AI ? 'mistral-7b-instruct' : 'rule-based'
  });
}

/**
 * Natural language query for dashboard
 * POST /api/ai/query
 * Body: { query: "show me customers who haven't paid in 30 days" }
 */
async function handleNaturalQuery(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { query } = body;

  if (!query) {
    return jsonError('query is required', 400);
  }

  // Parse intent from natural language
  const queryLower = query.toLowerCase();
  
  let intent = 'unknown';
  let filters = {};
  let sqlQuery = null;

  // Intent detection
  if (queryLower.includes('at-risk') || queryLower.includes('churn')) {
    intent = 'at-risk-customers';
    sqlQuery = `SELECT * FROM failed_payments WHERE status = 'recovering' ORDER BY failed_at DESC LIMIT 20`;
  } else if (queryLower.includes('recovered') || queryLower.includes('revenue')) {
    intent = 'recovery-stats';
    sqlQuery = `SELECT SUM(amount) as total FROM failed_payments WHERE status = 'recovered'`;
  } else if (queryLower.includes('failed') && queryLower.includes('payment')) {
    intent = 'failed-payments';
    sqlQuery = `SELECT * FROM failed_payments WHERE status = 'pending' ORDER BY failed_at DESC LIMIT 20`;
  } else if (queryLower.includes('active') || queryLower.includes('sequence')) {
    intent = 'active-sequences';
    sqlQuery = `SELECT * FROM dunning_sequences WHERE status = 'active'`;
  }

  // Use AI to parse complex queries if available
  if (intent === 'unknown' && env.AI) {
    try {
      const response = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.1', {
        prompt: `Parse this natural language query for a payment recovery dashboard:

Query: "${query}"

Available data: failed_payments (id, customer_email, amount, status, failed_at), dunning_sequences (id, payment_id, step, status)

Respond in JSON format:
{
  "intent": "description of what user wants",
  "filters": { "field": "value" },
  "sql": "SQL query to run"
}`,
        max_tokens: 150,
        temperature: 0.3,
      });

      const text = response.response || response;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        intent = parsed.intent || 'custom';
        filters = parsed.filters || {};
        sqlQuery = parsed.sql;
      }
    } catch (e) {
      // Fallback to unknown
    }
  }

  return jsonResponse({
    query,
    intent,
    filters,
    sqlQuery,
    canExecute: sqlQuery !== null,
    message: intent === 'unknown' 
      ? 'Could not understand query. Try: "show failed payments", "at-risk customers", or "recovery stats"'
      : `Ready to fetch ${intent.replace('-', ' ')}`,
    parsedAt: new Date().toISOString()
  });
}

// Helper functions
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, status);
}