import { supabaseAdmin } from "@/lib/server/supabase-admin";

type ConnectedAccount = {
  id: string;
  name: string;
  phone: string | null;
  status: "connected";
  session_id: string;
};

let roundRobinIndex = 0;

export async function getNextAvailableWhatsapp(excludedAccountIds: string[] = []) {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("id,name,phone,status,session_id")
    .eq("status", "connected")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const connectedAccounts = (data as ConnectedAccount[]).filter(
    (account) => !excludedAccountIds.includes(account.id)
  );

  if (connectedAccounts.length === 0) {
    return null;
  }

  const index = roundRobinIndex % connectedAccounts.length;
  const selected = connectedAccounts[index];
  roundRobinIndex = (roundRobinIndex + 1) % connectedAccounts.length;

  return selected;
}
