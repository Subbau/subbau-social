import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Shell } from "@/components/Shell";
import { supabaseServer } from "@/lib/supabase/server";
import { CHYBI_NASTAVENI } from "@/lib/supabase/env";
import { OdhlasitTlacitko } from "@/components/OdhlasitTlacitko";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Vždy za běhu (přihlášení, env) — nikdy nepředgenerovat při buildu.
  await connection();
  const sb = await supabaseServer();
  if (!sb) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="mb-2 text-lg font-semibold">Appka není nastavená</h1>
        <p className="text-sm text-slate-600">{CHYBI_NASTAVENI}</p>
      </main>
    );
  }

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser, error } = await sb
    .from("app_users")
    .select("id, name, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!appUser) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="mb-2 text-lg font-semibold">Účet nemá přístup</h1>
        <p className="mb-4 text-sm text-slate-600">
          Jste přihlášeni jako <strong>{user.email}</strong>, ale tento účet není mezi uživateli appky.
          Správce ho musí přidat do tabulky <code>app_users</code>.
        </p>
        {error && <p className="mb-4 text-xs text-slate-500">Podrobnosti: {error.message}</p>}
        <OdhlasitTlacitko />
      </main>
    );
  }

  return <Shell jmeno={appUser.name || appUser.email || user.email || ""}>{children}</Shell>;
}
