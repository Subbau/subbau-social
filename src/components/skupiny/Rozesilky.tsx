"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatVPasmu } from "@/lib/cas";
import { nactiRozesilky, zrusRozesilku, type PrehledRozesilky } from "@/lib/data/skupiny";
import { Hlaska, Nacitani, Nadpis, Tlacitko, textChyby } from "../ui";
import { NavSkupin } from "./NavSkupin";

const STAV: Record<PrehledRozesilky["status"], { text: string; trida: string }> = {
  active: { text: "běží", trida: "bg-blue-100 text-blue-800" },
  done: { text: "hotovo", trida: "bg-green-100 text-green-800" },
  cancelled: { text: "zrušeno", trida: "bg-slate-200 text-slate-700" },
};

export function Rozesilky() {
  const [radky, setRadky] = useState<PrehledRozesilky[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [verze, setVerze] = useState(0);

  useEffect(() => {
    let platne = true;
    nactiRozesilky()
      .then((r) => {
        if (platne) {
          setRadky(r);
          setChyba(null);
        }
      })
      .catch((e) => platne && setChyba(textChyby(e)))
      .finally(() => platne && setNacitam(false));
    return () => {
      platne = false;
    };
  }, [verze]);

  async function zrusit(r: PrehledRozesilky) {
    if (!confirm(`Zrušit rozesílku „${r.title}“? Zbylé skupiny se už nenabídnou a upozornění nepřijdou.`)) return;
    try {
      await zrusRozesilku(r.id);
    } catch (e) {
      setChyba(textChyby(e));
    }
    setVerze((v) => v + 1);
  }

  return (
    <div className="space-y-3">
      <NavSkupin />
      <Nadpis akce={<Link href="/skupiny/nova" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">+ Nová rozesílka</Link>}>
        Rozesílky
      </Nadpis>
      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
      {nacitam && <Nacitani />}
      {!nacitam && radky.length === 0 && <p className="text-sm text-slate-500">Zatím žádná rozesílka.</p>}
      <ul className="space-y-2">
        {radky.map((r) => {
          const celkem = r.group_tasks.length;
          const odeslano = r.group_tasks.filter((t) => t.status === "sent").length;
          const preskoceno = r.group_tasks.filter((t) => t.status === "skipped").length;
          const davky = [...r.group_batches].sort((a, b) => a.batch_no - b.batch_no);
          const dalsi = davky.find((d) => new Date(d.due_at).getTime() > Date.now());
          const s = STAV[r.status];
          const podil = celkem ? Math.round(((odeslano + preskoceno) / celkem) * 100) : 0;
          return (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words font-medium">{r.title}</span>
                <span className={`rounded px-1.5 text-xs ${s.trida}`}>{s.text}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                odesláno {odeslano}, přeskočeno {preskoceno}, zbývá {celkem - odeslano - preskoceno} z {celkem} · {davky.length} dávek po{" "}
                {r.batch_size} · odstup {r.batch_interval_minutes} min · {r.variants.length} varianty textu
              </p>
              <p className="text-xs text-slate-500">
                start {formatVPasmu(r.starts_at, "EEEEEE d. M. H:mm")}
                {r.status === "active" && dalsi && ` · další dávka ${formatVPasmu(dalsi.due_at, "EEEEEE d. M. H:mm")}`}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-green-600" style={{ width: `${podil}%` }} />
              </div>
              {r.status === "active" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href="/skupiny/dnes" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Otevřít Dnes</Link>
                  <Tlacitko varianta="nebezpecne" onClick={() => void zrusit(r)}>Zrušit rozesílku</Tlacitko>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
