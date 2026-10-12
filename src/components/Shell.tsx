"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { poslouchejZmeny } from "@/lib/udalosti";
import { OdhlasitTlacitko } from "./OdhlasitTlacitko";

const MENU = [
  { href: "/kalendar", nazev: "Kalendář" },
  { href: "/seznam", nazev: "Seznam" },
  { href: "/chyby", nazev: "Chyby" },
  { href: "/media", nazev: "Média" },
  { href: "/texty", nazev: "Texty" },
  { href: "/ucty", nazev: "Účty" },
];

function usePocetChyb(): number | null {
  const [pocet, setPocet] = useState<number | null>(null);
  const nacti = useCallback(async () => {
    try {
      const { count, error } = await supabase()
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .is("error_resolved_at", null);
      if (!error) setPocet(count ?? 0);
    } catch {
      setPocet(null);
    }
  }, []);
  useEffect(() => {
    // první načtení až po vykreslení, ať se stránka neblokuje
    const t = setTimeout(nacti, 0);
    const i = setInterval(nacti, 60_000);
    const zrus = poslouchejZmeny(nacti);
    return () => {
      clearTimeout(t);
      clearInterval(i);
      zrus();
    };
  }, [nacti]);
  return pocet;
}

function Polozky({ pocetChyb, onKlik }: { pocetChyb: number | null; onKlik?: () => void }) {
  const cesta = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      <Link
        href="/prispevky/novy"
        onClick={onKlik}
        className="mb-3 rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-700"
      >
        + Nový příspěvek
      </Link>
      {MENU.map((m) => {
        const aktivni = cesta === m.href || cesta.startsWith(`${m.href}/`);
        return (
          <Link
            key={m.href}
            href={m.href}
            onClick={onKlik}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${aktivni ? "bg-slate-200 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {m.nazev}
            {m.href === "/chyby" && pocetChyb != null && pocetChyb > 0 && (
              <span className="rounded-full bg-red-600 px-2 text-xs font-semibold text-white" aria-label={`${pocetChyb} nevyřešených`}>
                {pocetChyb}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ jmeno, children }: { jmeno: string; children: ReactNode }) {
  const [suplik, setSuplik] = useState(false);
  const pocetChyb = usePocetChyb();

  return (
    <div className="flex min-h-screen">
      {/* počítač: pevné boční menu */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-3 md:flex">
        <div className="mb-4 px-1 text-sm font-semibold">SubBau Social</div>
        <Polozky pocetChyb={pocetChyb} />
        <div className="mt-auto space-y-2 px-1 text-xs text-slate-500">
          <div className="truncate">{jmeno}</div>
          <OdhlasitTlacitko className="w-full" />
        </div>
      </aside>

      {/* telefon: horní lišta + šuplík */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            onClick={() => setSuplik(true)}
            aria-label="Otevřít menu"
          >
            ☰ Menu
            {pocetChyb != null && pocetChyb > 0 && (
              <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{pocetChyb}</span>
            )}
          </button>
          <span className="text-sm font-semibold">SubBau Social</span>
        </header>
        {suplik && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSuplik(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside
              className="absolute left-0 top-0 flex h-full w-64 flex-col bg-white p-3 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between px-1">
                <span className="text-sm font-semibold">SubBau Social</span>
                <button type="button" onClick={() => setSuplik(false)} aria-label="Zavřít menu" className="p-1">
                  ✕
                </button>
              </div>
              <Polozky pocetChyb={pocetChyb} onKlik={() => setSuplik(false)} />
              <div className="mt-auto space-y-2 px-1 text-xs text-slate-500">
                <div className="truncate">{jmeno}</div>
                <OdhlasitTlacitko className="w-full" />
              </div>
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-3 md:p-6">{children}</main>
      </div>
    </div>
  );
}
