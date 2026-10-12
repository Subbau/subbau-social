"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Platform, PostSeries } from "@/lib/db-types";
import { dnes, denVTydnu, rozlozDatum } from "@/lib/cas";
import { nactiSeriiProPrispevek, ukonciSerii, zalozSerii } from "@/lib/data/serie";
import {
  chybyPredOpakovanim,
  lzeZalozitOpakovani,
  popisOpakovani,
  radekSerie,
  zkontrolujOpakovani,
  type FormularOpakovani,
} from "@/lib/opakovani";
import { NAZVY_DNU } from "@/lib/mrizka";
import { Hlaska, Modal, Tlacitko, textChyby } from "../ui";
import type { Varianta } from "./typy";

/**
 * Opakování příspěvku. Šablona = tento příspěvek (zůstává konceptem),
 * výskyty vytváří DB funkcí generate_series_occurrences.
 */
export function OpakovaniPanel({
  v,
  platform,
  timezone,
  ulozitKoncept,
  poZmene,
}: {
  v: Varianta;
  platform: Platform;
  timezone: string;
  /** uloží variantu jako koncept a vrátí její id */
  ulozitKoncept: () => Promise<string | null>;
  poZmene: () => void;
}) {
  const [serie, setSerie] = useState<PostSeries | null>(null);
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [zprava, setZprava] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);
  const [verze, setVerze] = useState(0);
  const vychoziDatum = v.datum || dnes(timezone);
  const [f, setF] = useState<FormularOpakovani>({
    freq: "weekly",
    interval_n: 1,
    weekdays: [denVTydnu(vychoziDatum)],
    month_day: rozlozDatum(vychoziDatum).den,
    cas: v.cas || "09:00",
    starts_on: vychoziDatum,
    until_on: "",
  });

  useEffect(() => {
    if (!v.id) return;
    let platne = true;
    nactiSeriiProPrispevek(v.id, v.series_id)
      .then((s) => {
        if (platne) setSerie(s ?? null);
      })
      .catch(() => undefined);
    return () => {
      platne = false;
    };
  }, [v.id, v.series_id, verze]);

  const chybyFormulare = zkontrolujOpakovani(f);
  // Výskyty se vytvoří rovnou jako naplánované — obsah musí projít stejnými kontrolami jako „Naplánovat“.
  const chybyObsahu = chybyPredOpakovanim({
    platform,
    format: v.format,
    caption: v.caption,
    link_url: v.link_url.trim() || null,
    media: v.media,
  });

  async function zalozit() {
    if (chybyObsahu.length > 0) {
      setChyba(`Opakování nejde založit: ${chybyObsahu.join(" ")}`);
      return;
    }
    setPracuji(true);
    setChyba(null);
    try {
      const id = await ulozitKoncept();
      if (!id) throw new Error("Příspěvek se nepodařilo uložit.");
      const r = await zalozSerii(
        { id, status: "draft", platform_options: v.platform_options },
        radekSerie(f, v.account_id, id, timezone),
      );
      setZprava(`Opakování založeno, vytvořeno ${r.vytvoreno} naplánovaných výskytů.`);
      setOtevreno(false);
      setVerze((x) => x + 1);
      poZmene();
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  async function ukoncit() {
    if (!serie) return;
    if (!confirm("Ukončit opakování? Budoucí naplánované výskyty se smažou, zveřejněné zůstanou.")) return;
    setPracuji(true);
    setChyba(null);
    try {
      const n = await ukonciSerii(serie.id);
      setZprava(`Opakování ukončeno, smazáno ${n} budoucích výskytů.`);
      setVerze((x) => x + 1);
      poZmene();
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  const jeSablona = Boolean(serie && v.id && serie.template_post_id === v.id);
  const jeVyskyt = Boolean(v.series_id);
  // U šablony UKONČENÉ série jde opakování založit znovu (tak se mění čas série).
  const lzeZalozit = lzeZalozitOpakovani(v, serie);

  return (
    <div className="space-y-2">
      {serie && (
        <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm">
          <p className="font-medium">
            {jeSablona ? "Šablona opakování" : "Výskyt opakování"}
            {!serie.is_active && " (ukončeno)"}
          </p>
          <p className="text-violet-900">
            {popisOpakovani(serie)}, od {serie.starts_on}
            {serie.until_on ? ` do ${serie.until_on}` : ""}
          </p>
          {jeSablona && (
            <p className="mt-1 text-xs text-violet-800">
              Úpravy šablony se projeví jen u výskytů, které se teprve vytvoří. Šablona se sama nepublikuje a v kalendáři je skrytá.
            </p>
          )}
          {jeVyskyt && serie.template_post_id && (
            <Link href={`/prispevky/${serie.template_post_id}`} className="text-xs text-blue-700 underline">
              Otevřít šablonu
            </Link>
          )}
          {serie.is_active && (
            <div className="mt-2">
              <Tlacitko varianta="nebezpecne" onClick={ukoncit} disabled={pracuji}>
                Ukončit opakování
              </Tlacitko>
            </div>
          )}
        </div>
      )}
      {lzeZalozit && (
        <Tlacitko onClick={() => setOtevreno(true)}>↻ Opakovat…</Tlacitko>
      )}
      {zprava && <Hlaska typ="ok">{zprava}</Hlaska>}
      {chyba && !otevreno && <Hlaska typ="chyba">{chyba}</Hlaska>}

      <Modal otevreno={otevreno} zavrit={() => setOtevreno(false)} nadpis="Opakovat příspěvek">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-600">
            Tento příspěvek se uloží jako koncept a stane se šablonou. Výskyty se vytvoří jako naplánované na {8} týdnů dopředu
            a průběžně se doplňují. Stejný text se u opakování smí zveřejnit znovu.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="stitek-pole" htmlFor="op-freq">Jak často</label>
              <select id="op-freq" className="pole" value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value as FormularOpakovani["freq"] })}>
                <option value="weekly">týdně</option>
                <option value="monthly">měsíčně</option>
              </select>
            </div>
            <div>
              <label className="stitek-pole" htmlFor="op-int">Každý … {f.freq === "weekly" ? "týden" : "měsíc"}</label>
              <input id="op-int" type="number" min={1} className="pole" value={f.interval_n} onChange={(e) => setF({ ...f, interval_n: Number(e.target.value) })} />
            </div>
          </div>
          {f.freq === "weekly" ? (
            <fieldset>
              <legend className="stitek-pole">Dny v týdnu</legend>
              <div className="flex flex-wrap gap-1">
                {NAZVY_DNU.map((n, i) => {
                  const d = i + 1;
                  const ano = f.weekdays.includes(d);
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={ano}
                      onClick={() => setF({ ...f, weekdays: ano ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d] })}
                      className={`h-8 w-9 rounded border text-xs ${ano ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <div>
              <label className="stitek-pole" htmlFor="op-den">Den v měsíci</label>
              <input id="op-den" type="number" min={1} max={31} className="pole" value={f.month_day} onChange={(e) => setF({ ...f, month_day: Number(e.target.value) })} />
              <p className="mt-1 text-xs text-slate-500">Když měsíc den nemá (31.), vezme se poslední den měsíce.</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="stitek-pole" htmlFor="op-cas">Čas</label>
              <input id="op-cas" type="time" className="pole" value={f.cas} onChange={(e) => setF({ ...f, cas: e.target.value })} />
            </div>
            <div>
              <label className="stitek-pole" htmlFor="op-od">Od</label>
              <input id="op-od" type="date" className="pole" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />
            </div>
            <div>
              <label className="stitek-pole" htmlFor="op-do">Do (nepovinné)</label>
              <input id="op-do" type="date" className="pole" value={f.until_on} onChange={(e) => setF({ ...f, until_on: e.target.value })} />
            </div>
          </div>
          {chybyFormulare.length > 0 && <Hlaska typ="varovani">{chybyFormulare.join(" ")}</Hlaska>}
          {chybyObsahu.length > 0 && (
            <Hlaska typ="chyba">Příspěvek nejde opakovat, dokud neopravíte: {chybyObsahu.join(" ")}</Hlaska>
          )}
          {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
          <div className="flex justify-end gap-2">
            <Tlacitko onClick={() => setOtevreno(false)}>Zrušit</Tlacitko>
            <Tlacitko varianta="primarni" disabled={pracuji || chybyFormulare.length > 0 || chybyObsahu.length > 0} onClick={zalozit}>
              {pracuji ? "Ukládám…" : "Uložit a opakovat"}
            </Tlacitko>
          </div>
        </div>
      </Modal>
    </div>
  );
}
