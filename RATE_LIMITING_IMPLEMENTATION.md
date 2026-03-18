# Rate Limiting Implementation Guide

## Overview

This project uses **multi-layer, server-side rate limiting** backed by Upstash Redis and `@upstash/ratelimit`.

### Design Principles

- **Defense in depth:** Every sensitive auth endpoint applies more than one limiter where relevant.
- **Fail-open for availability:** If Redis/rate-limit checks fail, requests are temporarily allowed and the error is logged.
- **Client transparency:** `429` responses include `Retry-After` and rate-limit metadata headers.
- **Enumeration resistance:** Auth flows involving email identities return generic responses when appropriate.
- **Normalization:** Email-based keys are normalized to `trim().toLowerCase()` before rate-limit checks.

---

## Algorithms Used

All configured limiters currently use:

- **Sliding Window** (`Ratelimit.slidingWindow`)  
  Good balance of fairness and abuse protection, with reduced edge-window burst behavior.

---

## Rate-Limited APIs and Limiter Types

| API Route | Limiter Scopes | Keying Strategy | Primary Abuse Mitigated |
|---|---|---|---|
| `POST /api/auth/signup` | Global + IP + Email | `global`, client IP, normalized email | signup spam, bot registration, account-targeted abuse |
| `POST /api/auth/forgot-password` | Global + IP + Email | `global`, client IP, normalized email | reset-spam, mailbox flooding, account probing |
| `POST /api/auth/resend-verification` | Global + IP + Email | `global`, client IP, normalized email | verification email spam |
| `POST /api/auth/reset-password` | Global + IP + Email | `global`, client IP, authenticated email | repeated password reset attempts |
| `POST /api/auth/update-password` | Global + IP + Email | `global`, client IP, recovered-session email | credential abuse on recovery/update flow |
| `GET /api/auth/verify-email` | Global + IP | `global`, client IP | token verification brute forcing |
| `GET /api/auth/verify-otp` | Global + IP | `global`, client IP | callback token/code spraying |
| `POST /api/auth/set-recovery-session` | Global + IP | `global`, client IP | repeated token/session establishment attempts |

> Note: Email scope is intentionally not used for token-only endpoints (e.g., `verify-email`, `verify-otp`) because request payloads do not include a trusted email identifier.

---

## Current Limits (Source of Truth)

Limits are defined in `src/constants/rate-limit.ts`.

### Signup
- IP: 3 / 15m
- Email: 5 / 1h
- Global: 100 / 1m

### Login (available in library)
- IP: 10 / 1m
- Email: 5 / 1m
- Global: 1000 / 1m

### Resend Verification
- IP: 10 / 1h
- Email: 3 / 1h
- Global: 100 / 1h

### Forgot Password
- IP: 3 / 15m
- Email: 5 / 1h
- Global: 100 / 1m

### Reset Password
- IP: 5 / 15m
- Email: 5 / 1h
- Global: 100 / 1m

### Verify Email
- IP: 30 / 1h
- Global: 2000 / 1h

### Verify OTP
- IP: 30 / 1h
- Global: 2000 / 1h

### Set Recovery Session
- IP: 20 / 15m
- Global: 1000 / 15m

---

## Response Contract for Rate-Limited Requests

When blocked, endpoints should return:

- **HTTP 429**
- Body fields:
  - `error`
  - `message`
  - `retryAfter` (seconds)
  - optional: `limit`, `remaining`
- Headers:
  - `Retry-After`
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset` (epoch ms)

---

## Operational Notes

- Rate limiting uses Upstash Redis credentials from environment variables.
- Redis access failure logs server-side errors and does not hard-block traffic.
- Prefixes are route-specific to avoid key collisions and ease observability.

---

## Security Review Notes Applied

1. Added rate limiting to previously unprotected auth verification/session-establishment endpoints.
2. Added strict OTP type allow-list validation for `verify-email` route before verification.
3. Standardized metadata headers for new 429 responses.
4. Normalized all email-based rate-limit identifiers (`trim().toLowerCase()`).

