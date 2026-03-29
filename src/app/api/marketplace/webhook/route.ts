// POST /api/marketplace/webhook — Unified webhook for all marketplace events.
// Each marketplace adapter handles validation and routing internally.
// Query param ?provider=azure|google_cloud|aws determines which adapter processes the event.

import "@/lib/marketplace/init"; // Register connectors
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getConnector,
  activateSubscription,
  updateSubscriptionStatus,
  getSubscriptionByExternalId,
} from "@/lib/marketplace/service";
import type { MarketplaceProvider } from "@/lib/marketplace/types";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") as MarketplaceProvider | null;

  if (!provider || !["google_cloud", "azure", "aws", "databricks"].includes(provider)) {
    return NextResponse.json({ error: "Missing or invalid provider" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createAdminClient();
  const action = body.action as string ?? body.eventType as string ?? body.type as string;

  try {
    switch (action) {
      // ── Subscription activated ──
      case "activate":
      case "subscribe":
      case "Subscription.Activated": {
        const listingId = body.listing_id as string;
        const externalSubId = body.subscription_id as string ?? body.external_subscription_id as string;
        const externalCustomerId = body.customer_id as string ?? body.external_customer_id as string;

        if (!listingId || !externalSubId || !externalCustomerId) {
          return NextResponse.json({ error: "Missing listing_id, subscription_id, or customer_id" }, { status: 400 });
        }

        const sub = await activateSubscription(admin, listingId, {
          externalSubscriptionId: externalSubId,
          externalCustomerId,
          customerName: body.customer_name as string | undefined,
          customerEmail: body.customer_email as string | undefined,
          planId: body.plan_id as string | undefined,
          quantity: body.quantity as number | undefined,
          externalData: body.data as Record<string, unknown> | undefined,
        });

        return NextResponse.json({ subscription_id: sub.id, status: "active" });
      }

      // ── Subscription canceled ──
      case "cancel":
      case "unsubscribe":
      case "Subscription.Canceled": {
        const externalSubId = body.subscription_id as string ?? body.external_subscription_id as string;
        if (!externalSubId) {
          return NextResponse.json({ error: "Missing subscription_id" }, { status: 400 });
        }

        const sub = await getSubscriptionByExternalId(admin, provider, externalSubId);
        if (sub) {
          await updateSubscriptionStatus(admin, sub.id, "canceled");
        }

        return NextResponse.json({ status: "canceled" });
      }

      // ── Subscription suspended ──
      case "suspend":
      case "Subscription.Suspended": {
        const externalSubId = body.subscription_id as string ?? body.external_subscription_id as string;
        if (!externalSubId) {
          return NextResponse.json({ error: "Missing subscription_id" }, { status: 400 });
        }

        const sub = await getSubscriptionByExternalId(admin, provider, externalSubId);
        if (sub) {
          await updateSubscriptionStatus(admin, sub.id, "suspended");
        }

        return NextResponse.json({ status: "suspended" });
      }

      // ── Subscription reinstated ──
      case "reinstate":
      case "Subscription.Reinstated": {
        const externalSubId = body.subscription_id as string ?? body.external_subscription_id as string;
        if (!externalSubId) {
          return NextResponse.json({ error: "Missing subscription_id" }, { status: 400 });
        }

        const sub = await getSubscriptionByExternalId(admin, provider, externalSubId);
        if (sub) {
          await updateSubscriptionStatus(admin, sub.id, "active");
        }

        return NextResponse.json({ status: "active" });
      }

      default:
        console.warn(`[marketplace-webhook] Unknown action: ${action} from ${provider}`);
        return NextResponse.json({ status: "acknowledged" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[marketplace-webhook] Error processing ${action} from ${provider}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
