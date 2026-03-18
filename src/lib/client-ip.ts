/**
 * Client IP extraction for rate limiting.
 *
 * Uses a configurable trusted-proxy CIDR allowlist: forwarded headers
 * (X-Forwarded-For, X-Real-IP, CF-Connecting-IP) are only used when the
 * direct connection peer is in trustedProxyCidrs; otherwise the connection
 * remote address or a sentinel is used. Fallback order: leftmost
 * X-Forwarded-For → X-Real-IP → CF-Connecting-IP → TCP remote address → "unknown" (with warning log).
 */

import type { NextRequest } from "next/server";
import ipaddr from "ipaddr.js";

const SENTINEL_UNKNOWN = "unknown";
const TRUSTED_PROXY_CIDRS_ENV = "TRUSTED_PROXY_CIDRS";

/** Parsed CIDR entries for trusted proxy checks. */
let cachedTrustedCidrs: Array<{ addr: ReturnType<typeof ipaddr.parse>; bits: number }> | null = null;

/**
 * Load and validate TRUSTED_PROXY_CIDRS (comma-separated CIDR list).
 * Invalid entries are skipped and logged. Returns empty array if unset or all invalid.
 */
function getTrustedProxyCidrs(): Array<{ addr: ReturnType<typeof ipaddr.parse>; bits: number }> {
  if (cachedTrustedCidrs !== null) return cachedTrustedCidrs;

  const raw = process.env[TRUSTED_PROXY_CIDRS_ENV]?.trim();
  if (!raw) {
    cachedTrustedCidrs = [];
    return cachedTrustedCidrs;
  }

  const list: Array<{ addr: ReturnType<typeof ipaddr.parse>; bits: number }> = [];
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      if (!ipaddr.isValidCIDR(entry)) {
        console.warn(`[client-ip] Invalid trusted proxy CIDR, skipping: ${entry}`);
        continue;
      }
      const [addr, bits] = ipaddr.parseCIDR(entry);
      list.push({ addr, bits });
    } catch (e) {
      console.warn(`[client-ip] Failed to parse trusted proxy CIDR "${entry}":`, e);
    }
  }
  cachedTrustedCidrs = list;
  return cachedTrustedCidrs;
}

/**
 * Whether the given remote address (direct connection peer) is in the trusted proxy allowlist.
 * Used to decide whether to accept X-Forwarded-For / X-Real-IP / CF-Connecting-IP.
 */
export function isTrustedProxy(remoteAddr: string): boolean {
  if (!remoteAddr || remoteAddr === SENTINEL_UNKNOWN) return false;
  const cidrs = getTrustedProxyCidrs();
  if (cidrs.length === 0) return false;

  try {
    const addr = ipaddr.process(remoteAddr.replace(/%[^/]+$/, "")); // strip zone ID
    for (const { addr: rangeAddr, bits } of cidrs) {
      if (addr.kind() !== rangeAddr.kind()) continue;
      try {
        if (addr.match(rangeAddr, bits)) return true;
      } catch {
        // kind mismatch or match error, skip
      }
    }
  } catch {
    // invalid address
  }
  return false;
}

/**
 * Get the direct connection remote address when available (e.g. Node server).
 * In serverless runtimes this may be undefined; callers should treat undefined
 * as "cannot validate trusted proxy" and optionally use forwarded headers with a warning.
 */
function getDirectPeer(request: NextRequest): string | null {
  const req = request as NextRequest & { socket?: { remoteAddress?: string } };
  const peer = req.socket?.remoteAddress ?? null;
  return peer && peer !== "" ? peer : null;
}

/**
 * Parse forwarded headers and return the client IP if present.
 * Order: leftmost X-Forwarded-For, then X-Real-IP, then CF-Connecting-IP.
 * Does not validate trusted proxy; caller must ensure request is from a trusted peer.
 */
export function parseForwardedHeaders(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",").map((s) => s.trim())[0];
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  const cf = request.headers.get("cf-connecting-ip");
  if (cf?.trim()) return cf.trim();
  return null;
}

/** Normalize IP for use as rate-limit key: lowercase, strip zone ID, collapse IPv4-mapped IPv6. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (!trimmed) return trimmed;
  try {
    const addr = ipaddr.process(trimmed.replace(/%[^/]+$/, ""));
    return addr.toString().toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

let hasLoggedUnknown = false;

/**
 * Extract client IP for rate limiting.
 *
 * - If the direct peer is in trustedProxyCidrs, uses forwarded headers in order:
 *   leftmost X-Forwarded-For → X-Real-IP → CF-Connecting-IP.
 * - If the direct peer is not trusted (or not available), uses the direct peer
 *   when available, otherwise the sentinel "unknown" and logs a one-time warning.
 * - Replaces the previous 127.0.0.1 fallback so non-proxied clients are not
 *   collapsed into one bucket; when no address can be determined, returns "unknown".
 */
export function getClientIp(request: NextRequest): string {
  const directPeer = getDirectPeer(request);
  const cidrs = getTrustedProxyCidrs();

  let chosen: string | null = null;

  if (directPeer !== null && cidrs.length > 0) {
    if (isTrustedProxy(directPeer)) {
      chosen = parseForwardedHeaders(request);
    }
    if (chosen === null) {
      chosen = directPeer;
    }
  } else {
    // No direct peer (e.g. serverless) or no CIDRs configured: use forwarded headers
    // to preserve existing behavior, then fall back to sentinel.
    chosen = parseForwardedHeaders(request);
    if (chosen === null && directPeer !== null) {
      chosen = directPeer;
    }
  }

  if (chosen !== null && chosen !== "") {
    return normalizeIp(chosen);
  }

  if (!hasLoggedUnknown) {
    hasLoggedUnknown = true;
    console.warn(
      "[client-ip] No client IP could be determined; using sentinel for rate limiting. " +
        "Configure TRUSTED_PROXY_CIDRS if behind a proxy and ensure the platform sets forwarded headers."
    );
  }
  return SENTINEL_UNKNOWN;
}
