# Retriev — AI-Powered Failed Payment Recovery SaaS

> Stop losing revenue to failed payments. Retriev uses AI to automatically detect, recover, and prevent failed payments.

**Live URL:** https://retriev.pages.dev  
**Custom domain:** https://retriev.thatsguy.com (via CNAME)

---

## What's Built

### Frontend (`public/`)
Static HTML/CSS/JS — no build step. Deploy directly to Cloudflare Pages.

| File | Description |
|------|-------------|
| `index.html` | Landing page — dark SaaS aesthetic, hero, pricing, testimonials, FAQ |
| `dashboard.html` | Full dark dashboard with Chart.js recovery rate chart, metrics cards, payments table |
| `login.html` | Auth login page — clean dark form with Google/GitHub SSO buttons |
| `signup.html` | Auth signup page — split layout with pitch + form |
| `pricing.html` | Detailed pricing page with comparison table, billing toggle (monthly/annual), FAQ |

**Design System:**
- Background: `#080a0f`
- Primary: `#6366f1` (indigo)
- Accent: `#8b5cf6` (purple)
- Font: Inter from Bunny Fonts CDN
- Chart.js from jsDelivr CDN

### Backend Workers (`workers/`)
Cloudflare Workers — edge-deployed API. Entry point: `api/router.js`

| File | Routes | Description |
|------|--------|-------------|
| `api/router.js` | All routes | Central router |
| `api/webhook.js` | `POST /api/webhook` | Stripe webhook handler — verifies signature, queues recovery |
| `api/auth.js` | `POST /api/auth/signup`, `/login`, `/logout`, `GET /api/auth/me` | Full auth with KV sessions, PBKDF2 password hashing |
| `api/waitlist.js` | `POST /api/waitlist` | Stores email in KV, sends welcome email via Resend |

### Email Templates (`emails/`)
HTML email templates for dunning sequences.

| File | Trigger | Subject |
|------|---------|---------|
| `welcome.html` | Account created | "Welcome to Retriev 🎉" |
| `dunning-1.html` | Day 1 after failed payment | "Your payment didn't go through" |
| `dunning-2.html` | Day 3 — second attempt | "We're trying again" |
| `dunning-3.html` | Day 7 — final attempt | "Final attempt — action required" |

Templates use `{{handlebars-style}}` variables: `{{firstName}}`, `{{amount}}`, `{{merchantName}}`, `{{updatePaymentUrl}}`, `{{nextRetryDate}}`, `{{deadline}}`, `{{unsubscribeUrl}}`.

---

## Environment Variables to Wire Up

Set these via `wrangler secret put` before deploying the worker:

```bash
# Required: Stripe webhook signature verification
wrangler secret put STRIPE_WEBHOOK_SECRET

# Required: Making Stripe API calls (refunds, metadata, etc.)
wrangler secret put STRIPE_SECRET_KEY

# Required: Sending dunning/welcome emails via Resend
wrangler secret put RESEND_API_KEY

# Required: Signing session tokens
wrangler secret put SESSION_SECRET
```

### KV Namespace
Create and configure the KV namespace for sessions, waitlist, and recovery queue:

```bash
# Create namespace
wrangler kv:namespace create "RETRIEV_KV"

# Paste the returned ID into workers/wrangler.toml:
# [[kv_namespaces]]
# binding = "KV"
# id = "YOUR_ID_HERE"
```

---

## Deploy Commands

### Frontend (Cloudflare Pages)
```bash
npx wrangler pages deploy public/ \
  --project-name=retriev \
  --branch=main
```
> Note: Set `CLOUDFLARE_API_TOKEN` env var or run `wrangler login` first.

### Workers API
```bash
cd workers/
wrangler deploy
```

---

## What to Wire Up in the Morning

### Priority 1 — Make it functional
- [ ] **Create Stripe account** → Get `STRIPE_WEBHOOK_SECRET` + `STRIPE_SECRET_KEY`
- [ ] **Create Resend account** at resend.com → Get `RESEND_API_KEY`, verify domain
- [ ] **Create KV namespace** (`wrangler kv:namespace create "RETRIEV_KV"`) → paste ID in `wrangler.toml`
- [ ] **Set all secrets** via `wrangler secret put`
- [ ] **Deploy worker** to Cloudflare → `wrangler deploy` from `workers/`
- [ ] **Add Stripe webhook** in Stripe dashboard pointing to `https://your-worker.workers.dev/api/webhook`

### Priority 2 — Make it real
- [ ] **Custom email domain** in Resend — update `from` in `waitlist.js` from `hello@retriev.pages.dev` to your actual domain
- [ ] **Update Resend sender** in `waitlist.js` once domain verified
- [ ] **Wire auth redirect** in `login.html` / `signup.html` to call `/api/auth/login` and `/api/auth/signup` for real
- [ ] **Connect dashboard to live data** — replace mock data in `dashboard.html` with API calls

### Priority 3 — Growth
- [ ] Add Stripe Connect OAuth flow for merchants to connect their Stripe
- [ ] Implement the actual dunning email scheduler (Cloudflare Cron Triggers)
- [ ] Set up Cloudflare Analytics to track conversions
- [ ] Hook up Google/GitHub OAuth (use a provider like Clerk or Auth.js)

---

## Project Structure

```
retriev/
├── public/              # Static frontend → Cloudflare Pages
│   ├── index.html       # Landing page
│   ├── dashboard.html   # App dashboard
│   ├── login.html       # Login
│   ├── signup.html      # Signup
│   └── pricing.html     # Pricing page
├── workers/             # Cloudflare Workers backend
│   ├── wrangler.toml    # Worker config (add KV namespace ID)
│   └── api/
│       ├── router.js    # Request router
│       ├── webhook.js   # Stripe webhooks
│       ├── auth.js      # Auth endpoints
│       └── waitlist.js  # Waitlist + welcome email
├── emails/              # HTML email templates
│   ├── welcome.html
│   ├── dunning-1.html   # Day 1 failed payment
│   ├── dunning-2.html   # Day 3 retry
│   └── dunning-3.html   # Day 7 final attempt
└── README.md
```

---

Built by Yurty · March 2025
