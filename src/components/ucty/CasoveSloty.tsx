"use client";

import { useState } from "react";
import type { AccountTimeSlot } from "@/lib/db-types";
import { zkratCas } from "@/lib/cas";
import { NAZVY_DNU } from "@/lib/mrizka";
import { supabase } from "@/lib/supabase/client";
import { Tlacitko, textChyby } from "../ui";

/** Editor výchozích časů účtu (account_time_slots). */
export function CasoveSloty({
  accountId,
  sloty,
  poZmene,
}: {
  accountId: string;
  sloty: AccountTimeSlot[];
  poZmene: () => void;
}) {
  const [dny, setDny] = useState<number[]>([1, 2, 3, 4, 5]);
  const [cas, setCas] = useState("09:00");
  const [chyba, setChyba] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);

  async function pridat() {
    if (!dny.length || !cas) return;
    setPracuji(true);
    setChyba(null);
    try {
      const radky = dny.map((weekday) => ({ account_id: accountId, weekday, time_of_day: `${cas}:00` }));
      const { error } = await supabase()
        .from("account_time_slots")
        .upsert(radky, { onConflict: "account_id,weekday,time_of_day", ignoreDuplicates: true });
      if (error) throw error;
      poZmene();
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  async function smazat(id: string) {
    const { error } = await supabase().from("account_time_slots").delete().eq("id", id);
    if (error) setChyba(error.message);
    else poZmene();
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1 text-xs">
        {NAZVY_DNU.map((n, i) => {
          const den = i + 1;
          const vDen = sloty.filter((s) => s.weekday === den).sort((a, b) => a.time_of_day.localeCompare(b.time_of_day));
          return (
            <div key={n} className="min-w-0 rounded bg-slate-50 p-1">
              <div className="mb-1 text-center font-medium text-slate-500">{n}</div>
              <div className="flex flex-col gap-0.5">
                {vDen.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title="Smazat"
                    onClick={() => void smazat(s.id)}
                    className="rounded bg-white px-0.5 py-0.5 text-center tabular-nums ring-1 ring-slate-200 hover:bg-red-50 hover:line-through"
                  >
                    {zkratCas(s.time_of_day)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {NAZVY_DNU.map((n, i) => {
          const den = i + 1;
          const ano = dny.includes(den);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={ano}
              onClick={() => setDny(ano ? dny.filter((d) => d !== den) : [...dny, den])}
              className={`h-7 w-8 rounded border ${ano ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}
            >
              {n}
            </button>
          );
        })}
        <input type="time" className="pole w-28 py-1" value={cas} onChange={(e) => setCas(e.target.value)} aria-label="Čas" />
        <Tlacitko onClick={() => void pridat()} disabled={pracuji || !dny.length}>
          Přidat čas
        </Tlacitko>
      </div>
      {chyba && <p className="text-xs text-red-700">{chyba}</p>}
      <p className="text-xs text-slate-500">Klik na čas ho smaže. Výchozí časy se v editoru nabízejí jako rychlá volba.</p>
    </div>
  );
}
