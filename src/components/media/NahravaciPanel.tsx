"use client";

import { useRef, useState } from "react";
import type { MediaAsset, SocialAccount } from "@/lib/db-types";
import { nahrajDoKnihovny } from "@/lib/nahravani";
import { LIMIT_NAHRAVANI_MB, rozdelPodleLimitu } from "@/lib/limit-nahravani";
import { textChyby } from "../ui";

type Polozka = { klic: string; nazev: string; podil: number; faze: string; chyba: string | null };

/** Nahrání více souborů naráz s průběhem. Soubory jdou postupně (šetří telefon i linku). */
export function NahravaciPanel({
  ucty,
  vychoziUcet = null,
  poNahrani,
}: {
  ucty: SocialAccount[];
  vychoziUcet?: string | null;
  poNahrani: (assets: MediaAsset[]) => void;
}) {
  const [ucet, setUcet] = useState<string>(vychoziUcet ?? "");
  const [stitky, setStitky] = useState("");
  const [polozky, setPolozky] = useState<Polozka[]>([]);
  const [bezi, setBezi] = useState(false);
  const [nadZonou, setNadZonou] = useState(false);
  const vstup = useRef<HTMLInputElement>(null);

  function uprav(klic: string, zmena: Partial<Polozka>) {
    setPolozky((p) => p.map((x) => (x.klic === klic ? { ...x, ...zmena } : x)));
  }

  async function nahraj(soubory: File[]) {
    if (!soubory.length || bezi) return;
    const tagy = stitky
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Soubory nad limit (kromě obrázků — ty až po převodu na JPEG) se odmítnou hned,
    // ostatní z dávky se nahrají normálně.
    const { kNahrani, odmitnute } = rozdelPodleLimitu(soubory);
    const ted = Date.now();
    const zamitnute: Polozka[] = odmitnute.map((o, i) => ({
      klic: `${ted}-x${i}-${o.soubor.name}`,
      nazev: o.soubor.name,
      podil: 0,
      faze: "chyba",
      chyba: o.hlaska,
    }));
    const nove: Polozka[] = kNahrani.map((s, i) => ({
      klic: `${ted}-${i}-${s.name}`,
      nazev: s.name,
      podil: 0,
      faze: "čeká",
      chyba: null,
    }));
    setPolozky((p) => [...zamitnute, ...nove, ...p]);
    if (kNahrani.length === 0) return;
    setBezi(true);
    const hotove: MediaAsset[] = [];
    for (let i = 0; i < kNahrani.length; i++) {
      const k = nove[i].klic;
      try {
        const v = await nahrajDoKnihovny(kNahrani[i], ucet || null, tagy, (podil, faze) => uprav(k, { podil, faze }));
        uprav(k, { podil: 1, faze: v.uzExistoval ? "už v knihovně (použije se existující)" : "hotovo" });
        hotove.push(v.asset);
      } catch (e) {
        uprav(k, { chyba: textChyby(e), faze: "chyba" });
      }
    }
    setBezi(false);
    if (hotove.length) poNahrani(hotove);
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="stitek-pole" htmlFor="nahrat-ucet">Patří k účtu</label>
          <select id="nahrat-ucet" className="pole" value={ucet} onChange={(e) => setUcet(e.target.value)}>
            <option value="">Sdílené (všechny účty)</option>
            {ucty.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="stitek-pole" htmlFor="nahrat-stitky">Štítky (oddělit čárkou)</label>
          <input id="nahrat-stitky" className="pole" value={stitky} onChange={(e) => setStitky(e.target.value)} placeholder="stavba, tým" />
        </div>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setNadZonou(true);
        }}
        onDragLeave={() => setNadZonou(false)}
        onDrop={(e) => {
          e.preventDefault();
          setNadZonou(false);
          void nahraj(Array.from(e.dataTransfer.files));
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center text-sm ${nadZonou ? "border-blue-500 bg-blue-50" : "border-slate-300"}`}
      >
        <p className="text-slate-600">Přetáhněte sem fotky a videa, nebo</p>
        <button
          type="button"
          disabled={bezi}
          onClick={() => vstup.current?.click()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Vybrat soubory
        </button>
        <input
          ref={vstup}
          type="file"
          multiple
          accept="image/*,video/*,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            void nahraj(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <p className="text-xs text-slate-500">
          Limit {LIMIT_NAHRAVANI_MB.toLocaleString("cs-CZ")} MB na soubor. Obrázky se převedou na JPEG. Velká videa se nahrávají po částech.
        </p>
      </div>
      {polozky.length > 0 && (
        <ul className="space-y-1.5">
          {polozky.map((p) => (
            <li key={p.klic} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate">{p.nazev}</span>
                <span className={p.chyba ? "text-red-700" : "text-slate-500"}>
                  {p.chyba ? p.chyba : `${p.faze}${p.faze === "nahrávám" ? ` ${Math.round(p.podil * 100)} %` : ""}`}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-200">
                <div
                  className={`h-full ${p.chyba ? "bg-red-500" : "bg-blue-600"}`}
                  style={{ width: `${Math.round((p.chyba ? 1 : p.podil) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
