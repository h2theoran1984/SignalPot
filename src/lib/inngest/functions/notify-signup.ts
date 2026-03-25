import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications";

/**
 * Sends an in-app notification to the admin whenever a new user signs up.
 */
export const notifySignup = inngest.createFunction(
  { id: "notify-signup", name: "Notify — New Signup", retries: 2 },
  { event: "user/signed.up" },
  async ({ event }) => {
    const adminId = process.env.ADMIN_PROFILE_ID;
    if (!adminId) {
      console.warn("[notify-signup] ADMIN_PROFILE_ID not set, skipping");
      return;
    }

    const admin = createAdminClient();
    const { display_name, email } = event.data;
    const label = display_name || email;

    await notify(
      admin,
      adminId,
      "info",
      "New signup",
      `${label} just signed up.`,
      { user_id: event.data.user_id, email },
    );
  },
);
