# Quick Start Guide - Rate Limited Signup

Get your rate-limited signup running in 5 minutes!

## Prerequisites

- ✅ Node.js installed
- ✅ Supabase project (already configured)
- ⚠️ Upstash Redis account (need to create)

---

## Step 1: Create Upstash Redis Database (2 minutes)

1. Go to https://console.upstash.com/
2. Sign up/login (GitHub login is fastest)
3. Click **"Create Database"**
4. Configure:
   - **Name**: `auth-ratelimit`
   - **Type**: Regional (free) or Global ($)
   - **Region**: Choose closest to your users
5. Click **"Create"**

---

## Step 2: Get Redis Credentials (30 seconds)

1. Click on your new database
2. Scroll to **"REST API"** section
3. Copy both values:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

## Step 3: Update Environment Variables (30 seconds)

Edit `.env.local`:

```bash
# Replace these with your actual values
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```

---

## Step 4: Install Dependencies (if not done)

```bash
npm install
```

---

## Step 5: Start Development Server

```bash
npm run dev
```

---

## Step 6: Test It! 🎉

### Test 1: Normal Signup

Visit http://localhost:3000/auth/sign-up and create an account.

**Expected**: ✅ Success message, check email for confirmation

### Test 2: Rate Limiting (IP)

Try signing up 4 times quickly with different emails:

```bash
# Open terminal and run:
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test1@example.com","password":"SecurePass123!"}'

curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test2@example.com","password":"SecurePass123!"}'

curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test3@example.com","password":"SecurePass123!"}'

# This one should be blocked:
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test4@example.com","password":"SecurePass123!"}'
```

**Expected**: 
- First 3: ✅ 201 Created
- 4th: ❌ 429 Too Many Requests

### Test 3: Check Rate Limit Info

```bash
curl http://localhost:3000/api/auth/signup
```

**Expected**: JSON with rate limit configuration

---

## Verify Database

Check that profiles are created automatically:

1. Go to Supabase Dashboard
2. Open SQL Editor
3. Run:
   ```sql
   SELECT * FROM public.profiles;
   ```

**Expected**: See profiles for users you created

---

## Common Issues

### "UPSTASH_REDIS_REST_URL is not defined"

**Fix**: 
1. Check `.env.local` exists and has the variables
2. Restart dev server: `npm run dev`
3. Verify no typos in variable names

### "Rate limit not working"

**Fix**: 
1. Check Upstash console - is database active?
2. Test Redis connection:
   ```typescript
   import { testRedisConnection } from "@/lib/upstash";
   console.log(await testRedisConnection()); // Should log: true
   ```

### "Profile not created"

**Fix**: Database trigger is already applied. Verify:
```sql
SELECT * FROM information_schema.triggers 
WHERE trigger_name = 'on_auth_user_created';
```

---

## What's Next?

### For Development:
- Read [docs/rate-limiting/setup.md](docs/rate-limiting/setup.md) for detailed documentation
- Check [docs/implementation-summary.md](docs/implementation-summary.md) for code explanations
- Customize rate limits in `src/lib/rate-limit.ts`

### For Production:
1. Add environment variables to hosting platform (Vercel, etc.)
2. Choose Upstash Global database for better latency
3. Set up monitoring (Sentry, LogRocket)
4. Review security checklist in [docs/rate-limiting/setup.md](docs/rate-limiting/setup.md)

---

## Rate Limit Configuration

Current settings:

| Layer | Limit | Window | Purpose |
|-------|-------|--------|---------|
| IP | 3 requests | 15 minutes | Prevent brute force |
| Email | 5 requests | 1 hour | Prevent account enumeration |
| Global | 100 requests | 1 minute | Prevent DDoS |

To adjust, edit `src/lib/rate-limit.ts`

---

## Need Help?

- **Setup Issues**: Check [docs/rate-limiting/setup.md](docs/rate-limiting/setup.md) → Troubleshooting
- **Code Questions**: Read [docs/implementation-summary.md](docs/implementation-summary.md) → Code Explanations
- **Upstash Help**: https://docs.upstash.com/
- **Supabase Help**: https://supabase.com/docs

---

**That's it! You now have enterprise-grade rate limiting. 🚀**
