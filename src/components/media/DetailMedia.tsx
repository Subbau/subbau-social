"use client";

import { useEffect, useState } from "react";
import type { MediaAsset, SocialAccount } from "@/lib/db-types";
import { usePodepsane } from "@/lib/data/podpisy";
import { hezkyCas } from "@/lib/cas";
import { smazMedium } from "@/lib/nahravani";
import { supabase } from "@/lib/supabase/client";
import { Hlaska, Modal, Tlacitko, textChyby } from "../ui";

function velikost(b: number | null): string {
  if (b == null) return "?";
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} kB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function DetailMedia({
  asset,
  ucty,
  zavrit,
  poZmene,
}: {
  asset: MediaAsset;
  ucty: SocialAccount[];
  zavrit: () => void;
  /** null = smazáno */
  poZmene: (a: MediaAsset | null) => void;
}) {
  const urls = usePodepsane([asset.storage_path]);
  const url = urls[asset.storage_path];
  const [stitky, setStitky] = useState(asset.tags.join(", "));
  const [ucet, setUcet] = useState(asset.account_id ?? "");
  const [pouziti, setPouziti] = useState<number | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);

  useEffect(() => {
    let platne = true;
    supabase()
      .from("post_media")
      .select("post_id", { count: "exact", head: true })
      .eq("asset_id", asset.id)
      .then(({ count }) => {
        if (platne) setPouziti(count ?? 0);
      });
    return () => {
      platne = false;
    };
  }, [asset.id]);

  async function ulozit() {
    setPracuji(true);
    setChyba(null);
    try {
      const tags = stitky.split(",").map((s) => s.trim()).filter(Boolean);
      const { data, error } = await supabase()
        .from("media_assets")
        .update({ tags, account_id: ucet || null })
        .eq("id", asset.id)
        .select("*")
        .single();
      if (error) throw error;
      poZmene(data);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  async function smazat() {
    if (!confirm("Opravdu smazat médium z knihovny?")) return;
    setPracuji(true);
    setChyba(null);
    try {
      await smazMedium(asset);
      poZmene(null);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  return (
    <Modal otevreno zavrit={zavrit} nadpis={asset.original_name ?? "Médium"} siroky>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex items-center justify-center rounded bg-slate-100">
          {url ? (
            asset.kind === "video" ? (
              <video src={url} controls className="max-h-[60vh] w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- podepsaná URL
              <img src={url} alt="" className="max-h-[60vh] w-full object-contain" />
            )
          ) : (
            <p className="p-8 text-sm text-slate-500">Načítám náhled…</p>
          )}
        </div>
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">Typ</dt>
            <dd>{asset.mime_type}</dd>
            <dt className="text-slate-500">Velikost</dt>
            <dd>{velikost(asset.size_bytes)}</dd>
            <dt className="text-slate-500">Rozměry</dt>
            <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "?"}</dd>
            {asset.kind === "video" && (
              <>
                <dt className="text-slate-500">Délka</dt>
                <dd>{asset.duration_seconds != null ? `${Number(asset.duration_seconds).toFixed(1)} s` : "?"}</dd>
              </>
            )}
            <dt className="text-slate-500">Nahráno</dt>
            <dd>{hezkyCas(asset.created_at)}</dd>
            <dt className="text-slate-500">Použito</dt>
            <dd>{pouziti == null ? "…" : `${pouziti}× v příspěvcích`}</dd>
            <dt className="text-slate-500">Otisk</dt>
            <dd className="truncate font-mono text-xs" title={asset.fingerprint}>{asset.fingerprint.slice(0, 16)}…</dd>
          </dl>
          <div>
            <label className="stitek-pole" htmlFor="det-ucet">Účet</label>
            <select id="det-ucet" className="pole" value={ucet} onChange={(e) => setUcet(e.target.value)}>
              <option value="">Sdílené</option>
              {ucty.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="stitek-pole" htmlFor="det-stitky">Štítky</label>
            <input id="det-stitky" className="pole" value={stitky} onChange={(e) => setStitky(e.target.value)} />
          </div>
          {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
          <div className="flex flex-wrap gap-2">
            <Tlacitko varianta="primarni" onClick={ulozit} disabled={pracuji}>Uložit</Tlacitko>
            <Tlacitko
              varianta="nebezpecne"
              onClick={smazat}
              disabled={pracuji || pouziti == null || pouziti > 0}
              title={pouziti ? "Používá se v příspěvcích" : undefined}
            >
              Smazat
            </Tlacitko>
          </div>
          {pouziti != null && pouziti > 0 && (
            <p className="text-xs text-slate-500">Smazat jde jen médium, které žádný příspěvek nepoužívá.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
