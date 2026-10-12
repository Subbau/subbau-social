"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MediaAsset, PostFormat } from "@/lib/db-types";
import { hezkyCas } from "@/lib/cas";
import { hashProPrispevek, najdiDuplicity } from "@/lib/data/prispevky";
import { STAVY } from "@/lib/stavy";
import { vetyUpozorneni, type NalezenaDuplicita } from "@/lib/duplicity";

export { blokujeDuplicita, type NalezenaDuplicita } from "@/lib/duplicity";

const ZADNE: NalezenaDuplicita[] = [];

/** Hledá příspěvky téhož účtu se stejným content_hash za 30 dní (s prodlevou při psaní). */
export function useDuplicity(
  postId: string | null,
  seriesId: string | null,
  accountId: string,
  format: PostFormat,
  caption: string,
  media: MediaAsset[],
): NalezenaDuplicita[] {
  const [nalezene, setNalezene] = useState<NalezenaDuplicita[]>(ZADNE);
  const otisky = media.map((m) => m.fingerprint).join(",");
  useEffect(() => {
    if (!caption.trim() && !otisky) return;
    let platne = true;
    const t = setTimeout(async () => {
      try {
        const hash = await hashProPrispevek(accountId, format, caption, media);
        const d = await najdiDuplicity(accountId, hash, { id: postId, series_id: seriesId });
        if (platne) setNalezene(d);
      } catch {
        if (platne) setNalezene(ZADNE);
      }
    }, 700);
    return () => {
      platne = false;
      clearTimeout(t);
    };
    // media se porovnávají přes otisky
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, seriesId, accountId, format, caption, otisky]);
  return !caption.trim() && !otisky ? ZADNE : nalezene;
}

export function UpozorneniDuplicita({
  nalezene,
  povoleno,
  jenCteni,
  prepni,
}: {
  nalezene: NalezenaDuplicita[];
  povoleno: boolean;
  jenCteni: boolean;
  prepni: (ano: boolean) => void;
}) {
  if (nalezene.length === 0) return null;
  const zastavi = nalezene.some((d) => d.druh === "zastavi");
  const vety = vetyUpozorneni(nalezene, povoleno);
  return (
    <div className={`rounded-md border p-3 text-sm ${zastavi && !povoleno ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
      <p className="mb-1 font-medium">Stejný obsah na tomto účtu za posledních 30 dní:</p>
      <ul className="mb-2 space-y-1">
        {nalezene.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
            <Link href={`/prispevky/${d.id}`} className="text-blue-700 underline">
              {d.last_error_code === "unknown_outcome" ? "Nejistý výsledek" : STAVY[d.status].nazev} ·{" "}
              {hezkyCas(d.published_at ?? d.scheduled_at)}
            </Link>
            {d.external_url && (
              <a href={d.external_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                na síti ↗
              </a>
            )}
            <span className="truncate text-slate-500">{d.caption.slice(0, 60)}</span>
          </li>
        ))}
      </ul>
      {vety.map((v) => (
        <p key={v} className={`mb-2 text-xs ${zastavi ? "text-red-800" : "text-amber-900"}`}>{v}</p>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={povoleno} disabled={jenCteni} onChange={(e) => prepni(e.target.checked)} />
        Opravdu zveřejnit znovu
      </label>
    </div>
  );
}
