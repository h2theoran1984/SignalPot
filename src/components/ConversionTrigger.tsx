"use client";

import { useEffect } from "react";
import { trackEvent, type TrackingEvent } from "@/lib/tracking";

const VALID_EVENTS: Set<string> = new Set<string>([
  "sign_up",
  "agent_registered",
  "arena_match_created",
  "plan_upgraded",
  "credit_purchased",
  "blog_post_viewed",
]);

export default function ConversionTrigger() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const event = params.get("event");

      if (event && VALID_EVENTS.has(event)) {
        trackEvent(event as TrackingEvent);

        // Remove the ?event= param from the URL without a page reload
        params.delete("event");
        const remaining = params.toString();
        const cleanUrl =
          window.location.pathname + (remaining ? `?${remaining}` : "") + window.location.hash;
        window.history.replaceState({}, "", cleanUrl);
      }
    } catch {
      // Silently ignore
    }
  }, []);

  return null;
}
