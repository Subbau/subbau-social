"use client";

import { useState } from "react";
import type { PostWithMedia, SocialAccount } from "@/lib/db-types";
import { dnes, APP_TZ } from "@/lib/cas";
import { HODINY, NAZVY_DNU, bunkaTydne, dnyTydne, klicBunky, seskup } from "@/lib/mrizka";
import { DND_TYP, KartaPrispevku } from "./KartaPrispevku";

type Props = {
  datum: string;
  prispevky: PostWithMedia[];
  ucty: Map<string, SocialAccount>;
  urls: Record<string, string>;
  priPusteni: (postId: string, datum: string, hodina: number | null) => void;
  novy: (datum: string, hodina: number | null) => void;
};

function Bunka({
  datum,
  hodina,
  children,
  priPusteni,
  novy,
  className = "",
}: {
  datum: string;
  hodina: number | null;
  children: React.ReactNode;
  priPusteni: Props["priPusteni"];
  novy: Props["novy"];
  className?: string;
}) {
  const [nad, setNad] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Nový příspěvek ${datum}${hodina != null ? ` ${hodina}:00` : ""}`}
      onClick={() => novy(datum, hodina)}
      onKeyDown={(e) => {
        if (e.key === "Enter") novy(datum, hodina);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYP)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setNad(true);
        }
      }}
      onDragLeave={() => setNad(false)}
      onDrop={(e) => {
        e.preventDefault();
        setNad(false);
        const id = e.dataTransfer.getData(DND_TYP);
        if (id) priPusteni(id, datum, hodina);
      }}
      className={`cursor-pointer ${nad ? "bg-blue-100" : "hover:bg-slate-50"} ${className}`}
    >
      {children}
    </div>
  );
}

export function TydenniMrizka({ datum, prispevky, ucty, urls, priPusteni, novy }: Props) {
  const dny = dnyTydne(datum);
  const dnesni = dnes(APP_TZ);
  const podleBunky = seskup(prispevky, (p) => {
    if (!p.scheduled_at) return null;
    const b = bunkaTydne(p.scheduled_at, APP_TZ);
    return klicBunky(b.datum, b.hodina);
  });
  const podleDne = seskup(prispevky, (p) => (p.scheduled_at ? bunkaTydne(p.scheduled_at, APP_TZ).datum : null));

  return (
    <>
      {/* počítač: mřížka dny × hodiny */}
      <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-slate-200 text-xs">
          <div />
          {dny.map((d, i) => (
            <div key={d.datum} className={`px-1 py-1.5 text-center ${d.datum === dnesni ? "bg-blue-50 font-semibold text-blue-700" : ""}`}>
              {NAZVY_DNU[i]} {d.den}. {Number(d.datum.slice(5, 7))}.
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] text-xs">
          {HODINY.map((h) => (
            <div key={h} className="contents">
              <div className="border-b border-slate-100 px-1 py-1 text-right text-slate-400 tabular-nums">
                {h === HODINY[0] ? `≤${h}:00` : `${h}:00`}
              </div>
              {dny.map((d) => (
                <Bunka
                  key={d.datum}
                  datum={d.datum}
                  hodina={h}
                  priPusteni={priPusteni}
                  novy={novy}
                  className={`min-h-[2.5rem] space-y-0.5 border-b border-l border-slate-100 p-0.5 ${d.datum === dnesni ? "bg-blue-50/40" : ""}`}
                >
                  {(podleBunky.get(klicBunky(d.datum, h)) ?? []).map((p) => (
                    <KartaPrispevku key={p.id} p={p} ucet={ucty.get(p.account_id)} urls={urls} />
                  ))}
                </Bunka>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* telefon: dny pod sebou (žádný vodorovný posuv) */}
      <div className="space-y-2 md:hidden">
        {dny.map((d, i) => {
          const polozky = podleDne.get(d.datum) ?? [];
          return (
            <Bunka
              key={d.datum}
              datum={d.datum}
              hodina={null}
              priPusteni={priPusteni}
              novy={novy}
              className={`rounded-lg border bg-white p-2 ${d.datum === dnesni ? "border-blue-400" : "border-slate-200"}`}
            >
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">
                  {NAZVY_DNU[i]} {d.den}. {Number(d.datum.slice(5, 7))}.
                </span>
                <span className="text-xs text-blue-600">+ přidat</span>
              </div>
              <div className="space-y-1">
                {polozky.length === 0 && <p className="text-xs text-slate-400">nic naplánováno</p>}
                {polozky.map((p) => (
                  <KartaPrispevku key={p.id} p={p} ucet={ucty.get(p.account_id)} urls={urls} />
                ))}
              </div>
            </Bunka>
          );
        })}
      </div>
    </>
  );
}
