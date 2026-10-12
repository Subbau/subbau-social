"use client";

import { useState } from "react";
import type { MediaAsset, SocialAccount } from "@/lib/db-types";
import { usePodepsane } from "@/lib/data/podpisy";
import { KnihovnaMedii } from "../media/KnihovnaMedii";
import { MediumNahled } from "../media/MediumNahled";
import { Hlaska, Modal, Tlacitko } from "../ui";

export function MediaRozesilky({
  media,
  ucty,
  zmena,
}: {
  media: MediaAsset[];
  ucty: SocialAccount[];
  zmena: (m: MediaAsset[]) => void;
}) {
  const [knihovna, setKnihovna] = useState(false);
  const urls = usePodepsane(media.map((m) => m.thumbnail_path ?? (m.kind === "image" ? m.storage_path : null)));
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="stitek-pole">Obrázek ({media.length})</span>
        <Tlacitko onClick={() => setKnihovna(true)}>+ Z knihovny / nahrát</Tlacitko>
      </div>
      {media.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {media.map((m, i) => (
            <li key={m.id} className="relative h-20 w-20 overflow-hidden rounded border border-slate-200">
              <MediumNahled asset={m} urls={urls} />
              <button
                type="button"
                aria-label="Odebrat"
                className="absolute right-0 top-0 bg-black/60 px-1 text-xs text-white"
                onClick={() => zmena(media.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {media.some((m) => m.kind === "video") && (
        <Hlaska typ="varovani">Video jde, ale do skupin se z telefonu sdílí hůř než obrázek (některé telefony ho do Facebooku nepředají).</Hlaska>
      )}
      {media.length > 1 && (
        <p className="text-xs text-slate-500">Ke sdílení z telefonu se nabídne první obrázek; ostatní si vyberete ve Facebooku sami.</p>
      )}
      <Modal otevreno={knihovna} zavrit={() => setKnihovna(false)} nadpis="Média pro rozesílku" siroky>
        {knihovna && (
          <KnihovnaMedii
            ucty={ucty}
            vyber={{
              uzVybrane: media.map((m) => m.id),
              potvrdit: (v) => {
                zmena([...media, ...v.filter((x) => !media.some((m) => m.id === x.id))]);
                setKnihovna(false);
              },
            }}
          />
        )}
      </Modal>
    </section>
  );
}
