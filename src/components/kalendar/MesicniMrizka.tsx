"use client";

import { useState } from "react";
import type { PostWithMedia, SocialAccount } from "@/lib/db-types";
import { APP_TZ, dnes, rozlozDatum } from "@/lib/cas";
import { NAZVY_DNU, seskup, tydnyMesice } from "@/lib/mrizka";
import { utcNaMistni } from "@/lib/cas";
import { DND_TYP, KartaPrispevku } from "./KartaPrispevku";

const MAX_V_BUNCE = 4;

export function MesicniMrizka({
  datum,
  prispevky,
  ucty,
  urls,
  priPusteni,
  novy,
}: {
  datum: string;
  prispevky: PostWithMedia[];
  ucty: Map<string, SocialAccount>;
  urls: Record<string, string>;
  priPusteni: (postId: string, datum: string, hodina: number | null) => void;
  novy: (datum: string, hodina: number | null) => void;
}) {
  const { rok, mesic } = rozlozDatum(datum);
  const tydny = tydnyMesice(rok, mesic);
  const dnesni = dnes(APP_TZ);
  const [nad, setNad] = useState<string | null>(null);
  const [vybranyDen, setVybranyDen] = useState<string | null>(null);
  const [rozbalene, setRozbalene] = useState<Set<string>>(new Set());
  const podleDne = seskup(prispevky, (p) => (p.scheduled_at ? utcNaMistni(p.scheduled_at, APP_TZ).datum : null));

  function klikDoBunky(d: string) {
    // na telefonu klik vybere den (seznam pod mřížkou), na počítači založí příspěvek
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches) setVybranyDen(d);
    else novy(d, null);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs text-slate-500">
          {NAZVY_DNU.map((n) => (
            <div key={n} className="py-1.5">{n}</div>
          ))}
        </div>
        {tydny.map((t) => (
          <div key={t[0].datum} className="grid grid-cols-7">
            {t.map((d) => {
              const polozky = podleDne.get(d.datum) ?? [];
              const vse = rozbalene.has(d.datum);
              const viditelne = vse ? polozky : polozky.slice(0, MAX_V_BUNCE);
              return (
                <div
                  key={d.datum}
                  role="button"
                  tabIndex={0}
                  onClick={() => klikDoBunky(d.datum)}
                  onKeyDown={(e) => e.key === "Enter" && novy(d.datum, null)}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(DND_TYP)) {
                      e.preventDefault();
                      setNad(d.datum);
                    }
                  }}
                  onDragLeave={() => setNad(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setNad(null);
                    const id = e.dataTransfer.getData(DND_TYP);
                    if (id) priPusteni(id, d.datum, null);
                  }}
                  className={`min-h-[3.5rem] min-w-0 cursor-pointer border-b border-l border-slate-100 p-0.5 md:min-h-[7rem] ${d.vMesici ? "" : "bg-slate-50 text-slate-400"} ${nad === d.datum ? "bg-blue-100" : ""} ${vybranyDen === d.datum ? "ring-2 ring-inset ring-blue-400" : ""}`}
                >
                  <div className={`mb-0.5 text-right text-xs ${d.datum === dnesni ? "font-bold text-blue-700" : ""}`}>{d.den}</div>
                  {/* telefon: barevné tečky */}
                  <div className="flex flex-wrap gap-0.5 md:hidden">
                    {polozky.slice(0, 6).map((p) => (
                      <span key={p.id} className="h-2 w-2 rounded-full" style={{ background: ucty.get(p.account_id)?.color ?? "#64748b" }} />
                    ))}
                    {polozky.length > 6 && <span className="text-[9px]">+{polozky.length - 6}</span>}
                  </div>
                  {/* počítač: kartičky */}
                  <div className="hidden space-y-0.5 md:block">
                    {viditelne.map((p) => (
                      <KartaPrispevku key={p.id} p={p} ucet={ucty.get(p.account_id)} urls={urls} kompaktni />
                    ))}
                    {polozky.length > MAX_V_BUNCE && (
                      <button
                        type="button"
                        className="w-full text-left text-[10px] text-blue-700 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRozbalene((s) => {
                            const n = new Set(s);
                            if (n.has(d.datum)) n.delete(d.datum);
                            else n.add(d.datum);
                            return n;
                          });
                        }}
                      >
                        {vse ? "méně" : `+ dalších ${polozky.length - MAX_V_BUNCE}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {vybranyDen && (
        <div className="rounded-lg border border-slate-200 bg-white p-2 md:hidden">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium">
              {Number(vybranyDen.slice(8, 10))}. {Number(vybranyDen.slice(5, 7))}.
            </span>
            <button type="button" className="text-xs text-blue-600" onClick={() => novy(vybranyDen, null)}>
              + přidat
            </button>
          </div>
          <div className="space-y-1">
            {(podleDne.get(vybranyDen) ?? []).length === 0 && <p className="text-xs text-slate-400">nic naplánováno</p>}
            {(podleDne.get(vybranyDen) ?? []).map((p) => (
              <KartaPrispevku key={p.id} p={p} ucet={ucty.get(p.account_id)} urls={urls} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
