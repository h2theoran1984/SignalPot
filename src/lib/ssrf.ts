/**
 * SSRF (Server-Side Request Forgery) protection.
 * Validates external URLs before server-side fetch.
 */

const BLOCKED_HOSTNAMES = ["localhost", "0.0.0.0", "[::1]"];

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
 * Validate a URL is safe to fetch from the server.
 * Blocks private IPs, localhost, cloud metadata endpoints.
 * Enforces HTTPS in production.
 *
 * @throws Error if the URL is unsafe.
 */
export function assertSafeUrl(endpoint: string): void {
  const url = new URL(endpoint);

  // Enforce HTTPS in production
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Agent endpoints must use HTTPS");
  }

  const hostname = url.hostname.toLowerCase();

  // Block private/internal hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error("Agent endpoint resolves to a blocked address");
  }

  // Block private IP ranges
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
}
