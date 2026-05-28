import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Belt-and-suspenders: middleware already redirects unauth users; this
  // makes the layout fail closed if middleware is ever bypassed.
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email ||
    "Usuário";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar userEmail={user.email ?? ""} userName={displayName} />
      <main className="flex-1 transition-all duration-300 ml-20 lg:ml-64 p-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
