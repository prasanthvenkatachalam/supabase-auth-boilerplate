# Quick Start Guide

Get this boilerplate running locally in about 10 minutes.

---

## Prerequisites

- **Node.js** v18 or higher
- **npm / yarn / pnpm / bun**
- A **Supabase** project — [create one free](https://supabase.com/)
- An **Upstash Redis** database — [create one free](https://console.upstash.com/) (used for rate limiting)

---

## Step 1 — Clone & Install

```bash
git clone https://github.com/your-username/supabase-auth-boilerplate.git
cd supabase-auth-boilerplate
npm install
```

---

## Step 2 — Create an Upstash Redis Database

Rate limiting requires a Redis database. Upstash is free for low-traffic usage.

1. Go to [https://console.upstash.com/](https://console.upstash.com/)
2. Sign up / log in (GitHub login is fastest)
3. Click **"Create Database"**
4. Configure:
   - **Name**: e.g. `auth-ratelimit`
   - **Type**: Regional (free) or Global (paid, lower latency worldwide)
   - **Region**: Choose the region closest to your users
5. Click **"Create"**
6. Open your new database → scroll to **"REST API"** section
7. Copy both values:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

## Step 3 — Configure Environment Variables

Create `.env.local` in the project root:

```bash
# ── Supabase ──────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# ── Upstash Redis (rate limiting) ─────────────────────────────
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here

# ── Cloudflare Turnstile (bot protection) ─────────────────────
# Leave blank to skip captcha during local development
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=your_site_key
CLOUDFLARE_TURNSTILE_SECRET_KEY=your_secret_key

# ── ZeptoMail (transactional email) ───────────────────────────
ZEPTOMAIL_URL=api.zeptomail.in/
ZEPTOMAIL_TOKEN=your_zeptomail_api_token
EMAIL_SENDER_ADDRESS=noreply@yourdomain.com
EMAIL_SENDER_NAME=Your App Name
```

> **Where to find Supabase keys**: Dashboard → Project Settings → API

> **Security**: Never commit `.env.local` to version control. It is already in `.gitignore`.

---

## Step 4 — Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Step 5 — Test It

### Normal signup
Visit `/auth/sign-up` and create an account → you should receive a confirmation email.

### Test rate limiting (IP limit)
Run these back-to-back from a terminal — the 4th should be blocked:

```bash
for i in 1 2 3 4; do
  curl -s -o /dev/null -w "Attempt $i: HTTP %{http_code}\n" \
    -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"test$i@example.com\",\"password\":\"SecurePass123!\"}"
done
```

Expected output:
```
Attempt 1: HTTP 200
Attempt 2: HTTP 200
Attempt 3: HTTP 200
Attempt 4: HTTP 429   ← rate limited
```

### Test forgot password
Visit `/auth/forgot-password` and submit your email — you should receive a reset email.

---

## For Production

1. Set all environment variables in your hosting platform (Vercel → Project Settings → Environment Variables).
2. Use an **Upstash Global** database for lower latency across regions.
3. Set up error tracking (e.g. [Sentry](https://sentry.io/)).
4. Review the [Rate Limiting Guide](rate-limiting.md) for limit tuning.

---

## Troubleshooting

### `UPSTASH_REDIS_REST_URL is not defined`
- Confirm `.env.local` exists and has the variable.
- Restart the dev server: `npm run dev`.

### Rate limiting not triggering
- Open your [Upstash Console](https://console.upstash.com/) → Data Browser → check for keys starting with `ratelimit:`.
- If no keys appear, the Redis connection has failed. Double-check `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

### Rate limit triggers immediately in development
All local requests share the IP `127.0.0.1`, so the IP counter fills up faster than in production. Use different emails to test the email-scoped limits, or temporarily raise `SIGNUP.IP.LIMIT` in `src/constants/rate-limit.ts`.

### Emails not arriving
- Check your ZeptoMail dashboard for delivery logs.
- Verify `EMAIL_SENDER_ADDRESS` is a verified sender in ZeptoMail.
- In development, check the server console — the email payload is logged if sending fails.

### Profile not created after signup
```sql
-- Verify the trigger exists in Supabase SQL Editor:
SELECT trigger_name FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';
```
If missing, see [database.md](database.md) for the migration.
