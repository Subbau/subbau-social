"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaAsset, SocialAccount } from "@/lib/db-types";
import { usePodepsane } from "@/lib/data/podpisy";
import { supabase } from "@/lib/supabase/client";
import { Hlaska, Nacitani, Tlacitko, textChyby } from "../ui";
import { MediumNahled } from "./MediumNahled";
import { NahravaciPanel } from "./NahravaciPanel";
import { DetailMedia } from "./DetailMedia";

const STRANKA = 60;

/**
 * Mřížka knihovny. Režim „správa“ (stránka /media) otevírá detail,
 * režim „výběr“ (editor příspěvku) vrací vybrané položky v pořadí kliknutí.
 */
export function KnihovnaMedii({
  ucty,
  vychoziRozsah = "vse",
  vyber,
}: {
  ucty: SocialAccount[];
  vychoziRozsah?: string;
  vyber?: { potvrdit: (assets: MediaAsset[]) => void; uzVybrane?: string[] };
}) {
  const [rozsah, setRozsah] = useState(vychoziRozsah); // vse | sdilene | <account id> | ucet+sdilene:<id>
  const [druh, setDruh] = useState<"" | "image" | "video">("");
  const [stitek, setStitek] = useState("");
  const [hledat, setHledat] = useState("");
  const [polozky, setPolozky] = useState<MediaAsset[]>([]);
  const [konec, setKonec] = useState(false);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [verze, setVerze] = useState(0);
  const [detail, setDetail] = useState<MediaAsset | null>(null);
  const [vybrane, setVybrane] = useState<MediaAsset[]>([]);
  const [ukazNahravani, setUkazNahravani] = useState(false);

  const nacti = useCallback(
    async (od: number) => {
      setNacitam(true);
      try {
        let q = supabase().from("media_assets").select("*").order("created_at", { ascending: false });
        if (rozsah === "sdilene") q = q.is("account_id", null);
        else if (rozsah.startsWith("ucet+sdilene:")) {
          const id = rozsah.split(":")[1];
          q = q.or(`account_id.eq.${id},account_id.is.null`);
        } else if (rozsah !== "vse") q = q.eq("account_id", rozsah);
        if (druh) q = q.eq("kind", druh);
        if (stitek) q = q.contains("tags", [stitek]);
        if (hledat.trim()) q = q.ilike("original_name", `%${hledat.trim().replace(/[%_,()]/g, " ")}%`);
        const { data, error } = await q.range(od, od + STRANKA - 1);
        if (error) throw error;
        setPolozky((p) => (od === 0 ? data ?? [] : [...p, ...(data ?? [])]));
        setKonec((data ?? []).length < STRANKA);
        setChyba(null);
      } catch (e) {
        setChyba(textChyby(e));
      } finally {
        setNacitam(false);
      }
    },
    [rozsah, druh, stitek, hledat],
  );

  useEffect(() => {
    const t = setTimeout(() => void nacti(0), hledat ? 300 : 0);
    return () => clearTimeout(t);
  }, [nacti, verze, hledat]);

  const urls = usePodepsane(polozky.map((p) => p.thumbnail_path ?? (p.kind === "image" ? p.storage_path : null)));
  const vsechnyStitky = useMemo(() => [...new Set(polozky.flatMap((p) => p.tags))].sort(), [polozky]);
  const nazevUctu = useMemo(() => new Map(ucty.map((u) => [u.id, u.name])), [ucty]);
  const uzVybrane = new Set(vyber?.uzVybrane ?? []);

  function prepniVyber(a: MediaAsset) {
    setVybrane((v) => (v.some((x) => x.id === a.id) ? v.filter((x) => x.id !== a.id) : [...v, a]));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 sm:flex-none">
          <label className="stitek-pole" htmlFor="kn-rozsah">Účet</label>
          <select id="kn-rozsah" className="pole sm:w-56" value={rozsah} onChange={(e) => setRozsah(e.target.value)}>
            <option value="vse">Všechna média</option>
            <option value="sdilene">Jen sdílená</option>
            {ucty.map((u) => (
              <optgroup key={u.id} label={u.name}>
                <option value={u.id}>{u.name} — jen jeho</option>
                <option value={`ucet+sdilene:${u.id}`}>{u.name} + sdílená</option>
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="stitek-pole" htmlFor="kn-druh">Druh</label>
          <select id="kn-druh" className="pole" value={druh} onChange={(e) => setDruh(e.target.value as "" | "image" | "video")}>
            <option value="">Vše</option>
            <option value="image">Obrázky</option>
            <option value="video">Videa</option>
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label className="stitek-pole" htmlFor="kn-hledat">Název souboru</label>
          <input id="kn-hledat" className="pole" value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder="hledat…" />
        </div>
        <Tlacitko varianta="primarni" onClick={() => setUkazNahravani((x) => !x)}>
          {ukazNahravani ? "Skrýt nahrávání" : "Nahrát"}
        </Tlacitko>
      </div>

      {(vsechnyStitky.length > 0 || stitek) && (
        <div className="flex flex-wrap gap-1.5">
          {stitek && (
            <button type="button" onClick={() => setStitek("")} className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
              #{stitek} ✕
            </button>
          )}
          {vsechnyStitky
            .filter((s) => s !== stitek)
            .map((s) => (
              <button key={s} type="button" onClick={() => setStitek(s)} className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                #{s}
              </button>
            ))}
        </div>
      )}

      {ukazNahravani && (
        <NahravaciPanel
          ucty={ucty}
          vychoziUcet={rozsah.startsWith("ucet+sdilene:") ? rozsah.split(":")[1] : ucty.some((u) => u.id === rozsah) ? rozsah : null}
          poNahrani={(nove) => {
            setVerze((v) => v + 1);
            if (vyber) setVybrane((v) => [...v, ...nove.filter((n) => !v.some((x) => x.id === n.id))]);
          }}
        />
      )}

      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {polozky.map((a) => {
          const poradi = vybrane.findIndex((x) => x.id === a.id);
          const jizVPrispevku = uzVybrane.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => (vyber ? prepniVyber(a) : setDetail(a))}
              className={`group relative aspect-square overflow-hidden rounded-md border text-left ${poradi >= 0 ? "border-blue-600 ring-2 ring-blue-500" : "border-slate-200"}`}
              title={a.original_name ?? ""}
            >
              <MediumNahled asset={a} urls={urls} />
              <span className="absolute left-0 top-0 max-w-full truncate rounded-br bg-white/85 px-1 text-[10px] text-slate-700">
                {a.account_id ? nazevUctu.get(a.account_id) ?? "účet" : "sdílené"}
              </span>
              {poradi >= 0 && (
                <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {poradi + 1}
                </span>
              )}
              {jizVPrispevku && poradi < 0 && (
                <span className="absolute right-1 top-1 rounded bg-slate-800/70 px-1 text-[10px] text-white">už je</span>
              )}
            </button>
          );
        })}
      </div>
      {nacitam && <Nacitani />}
      {!nacitam && polozky.length === 0 && <p className="text-sm text-slate-500">Nic tu není.</p>}
      {!nacitam && !konec && (
        <Tlacitko onClick={() => void nacti(polozky.length)}>Načíst další</Tlacitko>
      )}

      {vyber && (
        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-slate-200 bg-white py-2">
          <span className="text-sm text-slate-600">Vybráno: {vybrane.length}</span>
          <Tlacitko varianta="primarni" disabled={!vybrane.length} onClick={() => vyber.potvrdit(vybrane)}>
            Přidat do příspěvku
          </Tlacitko>
        </div>
      )}

      {detail && (
        <DetailMedia
          asset={detail}
          ucty={ucty}
          zavrit={() => setDetail(null)}
          poZmene={(zmeneny) => {
            setDetail(null);
            if (zmeneny === null) setPolozky((p) => p.filter((x) => x.id !== detail.id));
            else setPolozky((p) => p.map((x) => (x.id === zmeneny.id ? zmeneny : x)));
          }}
        />
      )}
    </div>
  );
}
