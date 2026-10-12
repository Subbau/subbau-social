"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

function bezpecnyCil(next: string | null): string {
  // jen cesty uvnitř appky, žádné //cizi.cz
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/kalendar";
}

export function PrihlaseniFormular() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [heslo, setHeslo] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [odesilam, setOdesilam] = useState(false);

  async function odeslat(e: React.FormEvent) {
    e.preventDefault();
    setChyba(null);
    setOdesilam(true);
    try {
      const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password: heslo });
      if (error) {
        setChyba(
          error.message === "Invalid login credentials"
            ? "Špatný e-mail nebo heslo."
            : `Přihlášení se nepovedlo: ${error.message}`,
        );
        return;
      }
      router.replace(bezpecnyCil(params.get("next")));
      router.refresh();
    } catch (err) {
      setChyba(err instanceof Error ? err.message : String(err));
    } finally {
      setOdesilam(false);
    }
  }

  return (
    <form onSubmit={odeslat} className="space-y-4">
      <div>
        <label htmlFor="email" className="stitek-pole">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          className="pole"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="heslo" className="stitek-pole">Heslo</label>
        <input
          id="heslo"
          type="password"
          autoComplete="current-password"
          required
          className="pole"
          value={heslo}
          onChange={(e) => setHeslo(e.target.value)}
        />
      </div>
      {chyba && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{chyba}</p>}
      <button
        type="submit"
        disabled={odesilam}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {odesilam ? "Přihlašuji…" : "Přihlásit"}
      </button>
    </form>
  );
}
