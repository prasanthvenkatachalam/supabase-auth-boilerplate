## Overview

This project uses **multi-layer, server-side rate limiting** backed by Upstash Redis and `@upstash/ratelimit`.

### Design Principles

- **Defense in depth:** Every sensitive auth endpoint applies more than one limiter where relevant.
- **Fail-open for availability:** If Redis/rate-limit checks fail, requests are temporarily allowed and the error is logged.
- **Client transparency:** `429` responses include `Retry-After` and rate-limit metadata headers.
- **Enumeration resistance:** Auth flows involving email identities return generic responses when appropriate.
- **Normalization:** Email-based keys are normalized to `trim().toLowerCase()` before rate-limit checks; IP-based keys should also be normalized (see [IP address extraction](#ip-address-extraction-for-ip-based-rate-limiting) below) so that rate-limit key generation and checks are consistent and spoof-resistant.

### IP address extraction for IP-based rate limiting

IP-based rate limiting depends on a stable, spoof-resistant client identifier. This fits under **Defense in depth** (IP is one of several scopes) and **Normalization** (keys must be comparable and not trivially forged). The following describes a recommended approach; the current code uses a subset (see inline notes).

- **Header inspection order:** Prefer, in order: (1) `X-Forwarded-For` — use the **leftmost** (original client) IP when the request is known to come from a trusted proxy (see below); (2) `X-Real-IP`; (3) `CF-Connecting-IP` (when behind Cloudflare); (4) fallback to the TCP remote address (e.g. `request.socket.remoteAddress` or platform-equivalent) when no forwarded header is present or trusted. *Current code:* routes use `X-Forwarded-For` (first IP) then `X-Real-IP`, then `127.0.0.1`; they do not yet check `CF-Connecting-IP` or the connection remote address.
- **Trusted proxies / CDNs:** Only accept forwarded headers when the **direct** connection (e.g. the TCP peer or the last hop) is from a configured set of proxy/CDN CIDRs. If the request is not from a trusted proxy, ignore or reject `X-Forwarded-For` / `X-Real-IP` and use the connection remote address (or a safe default) for rate-limit keying. Configuration should list the CIDR ranges of your reverse proxy, load balancer, or CDN (e.g. Vercel, Cloudflare, AWS). *Current code:* no trusted-proxy list; forwarded headers are always used when present, which is acceptable only if the app is always behind a single trusted edge that overwrites or appends these headers.
- **IPv6 normalization:** Normalize the chosen IP string before using it as a rate-limit key: use **canonical form** (e.g. lowercase for hex digits), **strip zone identifiers** (e.g. `%eth0`), and **collapse IPv4-mapped IPv6 addresses** (e.g. `::ffff:192.0.2.1` → `192.0.2.1`) so that the same client is not counted under two different keys. *Current code:* no IPv6 normalization is applied.
- **Anti-spoofing:** Validate that the **source** of the request (direct connection / last hop) is in the trusted proxy list before trusting any forwarding header; if not, do not use forwarded headers for rate limiting. Reject or ignore suspicious or mismatched forwarding (e.g. multiple hops that don’t match expected topology), and **log** mismatches or untrusted-header usage so operators can detect misconfiguration or abuse. *Current code:* no source validation or mismatch logging.

Where this fits: IP extraction runs **before** rate-limit key generation; the resulting string is the IP scope key used in `lib/rate-limit` and in the “Keying Strategy” column of the rate-limited APIs table above. Applying the same extraction and normalization logic everywhere (e.g. via a shared helper) keeps behavior consistent and makes it easier to add trusted-proxy and IPv6 rules later.

---

## Algorithms Used

All configured limiters currently use:

- **Sliding Window** (`Ratelimit.slidingWindow`)  
  Good balance of fairness and abuse protection, with reduced edge-window burst behavior.

---

## Rate-Limited APIs and Limiter Types

| API Route                             | Limiter Scopes      | Keying Strategy                              | Primary Abuse Mitigated                               |
| ------------------------------------- | ------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `POST /api/auth/signup`               | Global + IP + Email | `global`, client IP, normalized email        | signup spam, bot registration, account-targeted abuse |
| `POST /api/auth/forgot-password`      | Global + IP + Email | `global`, client IP, normalized email        | reset-spam, mailbox flooding, account probing         |
| `POST /api/auth/resend-verification`  | Global + IP + Email | `global`, client IP, normalized email        | verification email spam                               |
| `POST /api/auth/reset-password`       | Global + IP + Email | `global`, client IP, authenticated email     | repeated password reset attempts                      |
| `POST /api/auth/update-password`      | Global + IP + Email | `global`, client IP, recovered-session email | credential abuse on recovery/update flow              |
| `GET /api/auth/verify-email`          | Global + IP         | `global`, client IP                          | token verification brute forcing                      |
| `GET /api/auth/verify-otp`            | Global + IP         | `global`, client IP                          | callback token/code spraying                          |
| `POST /api/auth/set-recovery-session` | Global + IP         | `global`, client IP                          | repeated token/session establishment attempts         |

> Note: Email scope is intentionally not used for token-only endpoints (e.g., `verify-email`, `verify-otp`) because request payloads do not include a trusted email identifier.

---

## Current Limits (Source of Truth)

Limits are defined in `src/constants/rate-limit.ts`.

### Signup

- IP: 3 / 15m
- Email: 5 / 1h
- Global: 100 / 1m

### Login (defined in library; not enforced)

- **Status:** Implemented in `@/lib/rate-limit` (`checkLoginRateLimit`) and configured in `@/constants/rate-limit` (LOGIN), but **not enabled in production** because login is performed client-side via `signInWithEmail` in `@/services/auth/auth-service.ts`, which calls Supabase directly. There is no server-side login API route that invokes the rate limiter.
- **Activation:** To enforce these limits, add a login API route (e.g. `/api/auth/login`) that calls `checkLoginRateLimit(clientIp, email)` before delegating to Supabase, or otherwise gate the login flow through a rate-limited server endpoint.
- **Limits (documented for reference; not currently enforced):**
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
