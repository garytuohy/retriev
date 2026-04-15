# Build Retriev — Full AI Payment Recovery SaaS

You are building **Retriev** — a complete AI-powered failed payment recovery SaaS. Build everything listed below in the current directory.

## Product
- Name: Retriev
- Tagline: "Recover failed payments before your customers even notice."
- Target: SaaS companies, subscription businesses
- Core value: AI-powered dunning — smart retry timing, personalised recovery emails, churn prediction

## Pricing
- Starter: $29/mo + 8% of recovered revenue (up to $5k recovered/mo)
- Growth: $99/mo + 5% of recovered revenue (up to $50k recovered/mo)
- Scale: $299/mo + 3% of recovered revenue (unlimited)

---

## FILE STRUCTURE TO CREATE

```
public/                  # Static landing page (Cloudflare Pages)
  index.html             # Main landing page
  login.html             # Login page
  signup.html            # Signup page
  onboarding.html        # 3-step onboarding
  dashboard.html         # Main dashboard
  analytics.html         # Analytics page
  settings.html          # Settings page
  css/
    app.css              # All styles
  js/
    app.js               # Shared utilities, auth, nav
    landing.js           # Landing page animations/form
    dashboard.js         # Dashboard charts/data
    analytics.js         # Analytics charts
worker/                  # Cloudflare Worker (API backend)
  src/
    index.ts             # Worker entry point with all routes
  package.json
  tsconfig.json
  wrangler.toml
README.md
_redirects
```

---

## DESIGN SYSTEM (use consistently everywhere)

Dark mode SaaS aesthetic — think Linear, Vercel, Resend.

CSS Variables:
```
--bg: #0a0a0b
--bg-2: #111113
--bg-3: #18181b
--border: #27272a
--border-2: #3f3f46
--text: #fafafa
--text-2: #a1a1aa
--text-3: #71717a
--accent: #6366f1
--accent-2: #8b5cf6
--accent-glow: rgba(99, 102, 241, 0.15)
--success: #10b981
--warning: #f59e0b
--danger: #ef4444
```

Use Inter font from Google Fonts. Glassmorphism cards with rgba(255,255,255,0.03) background, 1px border, border-radius 12px, backdrop-filter blur(10px).

---

## 1. LANDING PAGE (public/index.html)

Full beautiful landing page with these sections:

### Nav
- Logo: "Retriev" with lightning bolt
- Links: Features, How it Works, Pricing, FAQ
- CTAs: "Log in" (ghost button) and "Get Early Access" (primary button)
- Sticky with glassmorphism backdrop on scroll
- Mobile hamburger menu

### Hero
- Animated gradient background (indigo to violet to purple, slow moving)
- Big bold headline: "Stop Losing Revenue to Failed Payments"
- Subheadline: "Retriev uses AI to recover failed payments before your customers churn. Smart retry timing, personalised emails, real-time insights."
- Email waitlist form with "Get Early Access" button
- Social proof: "Join 500+ SaaS founders already recovering more revenue"
- Floating stat card: "$2.4M recovered this month"

### Problem Section
- Header: "Failed payments are silently killing your revenue"
- 3 stat cards: "4.7%" average failed payment rate, "$23B" lost annually, "63%" recoverable
- 3 pain points: Generic retry logic, Cold manual emails, No visibility into at-risk customers

### How It Works (3 steps)
1. Connect — Link Stripe in 2 minutes
2. Recover — AI finds optimal retry times + sends personalised emails
3. Grow — Watch revenue recover in real-time

### AI Features (4 glassmorphism cards)
1. Smart Retry Timing — AI analyses payment patterns
2. Personalised Recovery Emails — Dynamic templates adapt to customer history
3. Churn Prediction — Identify at-risk customers before payment fails
4. Real-time Analytics — See every dollar in one dashboard

### Social Proof (3 testimonials)
Avatars from https://ui-avatars.com/api/?name=NAME&background=6366f1&color=fff&size=64
1. Sarah Chen, Co-founder @ Loomly — "Retriev recovered $18k in the first month. The AI timing is genuinely spooky good."
2. Marcus Webb, CEO @ Flowstate — "We went from 67% recovery rate to 94% in 6 weeks. Switched from Churnkey and never looked back."
3. Priya Sharma, Founder @ Stackr — "Set it up in an afternoon. Recovered our first payment the same day. Zero-code, just works."

### Pricing (3 tiers, highlight Growth as "Most Popular")
Starter: $29/mo + 8% of recovered (up to $5k/mo)
Growth: $99/mo + 5% of recovered (up to $50k/mo) — MOST POPULAR
Scale: $299/mo + 3% of recovered (unlimited)

Note: "Only pay for results. Our % fee applies only to payments we successfully recover."

### FAQ (6 questions)
1. How does the AI retry timing work?
2. What payment processors do you support?
3. How long does setup take?
4. What happens if a payment can't be recovered?
5. Can I customise the recovery emails?
6. Is there a free trial?

### Final CTA + Footer

---

## 2. AUTH PAGES

### public/login.html
- Centered card, dark design
- Email + Password fields
- Sign in button
- Error handling
- On submit: POST /api/auth/login, store JWT in localStorage, redirect to /dashboard.html

### public/signup.html
- Name, Email, Password, Company fields
- On submit: POST /api/auth/signup, redirect to /onboarding.html

---

## 3. ONBOARDING (public/onboarding.html)

3-step wizard with progress indicator:

Step 1: Connect Stripe
- Show webhook URL: https://retriev-api.workers.dev/webhooks/stripe
- Stripe events to enable: payment_intent.payment_failed, invoice.payment_failed, customer.subscription.deleted

Step 2: Choose Plan (show 3 tiers, select one)

Step 3: Customise Email Templates
- 4 template cards (Day 1, Day 3, Day 7, Day 14)
- Tone selector: Professional, Friendly, Urgent
- Finish Setup → redirect to /dashboard.html

---

## 4. DASHBOARD (public/dashboard.html)

### Sidebar Nav
- Logo, nav items (Dashboard, Analytics, Settings), user info at bottom, logout

### Top Stats (4 cards)
1. $12,480 — Recovered this month (up 18%)
2. 87.3% — Recovery rate (up 4.2%)
3. 23 — Active sequences
4. $47,200 — Total recovered all time

### Recent Failed Payments Table
8 rows with: Customer, Amount, Failed Date, Status (Recovered/In Progress/Failed), View sequence button

### Recovery Sequences (3 active cards with progress bars)

### Charts (Chart.js from CDN https://cdn.jsdelivr.net/npm/chart.js)
1. Line chart: Revenue Recovered — last 30 days
2. Bar chart: Recovery Rate by Week — last 8 weeks

Auth check on load: if no JWT in localStorage, redirect to /login.html

---

## 5. ANALYTICS (public/analytics.html)

Same sidebar. Stats + Charts:
- Recovery Rate by Sequence Step: Day 1 (45%), Day 3 (72%), Day 7 (83%), Day 14 (89%)
- Best Retry Times: heatmap grid showing Tue/Wed/Thu 10am-2pm as hotspots
- Revenue Recovered Over Time: area chart, 90 days

AI Insights panel:
- "Your customers respond 2.3x better to emails sent Tuesday-Thursday between 10am-2pm"
- "3 customers are showing early churn signals"
- "Friendly tone emails are outperforming Professional by 18%"

---

## 6. SETTINGS (public/settings.html)

Same sidebar. 4 tabs:
1. Profile — Name, Email, Save
2. Plan & Billing — Current plan, usage, upgrade buttons
3. Email Templates — 4 template editors (subject, body, tone, preview)
4. Webhook — Display webhook URL, copy button, Stripe setup instructions

---

## 7. CLOUDFLARE WORKER (worker/)

### worker/wrangler.toml
```
name = "retriev-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "retriev-db"
database_id = "PLACEHOLDER_DB_ID"

[[kv_namespaces]]
binding = "SESSIONS"
id = "PLACEHOLDER_KV_ID"
```

### worker/package.json
```json
{
  "name": "retriev-api",
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "wrangler": "^3.0.0",
    "typescript": "^5.0.0"
  }
}
```

### worker/tsconfig.json
Standard Cloudflare Workers tsconfig.

### worker/src/index.ts
Complete Cloudflare Worker with:

**Auth routes:**
- POST /api/auth/signup — validate, hash password with SubtleCrypto SHA-256, store in D1, return JWT
- POST /api/auth/login — verify credentials, return JWT signed with JWT_SECRET env var
- POST /api/auth/logout — invalidate session

**Dashboard routes (require valid JWT in Authorization header):**
- GET /api/dashboard/stats — return JSON with recovered_month, recovery_rate, active_sequences, total_recovered
- GET /api/dashboard/payments — return array of mock failed payments
- GET /api/dashboard/sequences — return array of mock active sequences

**Webhook:**
- POST /webhooks/stripe — verify Stripe-Signature header against STRIPE_WEBHOOK_SECRET, parse event, for payment_intent.payment_failed events insert into D1 and create dunning sequence

**CORS:** All routes return proper CORS headers (allow origin *, allow methods GET POST OPTIONS, allow headers Content-Type Authorization)

**D1 Schema (as SQL comment at top of file):**
```sql
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, company TEXT, password_hash TEXT NOT NULL, plan TEXT DEFAULT 'starter', created_at INTEGER DEFAULT (unixepoch()));
CREATE TABLE failed_payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_email TEXT, customer_name TEXT, amount INTEGER, currency TEXT DEFAULT 'usd', stripe_payment_intent_id TEXT, status TEXT DEFAULT 'pending', failed_at INTEGER, created_at INTEGER DEFAULT (unixepoch()));
CREATE TABLE dunning_sequences (id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, user_id TEXT NOT NULL, step INTEGER DEFAULT 0, status TEXT DEFAULT 'active', next_retry_at INTEGER, recovered_at INTEGER, created_at INTEGER DEFAULT (unixepoch()));
CREATE TABLE email_logs (id TEXT PRIMARY KEY, sequence_id TEXT NOT NULL, template_name TEXT, sent_at INTEGER, opened_at INTEGER, clicked_at INTEGER);
```

**4 Email templates as TypeScript template literals** — beautiful HTML emails for Day 1 (soft), Day 3 (retry), Day 7 (urgent), Day 14 (final).

**Dunning logic** — after webhook creates a sequence, schedule retries at day 1, 3, 7, 14 intervals. Use a cron or Durable Object stub — for now just store next_retry_at timestamp in D1.

---

## 8. README.md

Full setup guide with:
- Project overview
- Env vars needed: RESEND_API_KEY, STRIPE_WEBHOOK_SECRET, JWT_SECRET
- D1 and KV setup commands
- Deployment steps
- What's not yet wired (Stripe real integration, actual Resend sending)

---

## 9. public/_redirects
```
/api/*  https://retriev-api.workers.dev/api/:splat  200
/webhooks/*  https://retriev-api.workers.dev/webhooks/:splat  200
```

---

## IMPORTANT
- All pages: same dark design system, consistent components
- Dashboard/analytics/settings: check JWT in localStorage on load, redirect to /login.html if missing
- Mock data should be realistic and varied
- Charts use Chart.js from CDN
- Inter font from Google Fonts
- Mobile responsive on all pages
- Include proper meta tags (og:title, description)
- Make it look like a real, impressive product

Build everything now. Create all files. Do not skip any section.
