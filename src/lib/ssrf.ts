/**
 * SSRF (Server-Side Request Forgery) protection.
 * Validates external URLs before server-side fetch.
 * Performs DNS resolution to catch DNS rebinding attacks.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";

const BLOCKED_HOSTNAMES = ["localhost", "0.0.0.0", "::1"];

const PRIVATE_IP_PREFIXES = [
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",
  "127.",
  "169.254.",
  "0.",
];

/**
 * Check if a resolved IP address is private/internal.
 */
function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  if (PRIVATE_IP_PREFIXES.some((p) => ip.startsWith(p))) {
    return true;
  }

  // IPv6 loopback and private
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique local
  if (ip.startsWith("fe80")) return true; // link-local

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    return isPrivateIp(v4Mapped[1]);
  }

  return false;
}

/**
 * Validate a URL is safe to fetch from the server.
 * Blocks private IPs, localhost, cloud metadata endpoints.
 * Resolves DNS to prevent rebinding attacks.
 * Enforces HTTPS in production.
 *
 * @throws Error if the URL is unsafe.
 */
export async function assertSafeUrl(endpoint: string): Promise<void> {
  const url = new URL(endpoint);

  // Skip SSRF checks for same-origin calls (our own agents)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL;
  if (siteUrl) {
    try {
      const self = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`);
      if (url.hostname === self.hostname) return;
    } catch {
      // Ignore parse errors, continue with checks
    }
  }

  // Enforce HTTPS in production
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Agent endpoints must use HTTPS");
  }

  const hostname = url.hostname.toLowerCase();

  // Block private/internal hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error("Agent endpoint resolves to a blocked address");
  }

  // Block private IP ranges (string-level check for literal IPs in URL)
  if (PRIVATE_IP_PREFIXES.some((p) => hostname.startsWith(p))) {
    throw new Error("Agent endpoint resolves to a private IP range");
  }

  // Block cloud metadata endpoints (AWS, GCP, Azure)
  if (
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Agent endpoint resolves to a cloud metadata address");
  }

  // DNS resolution check — catches rebinding attacks where a domain resolves to a private IP
  if (!isIP(hostname)) {
    try {
      const results = await lookup(hostname, { all: true });
      for (const result of results) {
        if (isPrivateIp(result.address)) {
          throw new Error("Agent endpoint DNS resolves to a private IP address");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("private IP")) {
        throw err;
      }
      // DNS lookup failure — block by default (fail-closed)
      throw new Error("Agent endpoint DNS resolution failed");
    }
  }
}
