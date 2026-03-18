# Rate Limiting — Technical Reference

Technical reference for the multi-layer, server-side rate limiting backed by Upstash Redis and `@upstash/ratelimit`.

For a conceptual overview — what rate limiting is, how algorithms work, why this architecture was chosen — see [rate-limiting.md](rate-limiting.md).

---

## Design Principles

- **Defense in depth**: Every sensitive auth endpoint applies more than one limiter where applicable.
- **Fail-open for availability**: If Redis/rate-limit checks fail, requests are temporarily allowed and the error is logged. See [Fail-Open Policy](rate-limiting.md#8-fail-open-policy).
- **Client transparency**: `429` responses include `Retry-After` and rate-limit metadata headers.
- **Enumeration resistance**: Auth flows involving email identities return generic success responses when appropriate — we don't reveal whether an email exists.
- **Normalization**: Email-based keys are normalized to `trim().toLowerCase()` before use. IP keys are normalized (canonical form, zone IDs stripped, IPv4-mapped IPv6 collapsed). See [IP Extraction](#ip-address-extraction) below.

---

## IP Address Extraction

IP-based rate limiting depends on a stable, spoof-resistant client identifier.  
Implementation lives in `src/lib/client-ip.ts` and is used by all rate-limited routes.

### Header Inspection Order

The code does **not** blindly trust the leftmost `X-Forwarded-For` value (which is spoofable by clients).  
Instead, it:

1. Checks if the direct connection peer is a **trusted proxy** (validated against `TRUSTED_PROXY_CIDRS`).
2. If trusted, parses `X-Forwarded-For` **right-to-left**, skipping any IP that matches a trusted proxy CIDR, and returns the **first non-trusted-proxy IP**.
3. Falls back in order: `X-Real-IP` → `CF-Connecting-IP` → `request.socket.remoteAddress` → sentinel `"unknown"`.

### Configuration

Set `TRUSTED_PROXY_CIDRS` in your environment to a comma-separated list of CIDR ranges for your reverse proxy / CDN / load balancer (e.g. Vercel, Cloudflare, AWS):

```bash
TRUSTED_PROXY_CIDRS=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22
```

### IPv6 Normalization

The chosen IP is normalized before use as a Redis key:
- Converted to lowercase canonical form
- Zone identifiers stripped (e.g. `%eth0`)
- IPv4-mapped IPv6 collapsed to IPv4 (e.g. `::ffff:192.0.2.1` → `192.0.2.1`)

This ensures the same client is never counted under two different keys.

---

## Algorithm

All limiters use **Sliding Window** (`Ratelimit.slidingWindow`).  
See [rate-limiting.md §4](rate-limiting.md#4-algorithms-explained) for a full explanation and comparison with other algorithms.

---

## Per-API Rate Limit Configuration

Limits are defined in `src/constants/rate-limit.ts` and enforced via `src/lib/rate-limit.ts`.

### Endpoint Summary

| API Route | Tiers | Primary Threat |
|---|---|---|
| `POST /api/auth/signup` | Global + IP + Email | Bot registration, signup spam |
| `POST /api/auth/forgot-password` | Global + IP + Email | Email bombing, reset-link spam |
| `POST /api/auth/resend-verification` | Global + IP + Email | Verification email spam |
| `POST /api/auth/reset-password` | Global + IP + Email | Repeated password-reset attempts |
| `GET /api/auth/verify-email` | Global + IP | Token brute-forcing |
| `POST /api/auth/verify-otp` | Global + IP | OTP/code spraying |
| `POST /api/auth/set-recovery-session` | Global + IP | Token replay, credential stuffing |

> **Why no Email tier for token endpoints?** `verify-email`, `verify-otp`, and `set-recovery-session` do not receive an email address in the request body, so email-scoped limiting is not applicable.

### Configured Limits

#### `POST /api/auth/signup`
| Tier | Limit | Window |
|---|---|---|
| IP | 3 | 15 min |
| Email | 5 | 1 hr |
| Global | 100 | 1 min |

#### `POST /api/auth/forgot-password`
| Tier | Limit | Window |
|---|---|---|
| IP | 3 | 15 min |
| Email | 5 | 1 hr |
| Global | 100 | 1 min |

#### `POST /api/auth/resend-verification`
| Tier | Limit | Window |
|---|---|---|
| IP | 10 | 1 hr |
| Email | 3 | 1 hr |
| Global | 100 | 1 hr |

#### `POST /api/auth/reset-password`
| Tier | Limit | Window |
|---|---|---|
| IP | 5 | 15 min |
| Email | 5 | 1 hr |
| Global | 100 | 1 min |

#### `GET /api/auth/verify-email`
| Tier | Limit | Window |
|---|---|---|
| IP | 30 | 1 hr |
| Global | 2000 | 1 hr |

#### `POST /api/auth/verify-otp`
| Tier | Limit | Window |
|---|---|---|
| IP | 30 | 1 hr |
| Global | 2000 | 1 hr |

#### `POST /api/auth/set-recovery-session`
| Tier | Limit | Window |
|---|---|---|
| IP | 20 | 15 min |
| Global | 1000 | 15 min |

---

## Login Rate Limiting — Status Note

A `checkLoginRateLimit` function and full `LOGIN` config are implemented in the codebase, but **not currently enforced in production** because login is performed client-side via `signInWithPassword` in `auth-service.ts`, which calls Supabase directly without passing through a server-side API route.

**To activate it**: Create a `POST /api/auth/login` route that calls `checkLoginRateLimit(clientIp, email)` before delegating to Supabase.

Documented limits (for reference):

| Tier | Limit | Window |
|---|---|---|
| IP | 10 | 1 min |
| Email | 5 | 1 min |
| Global | 1000 | 1 min |

---

## Redis Key Patterns

```
ratelimit:<endpoint>:<tier>:<identifier>
```

Examples:
```
ratelimit:signup:global:global
ratelimit:signup:ip:203.0.113.42
ratelimit:signup:email:user@example.com
ratelimit:forgot-password:ip:203.0.113.42
```

Keys expire automatically when the window elapses (TTL is managed by `@upstash/ratelimit`).

---

## HTTP 429 Response Contract

Every blocked endpoint must return:

### Status
`HTTP 429 Too Many Requests`

### Headers
```
Retry-After: <seconds until window resets>
X-RateLimit-Limit: <configured max>
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <epoch ms>
```

### Body
```json
{
  "error": "Too Many Requests",
  "message": "Human-readable message appropriate to the limitType",
  "retryAfter": 245,
  "limit": 3,
  "remaining": 0
}
```

The `limitType` field in `RateLimitCheckResult` (`"global"`, `"ip"`, or `"email"`) is used internally to select the right user-facing message but is **not** exposed in the response body to avoid leaking rate-limiting internals.

---

## Security Observations

1. Rate limiting was added to previously unprotected token-verification and session-establishment endpoints (`verify-email`, `verify-otp`, `set-recovery-session`).
2. OTP type is validated against an allowlist before verification proceeds in `verify-email`.
3. Standard `X-RateLimit-*` and `Retry-After` headers are returned on all `429` responses.
4. All email-based rate-limit identifiers are normalized with `trim().toLowerCase()` before use.
