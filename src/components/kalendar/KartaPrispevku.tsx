"use client";

import Link from "next/link";
import type { PostWithMedia, SocialAccount } from "@/lib/db-types";
import { APP_TZ, utcNaMistni } from "@/lib/cas";
import { serazenaMedia } from "@/lib/data/prispevky";
import { STAVY, lzeUpravit } from "@/lib/stavy";
import { MediumNahled } from "../media/MediumNahled";

export const DND_TYP = "application/x-subbau-post";

export function KartaPrispevku({
  p,
  ucet,
  urls,
  kompaktni = false,
}: {
  p: PostWithMedia;
  ucet: SocialAccount | undefined;
  urls: Record<string, string>;
  /** v měsíci jen proužek s časem */
  kompaktni?: boolean;
}) {
  const barva = ucet?.color ?? "#64748b";
  const cas = p.scheduled_at ? utcNaMistni(p.scheduled_at, APP_TZ).cas : "—";
  const media = serazenaMedia(p);
  const prvni = media[0];
  const stav = STAVY[p.status];
  const tahnout = lzeUpravit(p.status);
  const popis = `${ucet?.name ?? "?"} · ${cas} · ${stav.nazev}${p.series_id ? " · opakování" : ""}\n${p.caption.slice(0, 200)}`;

  return (
    <Link
      href={`/prispevky/${p.id}`}
      draggable={tahnout}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYP, p.id);
        e.dataTransfer.setData("text/plain", p.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => e.stopPropagation()}
      title={popis}
      className={`block min-w-0 overflow-hidden rounded border-l-4 bg-white text-[11px] leading-tight shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 ${tahnout ? "cursor-grab active:cursor-grabbing" : ""} ${p.status === "draft" ? "opacity-80 [border-left-style:dashed]" : ""} ${p.status === "failed" ? "ring-red-400" : ""}`}
      style={{ borderLeftColor: barva, background: `color-mix(in srgb, ${barva} 8%, white)` }}
    >
      <div className="flex items-center gap-1 px-1 pt-0.5">
        <span className="font-semibold tabular-nums">{cas}</span>
        <span className={`ml-auto rounded px-0.5 ${stav.trida}`} aria-label={stav.nazev}>
          {stav.ikona}
        </span>
        {p.series_id && <span title="Výskyt opakování">↻</span>}
      </div>
      {!kompaktni && (
        <div className="flex gap-1 px-1 pb-1">
          {prvni && <MediumNahled asset={prvni} urls={urls} className="h-8 w-8 shrink-0 rounded-sm" />}
          <span className="line-clamp-2 min-w-0 break-words text-slate-700">
            {p.caption.trim() ? p.caption.slice(0, 80) : <em className="text-slate-400">bez textu</em>}
          </span>
        </div>
      )}
    </Link>
  );
}
