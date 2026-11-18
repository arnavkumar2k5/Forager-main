import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";

export const instant = false;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-muted">
      <Sidebar />
      <main className="my-2 mr-2 flex-1 min-h-0 min-w-0 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xs">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
