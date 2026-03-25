/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Type-safe analytics tracking utility
// Wraps GA4 gtag() and optional Meta Pixel fbq().
// Respects Do-Not-Track / Global Privacy Control.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    fbq?: (...args: any[]) => void;
  }
}

// All trackable events in SignalPot
export type TrackingEvent =
  | "sign_up"
  | "agent_registered"
  | "arena_match_created"
  | "plan_upgraded"
  | "credit_purchased"
  | "blog_post_viewed";

export interface TrackingParams {
  [key: string]: string | number | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------

function isTrackingAllowed(): boolean {
  if (typeof navigator === "undefined") return false;
  if (navigator.doNotTrack === "1") return false;
  if ((navigator as any).globalPrivacyControl === true) return false;
  return true;
}

// ---------------------------------------------------------------------------
// UTM helpers  (reads from sessionStorage written by UTMCapture)
// ---------------------------------------------------------------------------

const UTM_STORAGE_KEY = "sp_utm";

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export function getUTMParams(): UTMParams {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(UTM_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as UTMParams;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Conversion-style events get UTM params auto-merged
// ---------------------------------------------------------------------------

const CONVERSION_EVENTS: Set<TrackingEvent> = new Set([
  "sign_up",
  "agent_registered",
  "arena_match_created",
  "plan_upgraded",
  "credit_purchased",
]);

// ---------------------------------------------------------------------------
// Core tracking function
// ---------------------------------------------------------------------------

const GOOGLE_ADS_ID = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
  : undefined;

export function trackEvent(
  event: TrackingEvent,
  params: TrackingParams = {},
): void {
  if (!isTrackingAllowed()) return;

  // Strip any PII-looking keys just in case
  const sanitised: TrackingParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (/email|password|token|secret|ssn/i.test(k)) continue;
    sanitised[k] = v;
  }

  // Auto-merge UTM params for conversion events
  if (CONVERSION_EVENTS.has(event)) {
    const utm = getUTMParams();
    for (const [k, v] of Object.entries(utm)) {
      if (v) sanitised[k] = v;
    }
  }

  // GA4
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", event, sanitised);
  }

  // Google Ads conversion (only when configured)
  if (
    GOOGLE_ADS_ID &&
    CONVERSION_EVENTS.has(event) &&
    typeof window !== "undefined" &&
    window.gtag
  ) {
    window.gtag("event", "conversion", {
      send_to: GOOGLE_ADS_ID,
      event_category: event,
      ...sanitised,
    });
  }

  // Meta Pixel
  if (typeof window !== "undefined" && window.fbq) {
    window.fbq("trackCustom", event, sanitised);
  }
}
