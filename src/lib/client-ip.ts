/**
 * Client IP extraction for rate limiting.
 *
 * Uses a configurable trusted-proxy CIDR allowlist. X-Forwarded-For is parsed
 * right-to-left; IPs that match TRUSTED_PROXY_CIDRS are skipped so the first
 * IP that is not a trusted proxy is taken (spoof-resistant). Fallback order:
 * that client from X-Forwarded-For → X-Real-IP → CF-Connecting-IP → TCP remote
 * address → "unknown" (with warning log). Addresses are validated and normalized
 * before comparison so the chain is properly validated.
 */

import type { NextRequest } from "next/server";
import ipaddr from "ipaddr.js";

const SENTINEL_UNKNOWN = "unknown";
const TRUSTED_PROXY_CIDRS_ENV = "TRUSTED_PROXY_CIDRS";
const TRUST_FORWARDED_HEADERS_WITHOUT_PEER_ENV = "TRUST_FORWARDED_HEADERS_WITHOUT_PEER";

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

/** True when explicitly opted in to trust forwarded headers when peer is unknown or CIDRs unset (e.g. serverless). */
function trustForwardedHeadersWithoutPeer(): boolean {
  const v = process.env[TRUST_FORWARDED_HEADERS_WITHOUT_PEER_ENV]?.trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Canonical parse-and-normalize: validate the string as an IP and return
 * normalized form (lowercase, zone ID stripped, IPv4-mapped IPv6 collapsed),
 * or null if invalid. Use this before any CIDR or comparison logic.
 */
export function parseAndNormalizeIp(ip: string): string | null {
  if (!ip || typeof ip !== "string") return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  try {
    const addr = ipaddr.process(trimmed.replace(/%[^/]+$/, ""));
    return addr.toString().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether the given remote address (direct connection peer) is in the trusted proxy allowlist.
 * Uses parseAndNormalizeIp for canonical validation before CIDR matching.
 */
export function isTrustedProxy(remoteAddr: string): boolean {
  const normalized = parseAndNormalizeIp(remoteAddr);
  if (normalized === null || normalized === SENTINEL_UNKNOWN) return false;
  const cidrs = getTrustedProxyCidrs();
  if (cidrs.length === 0) return false;

  try {
    const addr = ipaddr.parse(normalized);
    for (const { addr: rangeAddr, bits } of cidrs) {
      if (addr.kind() !== rangeAddr.kind()) continue;
      try {
        if (addr.match(rangeAddr, bits)) return true;
      } catch {
        // kind mismatch or match error, skip
      }
    }
  } catch {
    // should not happen if parseAndNormalizeIp succeeded
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
 * Parse X-Forwarded-For right-to-left, skip IPs that match TRUSTED_PROXY_CIDRS,
 * and return the first IP that is not a trusted proxy (the client before our edge).
 * Addresses are validated and normalized via parseAndNormalizeIp before comparison.
 * Returns null if no untrusted IP is found or header is missing/invalid.
 */
export function parseXForwardedFor(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor?.trim()) return null;

  const tokens = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  // Right-to-left: last entry is closest to our server (last hop), first is original client.
  // We want the first (rightmost) IP that is not in our trusted proxy list.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const normalized = parseAndNormalizeIp(tokens[i]);
    if (normalized === null) continue;
    if (!isTrustedProxy(normalized)) return normalized;
  }
  return null;
}

/**
 * Get client IP from forwarded headers: X-Forwarded-For (right-to-left, skip trusted)
 * then X-Real-IP, then CF-Connecting-IP. All candidates are validated and normalized.
 * Does not validate direct peer; caller must ensure request is from a trusted peer when appropriate.
 */
export function parseForwardedHeaders(request: NextRequest): string | null {
  const fromXff = parseXForwardedFor(request);
  if (fromXff !== null) return fromXff;
  const realIp = request.headers.get("x-real-ip");
  const normalizedReal = realIp ? parseAndNormalizeIp(realIp) : null;
  if (normalizedReal !== null) return normalizedReal;
  const cf = request.headers.get("cf-connecting-ip");
  const normalizedCf = cf ? parseAndNormalizeIp(cf) : null;
  if (normalizedCf !== null) return normalizedCf;
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
 * - If the direct peer is in trustedProxyCidrs, uses forwarded headers: X-Forwarded-For
 *   is parsed right-to-left and IPs matching TRUSTED_PROXY_CIDRS are skipped; the first
 *   IP that is not a trusted proxy is used, then X-Real-IP, then CF-Connecting-IP.
 * - If the direct peer is not trusted (or not available), uses the direct peer when
 *   available, otherwise the sentinel "unknown" and logs a one-time warning.
 * - All addresses are validated and normalized before use so the chain is properly validated.
 */
export function getClientIp(request: NextRequest): string {
  const directPeer = getDirectPeer(request);
  const cidrs = getTrustedProxyCidrs();

  // Only accept forwarded headers when we can validate the direct peer (trusted CIDRs + peer in list)
  // or when explicitly opted in (e.g. serverless with a single trusted edge).
  const mayUseForwardedHeaders =
    (directPeer !== null && cidrs.length > 0 && isTrustedProxy(directPeer)) ||
    trustForwardedHeadersWithoutPeer();

  let chosen: string | null = null;
  if (mayUseForwardedHeaders) {
    chosen = parseForwardedHeaders(request);
  }
  if (chosen === null && directPeer !== null) {
    chosen = directPeer;
  }

  if (chosen !== null && chosen !== "") {
    return normalizeIp(chosen);
  }

  if (!hasLoggedUnknown) {
    hasLoggedUnknown = true;
    console.warn(
      "[client-ip] No client IP could be determined; using sentinel for rate limiting. " +
        "Configure TRUSTED_PROXY_CIDRS if behind a proxy and ensure the platform sets forwarded headers, " +
        "or set TRUST_FORWARDED_HEADERS_WITHOUT_PEER=true to trust headers when peer is unknown (e.g. serverless)."
    );
  }
  return SENTINEL_UNKNOWN;
}
