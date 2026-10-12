"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PostSeries, PostWithMedia } from "@/lib/db-types";
import { APP_TZ, dnes, pridejDny, pridejMesice, rozlozDatum, pondeli } from "@/lib/cas";
import { casNovehoPrispevku, casPoPretazeni, dnyTydne, NAZVY_MESICU, rozsahMesice, rozsahTydne } from "@/lib/mrizka";
import {
  idSablon,
  kopirujTyden,
  nactiPrispevkyVRozsahu,
  nactiSerie,
  presunPrispevek,
  serazenaMedia,
} from "@/lib/data/prispevky";
import { mapaUctu, useUcty } from "@/lib/data/ucty";
import { usePodepsane } from "@/lib/data/podpisy";
import { jeNejistyVysledek } from "@/lib/akce";
import { lzeUpravit } from "@/lib/stavy";
import { textPotvrzeniKopie } from "@/lib/kopirovani";
import { useUlozenaMnozina } from "@/lib/ulozene";
import { Hlaska, Tlacitko, UcetStitek, textChyby } from "../ui";
import { TydenniMrizka } from "./TydenniMrizka";
import { MesicniMrizka } from "./MesicniMrizka";

const KLIC_SKRYTE = "kalendar-skryte-ucty";

function platneDatum(x: string | null): string | null {
  return x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null;
}

export function Kalendar() {
  const router = useRouter();
  const cesta = usePathname();
  const params = useSearchParams();
  const pohled = params.get("pohled") === "mesic" ? "mesic" : "tyden";
  const datum = platneDatum(params.get("datum")) ?? dnes(APP_TZ);

  const ucty = useUcty();
  const uctyMapa = useMemo(() => mapaUctu(ucty.data), [ucty.data]);
  const [skryte, prepniUcet] = useUlozenaMnozina(KLIC_SKRYTE);
  const [prispevky, setPrispevky] = useState<PostWithMedia[]>([]);
  const [serie, setSerie] = useState<PostSeries[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [zprava, setZprava] = useState<string | null>(null);
  const [verze, setVerze] = useState(0);
  const [kopiruji, setKopiruji] = useState(false);

  const rozsah = useMemo(() => {
    if (pohled === "tyden") return rozsahTydne(datum, APP_TZ);
    const { rok, mesic } = rozlozDatum(datum);
    return rozsahMesice(rok, mesic, APP_TZ);
  }, [pohled, datum]);

  useEffect(() => {
    let platne = true;
    (async () => {
      setNacitam(true);
      try {
        const [p, s] = await Promise.all([nactiPrispevkyVRozsahu(rozsah.od, rozsah.do), nactiSerie()]);
        if (!platne) return;
        setPrispevky(p);
        setSerie(s);
        setChyba(null);
      } catch (e) {
        if (platne) setChyba(textChyby(e));
      } finally {
        if (platne) setNacitam(false);
      }
    })();
    return () => {
      platne = false;
    };
  }, [rozsah, verze]);

  // stavy se mění samy (publikování) — obnovit při návratu do okna a každou minutu
  useEffect(() => {
    const obnov = () => setVerze((v) => v + 1);
    window.addEventListener("focus", obnov);
    const i = setInterval(obnov, 60_000);
    return () => {
      window.removeEventListener("focus", obnov);
      clearInterval(i);
    };
  }, []);

  const sablony = useMemo(() => idSablon(serie), [serie]);
  // Šablony opakování se v kalendáři neukazují (jsou to koncepty, které se samy nepublikují).
  const viditelne = useMemo(
    () => prispevky.filter((p) => !sablony.has(p.id) && !skryte.has(p.account_id)),
    [prispevky, sablony, skryte],
  );
  const urls = usePodepsane(
    viditelne.map((p) => {
      const m = serazenaMedia(p)[0];
      return m ? m.thumbnail_path ?? (m.kind === "image" ? m.storage_path : null) : null;
    }),
  );

  const nastavUrl = useCallback(
    (zmena: { pohled?: string; datum?: string }) => {
      const q = new URLSearchParams(params.toString());
      if (zmena.pohled) q.set("pohled", zmena.pohled);
      if (zmena.datum) q.set("datum", zmena.datum);
      router.replace(`${cesta}?${q.toString()}`, { scroll: false });
    },
    [params, router, cesta],
  );

  function posun(smer: number) {
    nastavUrl({ datum: pohled === "tyden" ? pridejDny(pondeli(datum), 7 * smer) : pridejMesice(datum, smer) });
  }

  function novy(d: string, hodina: number | null) {
    const kdy = casNovehoPrispevku(d, hodina, APP_TZ);
    router.push(`/prispevky/novy?cas=${encodeURIComponent(kdy.toISOString())}`);
  }

  async function priPusteni(postId: string, d: string, hodina: number | null) {
    const p = prispevky.find((x) => x.id === postId);
    if (!p || !lzeUpravit(p.status)) return;
    const novyCas = casPoPretazeni(p.scheduled_at, d, hodina, APP_TZ);
    if (p.scheduled_at && new Date(p.scheduled_at).getTime() === novyCas.getTime()) return;
    if (p.status !== "draft" && novyCas.getTime() <= Date.now()) {
      setZprava("Do minulosti naplánovat nejde.");
      return;
    }
    if (p.status === "failed") {
      const text = jeNejistyVysledek(p.last_error_code)
        ? "POZOR: nevíme, jestli příspěvek nevyšel. Nejdřív zkontrolujte stránku!\n\nPřesto přeplánovat a zařadit k publikaci?"
        : "Příspěvek skončil chybou. Přeplánovat ho a znovu zařadit k publikaci?";
      if (!confirm(text)) return;
    }
    const puvodni = prispevky;
    setPrispevky((ps) =>
      ps.map((x) =>
        x.id === postId
          ? { ...x, scheduled_at: novyCas.toISOString(), status: x.status === "failed" ? "scheduled" : x.status }
          : x,
      ),
    );
    try {
      await presunPrispevek(p, novyCas);
      setZprava(null);
    } catch (e) {
      setPrispevky(puvodni);
      setZprava(textChyby(e));
    }
  }

  async function zkopirovatTyden() {
    const r = rozsahTydne(datum, APP_TZ);
    const kandidati = prispevky.filter(
      (p) => (p.status === "draft" || p.status === "scheduled") && !sablony.has(p.id) && !p.series_id,
    );
    if (kandidati.length === 0) {
      setZprava("V tomto týdnu nejsou žádné koncepty ani naplánované příspěvky ke kopírování.");
      return;
    }
    if (!confirm(textPotvrzeniKopie(kandidati.length))) return;
    setKopiruji(true);
    try {
      const v = await kopirujTyden(r.od, r.do, kandidati, sablony, APP_TZ);
      const pres = v.preskoceno.filter((x) => x.duvod === "kopie už existuje").length;
      setZprava(
        `Vytvořeno ${v.vytvoreno} konceptů v příštím týdnu.${pres ? ` ${pres} už zkopírováno dřív, přeskočeno.` : ""}`,
      );
      nastavUrl({ datum: pridejDny(pondeli(datum), 7) });
    } catch (e) {
      setZprava(`Kopírování se nepovedlo: ${textChyby(e)}`);
    } finally {
      setKopiruji(false);
    }
  }

  const nadpis = (() => {
    if (pohled === "mesic") {
      const { rok, mesic } = rozlozDatum(datum);
      return `${NAZVY_MESICU[mesic - 1]} ${rok}`;
    }
    const dny = dnyTydne(datum);
    const a = rozlozDatum(dny[0].datum);
    const b = rozlozDatum(dny[6].datum);
    return `${a.den}. ${a.mesic}. – ${b.den}. ${b.mesic}. ${b.rok}`;
  })();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold first-letter:uppercase">{nadpis}</h1>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {(["tyden", "mesic"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => nastavUrl({ pohled: p })}
              className={`px-3 py-1.5 ${pohled === p ? "bg-slate-800 text-white" : "bg-white hover:bg-slate-50"}`}
            >
              {p === "tyden" ? "Týden" : "Měsíc"}
            </button>
          ))}
        </div>
        <Tlacitko onClick={() => posun(-1)} aria-label="Předchozí">←</Tlacitko>
        <Tlacitko onClick={() => nastavUrl({ datum: dnes(APP_TZ) })}>Dnes</Tlacitko>
        <Tlacitko onClick={() => posun(1)} aria-label="Další">→</Tlacitko>
        {pohled === "tyden" && (
          <Tlacitko onClick={zkopirovatTyden} disabled={kopiruji || nacitam}>
            {kopiruji ? "Kopíruji…" : "Zkopírovat týden"}
          </Tlacitko>
        )}
      </div>

      {ucty.data.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ucty.data.map((u) => (
            <UcetStitek key={u.id} ucet={u} aktivni={!skryte.has(u.id)} onClick={() => prepniUcet(u.id)} />
          ))}
        </div>
      )}

      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
      {ucty.chyba && <Hlaska typ="chyba">{ucty.chyba}</Hlaska>}
      {zprava && (
        <Hlaska typ="info">
          <div className="flex items-start justify-between gap-2">
            <span>{zprava}</span>
            <button type="button" onClick={() => setZprava(null)} aria-label="Zavřít">✕</button>
          </div>
        </Hlaska>
      )}
      {!ucty.nacitam && ucty.data.length === 0 && (
        <Hlaska typ="varovani">Zatím tu nejsou žádné účty. Nejdřív je načtěte v sekci Účty.</Hlaska>
      )}

      <div className={nacitam ? "opacity-60" : ""}>
        {pohled === "tyden" ? (
          <TydenniMrizka datum={datum} prispevky={viditelne} ucty={uctyMapa} urls={urls} priPusteni={priPusteni} novy={novy} />
        ) : (
          <MesicniMrizka datum={datum} prispevky={viditelne} ucty={uctyMapa} urls={urls} priPusteni={priPusteni} novy={novy} />
        )}
      </div>
      <p className="text-xs text-slate-500">
        Časy v pásmu Europe/Prague. Přetažením přeplánujete koncept, naplánovaný příspěvek nebo chybu.
        ↻ = výskyt opakování; šablony opakování najdete v Seznamu.
      </p>
    </div>
  );
}
