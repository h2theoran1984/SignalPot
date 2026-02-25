import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NewAgentForm from "./NewAgentForm";

export default async function NewAgentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <NewAgentForm />;
}
