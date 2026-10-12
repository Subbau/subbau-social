"use client";

import { useState } from "react";
import type { MediaAsset, SocialAccount } from "@/lib/db-types";
import { usePodepsane } from "@/lib/data/podpisy";
import { KnihovnaMedii } from "../media/KnihovnaMedii";
import { MediumNahled } from "../media/MediumNahled";
import { Modal, Tlacitko } from "../ui";

const DND_MEDIUM = "application/x-subbau-medium";

export function MediaVarianty({
  media,
  ucet,
  ucty,
  jenCteni,
  zmena,
}: {
  media: MediaAsset[];
  ucet: SocialAccount;
  ucty: SocialAccount[];
  jenCteni: boolean;
  zmena: (media: MediaAsset[]) => void;
}) {
  const [knihovna, setKnihovna] = useState(false);
  const [tazeny, setTazeny] = useState<number | null>(null);
  const urls = usePodepsane(media.map((m) => m.thumbnail_path ?? (m.kind === "image" ? m.storage_path : null)));

  function presun(z: number, na: number) {
    if (z === na || na < 0 || na >= media.length) return;
    const n = [...media];
    const [x] = n.splice(z, 1);
    n.splice(na, 0, x);
    zmena(n);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="stitek-pole">Média ({media.length})</span>
        {!jenCteni && (
          <Tlacitko onClick={() => setKnihovna(true)} className="text-xs">
            + Přidat / nahrát
          </Tlacitko>
        )}
      </div>
      {media.length === 0 && <p className="text-xs text-slate-400">Bez médií.</p>}
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {media.map((m, i) => (
          <li
            key={`${m.id}-${i}`}
            draggable={!jenCteni}
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MEDIUM, String(i));
              e.dataTransfer.effectAllowed = "move";
              setTazeny(i);
            }}
            onDragEnd={() => setTazeny(null)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DND_MEDIUM)) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const z = Number(e.dataTransfer.getData(DND_MEDIUM));
              if (Number.isInteger(z)) presun(z, i);
              setTazeny(null);
            }}
            className={`relative aspect-square overflow-hidden rounded border border-slate-200 ${tazeny === i ? "opacity-40" : ""} ${jenCteni ? "" : "cursor-grab"}`}
            title={m.original_name ?? ""}
          >
            <MediumNahled asset={m} urls={urls} />
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
            {!jenCteni && (
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 text-xs text-white">
                <button type="button" aria-label="Posunout dopředu" className="px-1.5 py-0.5 disabled:opacity-30" disabled={i === 0} onClick={() => presun(i, i - 1)}>
                  ←
                </button>
                <button type="button" aria-label="Odebrat" className="px-1.5 py-0.5" onClick={() => zmena(media.filter((_, j) => j !== i))}>
                  ✕
                </button>
                <button type="button" aria-label="Posunout dozadu" className="px-1.5 py-0.5 disabled:opacity-30" disabled={i === media.length - 1} onClick={() => presun(i, i + 1)}>
                  →
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {media.length > 1 && !jenCteni && <p className="text-xs text-slate-500">Pořadí změníte přetažením nebo šipkami.</p>}
      <Modal otevreno={knihovna} zavrit={() => setKnihovna(false)} nadpis={`Média pro ${ucet.name}`} siroky>
        {knihovna && (
          <KnihovnaMedii
            ucty={ucty}
            vychoziRozsah={`ucet+sdilene:${ucet.id}`}
            vyber={{
              uzVybrane: media.map((m) => m.id),
              potvrdit: (vybrane) => {
                zmena([...media, ...vybrane]);
                setKnihovna(false);
              },
            }}
          />
        )}
      </Modal>
    </div>
  );
}
