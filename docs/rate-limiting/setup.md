# Rate Limiting Setup Guide

This guide explains the rate limiting implementation using Upstash Redis for the signup and auth flows.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Setup Instructions](#setup-instructions)
- [How It Works](#how-it-works)
- [Configuration](#configuration)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)
- [Production Checklist](#production-checklist)
- [Additional Resources](#additional-resources)

---

## Overview

This application implements **multi-layer rate limiting** to protect auth endpoints from abuse, spam, and DDoS attacks. We use **Upstash Redis** because it's:

- **Serverless-first**: Perfect for Next.js and Vercel deployments
- **HTTP-based**: No persistent connections needed
- **Globally replicated**: Low latency worldwide
- **Cost-effective**: Pay-per-request pricing

---

## Architecture

### Rate Limiting Layers

```
User Request → API Route → Rate Limit Checks → Supabase Auth → Profile Creation
                              │
                              ├─ 1. Global Limit (100/min)
                              ├─ 2. IP Limit (3/15min)
                              └─ 3. Email Limit (5/hour)
```

### Components

1. **Upstash Redis Client** (`src/lib/upstash.ts`)
   - Singleton Redis connection
   - REST API based (HTTP)
   - Automatic TLS encryption

2. **Rate Limiting Utilities** (`src/lib/rate-limit.ts`)
   - Multiple rate limiters (IP, email, global)
   - Sliding window algorithm
   - Analytics tracking

3. **API Routes** (e.g. `src/app/api/auth/signup/route.ts`)
   - Handle auth requests
   - Enforce rate limits
   - Return proper HTTP status codes

4. **Database Migration** (Supabase)
   - Creates `profiles` table
   - Automatic trigger on user creation
   - Row Level Security policies

---

## Setup Instructions

### 1. Create Upstash Redis Database

1. Go to [Upstash Console](https://console.upstash.com/)
2. Click **"Create Database"**
3. Choose:
   - **Name**: `supabase-auth-ratelimit` (or any name)
   - **Type**: Regional or Global (Global recommended for production)
   - **Region**: Choose closest to your users
4. Click **"Create"**

### 2. Get API Credentials

After creating the database:

1. Click on your database name
2. Scroll to **"REST API"** section
3. Copy:
   - **UPSTASH_REDIS_REST_URL**
   - **UPSTASH_REDIS_REST_TOKEN**

### 3. Configure Environment Variables

Add to your `.env.local` file:

```bash
# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```

### 4. Apply Database Migration

The profiles table migration has already been applied. To verify:

```bash
# Check if profiles table exists
# Run this in Supabase SQL Editor or using Supabase CLI
SELECT * FROM public.profiles LIMIT 1;
```

### 5. Test the Setup

```bash
# Start development server
npm run dev

# Test signup endpoint
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}'
```

---

## How It Works

### 1. User Submits Signup Form

```typescript
// User fills out form in sign-up-form.tsx
{ email: "user@example.com", password: "SecurePass123!" }
```

### 2. Request Goes to API Route

```typescript
// POST /api/auth/signup
// - Validates input with Zod
// - Extracts client IP address
```

### 3. Rate Limit Checks (Multi-Layer)

#### Layer 1: Global Limit

- Protects entire system
- Limit: 100 signups per minute across all users
- Purpose: Prevent DDoS attacks

#### Layer 2: IP-Based Limit

- Protects per network
- Limit: 3 signups per 15 minutes per IP
- Purpose: Prevent brute force from single source

#### Layer 3: Email-Based Limit

- Protects per email
- Limit: 5 signups per hour per email
- Purpose: Prevent account enumeration

### 4. Sliding Window Algorithm

**Why Sliding Window?**

- More accurate than fixed window
- Prevents burst attacks at window boundaries
- Smooth rate limiting

**Example:**

```
Fixed Window (less secure):
09:00 - 10:00: 5 requests ✓
10:00 - 11:00: 5 requests ✓  ← User can spam 10 requests in 1 minute at boundary

Sliding Window (more secure):
Any 60-minute period can only have 5 requests
09:30 - 10:30: 5 requests ✓
User can't burst at boundaries
```

### 5. Redis Key Structure

```
ratelimit:signup:global:global         → Global counter
ratelimit:signup:ip:192.168.1.1        → IP-based counter
ratelimit:signup:email:user@email.com   → Email-based counter
```

Each key stores:

- Request count
- Timestamp of requests
- Automatic expiration (TTL)

### 6. Rate Limit Response

If **allowed**:

```json
{
  "success": true,
  "message": "Account created successfully",
  "user": { "id": "...", "email": "..." }
}
```

If **rate limited**:

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many signup attempts. Try again in 15 minutes.",
  "retryAfter": 900,
  "limit": 3,
  "remaining": 0
}
```

Headers returned:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 900
X-RateLimit-Limit: 3
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704672000000
```

---

## Configuration

### Adjusting Rate Limits

Edit `src/constants/rate-limit.ts` (or the limiters in `src/lib/rate-limit.ts` as applicable):

```typescript
// More strict (production)
export const ipRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(2, "30 m"), // 2 per 30 min
  analytics: true,
  prefix: "ratelimit:signup:ip:",
});

// More lenient (development)
export const ipRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "5 m"), // 10 per 5 min
  analytics: true,
  prefix: "ratelimit:signup:ip:",
});
```

### Rate Limit Strategies

**1. Sliding Window** (Current — Recommended)

```typescript
Ratelimit.slidingWindow(requests, window)
// Most accurate, prevents bursts
```

**2. Fixed Window**

```typescript
Ratelimit.fixedWindow(requests, window)
// Simpler, allows burst at boundaries
```

**3. Token Bucket**

```typescript
Ratelimit.tokenBucket(refillRate, interval, bucketSize)
// Allows controlled bursts
```

---

## Testing

### Test Rate Limiting Locally

#### 1. Test Normal Signup

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user1@example.com","password":"SecurePass123!"}'
```

Expected: `201 Created`

#### 2. Test Rate Limit (IP)

```bash
# Run this script to hit IP limit (3 attempts)
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"user$i@example.com\",\"password\":\"SecurePass123!\"}"
  echo "\n---\n"
done
```

Expected: First 3 succeed, then `429 Too Many Requests`

#### 3. Test Email Rate Limit

```bash
# Try same email multiple times
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"email":"same@example.com","password":"SecurePass123!"}'
  echo "\n---\n"
done
```

Expected: After 2nd attempt, `409 Conflict` (email exists)

#### 4. Check Rate Limit Info

```bash
curl http://localhost:3000/api/auth/signup
```

Returns current rate limit configuration.

### Automated Testing

Create a test script `scripts/test-rate-limit.ts`:

```typescript
async function testRateLimit() {
  console.log("Testing rate limiting...\n");

  // Test 1: Normal signup
  console.log("1. Testing normal signup");
  const res1 = await fetch("http://localhost:3000/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `test-${Date.now()}@example.com`,
      password: "SecurePass123!",
    }),
  });
  console.log("Status:", res1.status, res1.status === 201 ? "✓" : "✗");

  // Test 2: Hit rate limit
  console.log("\n2. Testing rate limit (attempting 5 signups)");
  for (let i = 0; i < 5; i++) {
    const res = await fetch("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test-${Date.now()}-${i}@example.com`,
        password: "SecurePass123!",
      }),
    });
    console.log(`Attempt ${i + 1}:`, res.status);

    if (res.status === 429) {
      const data = await res.json();
      console.log("Rate limited!", data.message);
      break;
    }
  }
}

testRateLimit();
```

---

## Monitoring

### View Rate Limit Stats in Upstash

1. Go to [Upstash Console](https://console.upstash.com/)
2. Click your database
3. Go to **"Data Browser"**
4. View keys: `ratelimit:signup:*`

### Check Redis Analytics

```typescript
// In your code
import { redis } from "@/lib/upstash";

// Get rate limit analytics
const analytics = await redis.get("ratelimit:analytics");
console.log(analytics);
```

### Monitor in Production

Add logging in your API route:

```typescript
// After rate limit check
console.log({
  timestamp: new Date().toISOString(),
  ip: clientIp,
  email: email,
  rateLimitResult: {
    allowed: rateLimitResult.allowed,
    limitType: rateLimitResult.limitType,
    remaining: rateLimitResult.remaining,
  },
});
```

Use tools like:

- **Vercel Analytics**
- **Sentry** (error tracking)
- **LogRocket** (session replay)

---

## Troubleshooting

### Issue: "UPSTASH_REDIS_REST_URL is not defined"

**Cause**: Environment variables not loaded

**Solution**:

```bash
# Make sure .env.local exists
cp .env.example .env.local

# Add your Upstash credentials
nano .env.local

# Restart dev server
npm run dev
```

### Issue: Rate limit not working

**Cause**: Redis connection failed

**Solution**:

```typescript
// Test Redis connection
import { testRedisConnection } from "@/lib/upstash";

const isConnected = await testRedisConnection();
console.log("Redis connected:", isConnected);
```

### Issue: "Too many requests" immediately

**Cause**: Redis keys not expiring or clock skew

**Solution**:

```bash
# Clear all rate limit keys in Upstash Console
# Data Browser → Delete keys matching "ratelimit:*"

# Or reset programmatically (if such helper exists)
import { resetRateLimit } from "@/lib/rate-limit";
await resetRateLimit("ip", "your-ip");
```

### Issue: Different rate limits in development

**Cause**: Local IP (127.0.0.1) used for all requests

**Solution**: Use different emails to test email-based limits, or add:

```typescript
// In route.ts, for testing only
const clientIp = request.headers.get("x-test-ip") || getClientIp(request);

// Then in curl
curl -H "x-test-ip: 1.2.3.4" ...
```

### Issue: Profile not created

**Cause**: Database trigger not firing

**Solution**:

```sql
-- Check trigger exists
SELECT * FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Check function exists
SELECT * FROM pg_proc WHERE proname = 'handle_new_user';

-- Manually create profile
INSERT INTO public.profiles (id, email)
VALUES ('user-uuid', 'user@example.com');
```

---

## Security Best Practices

### 1. Don't Expose Internal Details

```typescript
// BAD
throw new Error(`Rate limited: ${internalDetails}`);

// GOOD
throw new Error("Too many attempts. Please try again later.");
```

### 2. Log Rate Limit Events

```typescript
if (!rateLimitResult.allowed) {
  console.warn("Rate limit triggered", {
    ip: clientIp,
    email: email,
    limitType: rateLimitResult.limitType,
  });
}
```

### 3. Use HTTPS in Production

- Upstash URLs are always HTTPS
- Ensure your app is also HTTPS (Vercel does this automatically)

### 4. Fail Open on Redis Errors

```typescript
// If Redis is down, allow request (availability > strict limiting)
catch (error) {
  console.error("Rate limit check failed:", error);
  return { allowed: true }; // Fail open
}
```

### 5. Rate Limit Other Endpoints

Apply the same pattern to:

- Login (`/api/auth/login`)
- Password reset (`/api/auth/forgot-password`)
- Email verification resend
- Any public API endpoints

---

## Production Checklist

- [ ] Upstash Redis database created
- [ ] Environment variables set in production (Vercel/hosting platform)
- [ ] Rate limits configured appropriately
- [ ] Monitoring and alerting set up
- [ ] Error tracking configured (Sentry)
- [ ] Test rate limiting in staging environment
- [ ] Document rate limits in API docs
- [ ] Set up alerts for high rate limit hit rates
- [ ] Review logs regularly for abuse patterns

---

## Additional Resources

- [Upstash Documentation](https://docs.upstash.com/)
- [@upstash/ratelimit GitHub](https://github.com/upstash/ratelimit)
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)

---

## Support

If you encounter issues:

1. Check [Troubleshooting](#troubleshooting) section
2. Review Upstash Console for errors
3. Check Supabase logs
4. Open an issue on GitHub

---

**Last Updated**: 2026-03-18
