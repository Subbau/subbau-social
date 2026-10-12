"use client";

import { useState } from "react";
import type { Json, SocialAccount } from "@/lib/db-types";
import { hezkyCas } from "@/lib/cas";
import { useCasoveSloty, useUcty } from "@/lib/data/ucty";
import { SITE } from "@/lib/stavy";
import { supabase } from "@/lib/supabase/client";
import { Hlaska, Nacitani, Nadpis, Tlacitko, textChyby } from "../ui";
import { CasoveSloty } from "./CasoveSloty";

const PASMA = ["Europe/Prague", "Europe/Berlin", "Europe/Vienna", "Europe/Bratislava", "Europe/London", "UTC"];

const PRIPOJENI: Record<SocialAccount["connection_status"], { text: string; trida: string }> = {
  connected: { text: "připojeno", trida: "bg-green-100 text-green-800" },
  needs_reconnect: { text: "znovu připojit", trida: "bg-red-100 text-red-800" },
  not_connected: { text: "nepřipojeno", trida: "bg-slate-200 text-slate-700" },
};

function cislo(q: Json, klic: string): number | null {
  if (q && typeof q === "object" && !Array.isArray(q)) {
    const v = (q as Record<string, Json | undefined>)[klic];
    return typeof v === "number" ? v : null;
  }
  return null;
}

async function textChybyFunkce(e: unknown): Promise<string> {
  // FunctionsHttpError nese odpověď v context
  const ctx = (e as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const telo = await ctx.clone().json();
      if (telo && typeof telo === "object") {
        const t = telo as Record<string, unknown>;
        return String(t.error ?? t.message ?? JSON.stringify(t));
      }
    } catch {
      try {
        return await ctx.text();
      } catch {
        /* nic */
      }
    }
  }
  return textChyby(e);
}

function shrnuti(data: unknown): string {
  if (data == null) return "Hotovo.";
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.message === "string") return d.message;
    if (Array.isArray(d.nacteno)) {
      const jmena = d.nacteno.map((x) => String((x as { name?: unknown }).name ?? "?")).join(", ");
      const odpojeno = typeof d.odpojeno === "number" && d.odpojeno > 0 ? ` Odpojeno (klíč je už nevidí): ${d.odpojeno}.` : "";
      return `Načteno ${d.nacteno.length} účtů${jmena ? `: ${jmena}` : ""}.${odpojeno}`;
    }
    return Object.entries(d)
      .filter(([, v]) => typeof v !== "object")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ") || "Hotovo.";
  }
  return String(data);
}

export function Ucty() {
  const ucty = useUcty();
  const sloty = useCasoveSloty();
  const [synchronizuji, setSynchronizuji] = useState(false);
  const [zprava, setZprava] = useState<{ typ: "ok" | "chyba"; text: string } | null>(null);
  const [rozbaleny, setRozbaleny] = useState<string | null>(null);

  async function nacistZMety() {
    setSynchronizuji(true);
    setZprava(null);
    try {
      const { data, error } = await supabase().functions.invoke("meta-sync", { body: {} });
      if (error) throw error;
      setZprava({ typ: "ok", text: shrnuti(data) });
      ucty.obnov();
    } catch (e) {
      setZprava({ typ: "chyba", text: `Načtení z Mety selhalo: ${await textChybyFunkce(e)}` });
    } finally {
      setSynchronizuji(false);
    }
  }

  async function zmenit(u: SocialAccount, zmena: Partial<Pick<SocialAccount, "color" | "timezone" | "is_active">>) {
    const { error } = await supabase().from("social_accounts").update(zmena).eq("id", u.id);
    if (error) setZprava({ typ: "chyba", text: error.message });
    else ucty.obnov();
  }

  return (
    <div className="space-y-3">
      <Nadpis
        akce={
          <Tlacitko varianta="primarni" onClick={() => void nacistZMety()} disabled={synchronizuji}>
            {synchronizuji ? "Načítám…" : "Načíst účty z Mety"}
          </Tlacitko>
        }
      >
        Účty
      </Nadpis>
      {zprava && <Hlaska typ={zprava.typ}>{zprava.text}</Hlaska>}
      {ucty.chyba && <Hlaska typ="chyba">{ucty.chyba}</Hlaska>}
      {ucty.nacitam && <Nacitani />}

      {!ucty.nacitam && ucty.data.length === 0 && (
        <Hlaska typ="info">
          <p className="mb-2 font-medium">Zatím žádné účty.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Nejdřív se musí uložit Meta klíč (dlouhodobý token stránky). To se dělá ručně v Supabase — v SQL editoru přes funkci <code>admin_set_credential</code>, postup je v <code>supabase/setup/05_meta_klic.sql</code>.</li>
            <li>Pak tady klikněte na <strong>Načíst účty z Mety</strong>. Facebook stránky a propojený Instagram se objeví v seznamu.</li>
            <li>Každému účtu nastavte barvu a výchozí časy.</li>
          </ol>
        </Hlaska>
      )}

      <ul className="space-y-3">
        {ucty.data.map((u) => {
          const p = PRIPOJENI[u.connection_status];
          const pouzito = cislo(u.quota, "ig_used");
          const limit = cislo(u.quota, "ig_limit");
          const slotyUctu = sloty.data.filter((s) => s.account_id === u.id);
          return (
            <li key={u.id} className={`rounded-lg border bg-white p-3 ${u.is_active ? "border-slate-200" : "border-dashed border-slate-300 opacity-75"}`}>
              <div className="flex flex-wrap items-start gap-3">
                {u.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avatar z Mety
                  <img src={u.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" style={{ boxShadow: `0 0 0 2px ${u.color}` }} />
                ) : (
                  <span className="h-12 w-12 rounded-full" style={{ background: u.color }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="text-xs text-slate-500">
                    {SITE[u.platform]}
                    {u.username ? ` · @${u.username}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${p.trida}`}>{p.text}</span>
                    <span className="text-slate-500">
                      kontrola: {u.last_checked_at ? hezkyCas(u.last_checked_at) : "zatím ne"}
                    </span>
                    {u.token_expires_at && <span className="text-slate-500">token do {hezkyCas(u.token_expires_at)}</span>}
                  </div>
                  {u.last_check_error && <p className="mt-1 text-xs text-red-700">{u.last_check_error}</p>}
                  {u.platform === "instagram" && pouzito != null && limit != null && (
                    <div className="mt-2 max-w-xs text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>Limit publikací (24 h)</span>
                        <span className="tabular-nums">{pouzito}/{limit}</span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-200">
                        <div className={`h-full ${pouzito / limit > 0.8 ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${Math.min(100, (pouzito / limit) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
                  <label className="text-xs">
                    <span className="stitek-pole">Barva</span>
                    <input type="color" value={u.color} onChange={(e) => void zmenit(u, { color: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-slate-300" />
                  </label>
                  <label className="text-xs">
                    <span className="stitek-pole">Časové pásmo</span>
                    <select className="pole py-1" value={u.timezone} onChange={(e) => void zmenit(u, { timezone: e.target.value })}>
                      {[...new Set([u.timezone, ...PASMA])].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 pb-1.5 text-sm">
                    <input type="checkbox" checked={u.is_active} onChange={(e) => void zmenit(u, { is_active: e.target.checked })} />
                    aktivní
                  </label>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-2">
                <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setRozbaleny(rozbaleny === u.id ? null : u.id)}>
                  Výchozí časy ({slotyUctu.length}) {rozbaleny === u.id ? "▲" : "▼"}
                </button>
                {rozbaleny === u.id && (
                  <div className="mt-2">
                    <CasoveSloty accountId={u.id} sloty={slotyUctu} poZmene={sloty.obnov} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
