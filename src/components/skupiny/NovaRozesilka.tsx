"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FbGroup, MediaAsset, TextSnippet } from "@/lib/db-types";
import { APP_TZ, formatVPasmu, mistniNaUtc, utcNaMistni } from "@/lib/cas";
import { nactiSkupiny, zalozRozesilku } from "@/lib/data/skupiny";
import { useUcty } from "@/lib/data/ucty";
import { supabase } from "@/lib/supabase/client";
import { KLIC_PREDVYPLNENI, rozbalPredvyplneni } from "@/lib/skupiny/predvyplneni";
import { rozpisDavek, seradProRozesilku, zkontrolujRozesilku } from "@/lib/skupiny/rozpis";
import { Hlaska, Nacitani, Nadpis, Tlacitko, textChyby } from "../ui";
import { NavSkupin } from "./NavSkupin";
import { MediaRozesilky } from "./MediaRozesilky";

function vychoziStart(): { datum: string; cas: string } {
  const za = new Date(Date.now() + 15 * 60_000);
  const m = utcNaMistni(za, APP_TZ);
  const min = Math.ceil(m.minuta / 15) * 15;
  const d = mistniNaUtc(m.datum, `${m.hodina}:00`, APP_TZ);
  return utcNaMistni(new Date(d.getTime() + min * 60_000), APP_TZ);
}

export function NovaRozesilka() {
  const router = useRouter();
  const ucty = useUcty();
  const [skupiny, setSkupiny] = useState<FbGroup[]>([]);
  const [sablony, setSablony] = useState<TextSnippet[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [title, setTitle] = useState("");
  const [varianty, setVarianty] = useState<string[]>([""]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [vybrane, setVybrane] = useState<Set<string>>(new Set());
  const [sada, setSada] = useState("");
  const [start, setStart] = useState(vychoziStart);
  const [batchSize, setBatchSize] = useState(20);
  const [interval, setIntervalMin] = useState(120);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ukladam, setUkladam] = useState(false);
  const [zkusenoOdeslat, setZkusenoOdeslat] = useState(false);

  useEffect(() => {
    let platne = true;
    (async () => {
      try {
        const [s, t] = await Promise.all([nactiSkupiny(), supabase().from("text_snippets").select("*").order("title")]);
        if (!platne) return;
        setSkupiny(s);
        setSablony(t.data ?? []);
        // předvyplnění z editoru příspěvku („Poslat i do skupin“)
        const p = rozbalPredvyplneni(sessionStorage.getItem(KLIC_PREDVYPLNENI));
        if (p) {
          sessionStorage.removeItem(KLIC_PREDVYPLNENI);
          setVarianty([p.text]);
          if (p.assetIds.length) {
            const { data } = await supabase().from("media_assets").select("*").in("id", p.assetIds);
            const podleId = new Map((data ?? []).map((m) => [m.id, m]));
            if (platne) setMedia(p.assetIds.map((id) => podleId.get(id)).filter((m): m is MediaAsset => Boolean(m)));
          }
        }
      } catch (e) {
        if (platne) setChyba(textChyby(e));
      } finally {
        if (platne) setNacitam(false);
      }
    })();
    return () => {
      platne = false;
    };
  }, []);

  const vsechnySady = useMemo(() => [...new Set(skupiny.flatMap((s) => s.sady))].sort((a, b) => a.localeCompare(b, "cs")), [skupiny]);
  const viditelne = skupiny.filter((s) => !sada || s.sady.includes(sada));
  const poradi = useMemo(() => seradProRozesilku(skupiny.filter((s) => vybrane.has(s.id) && s.is_active)), [skupiny, vybrane]);
  const startsAt = useMemo(() => {
    try {
      return start.datum && start.cas ? mistniNaUtc(start.datum, start.cas, APP_TZ) : null;
    } catch {
      return null;
    }
  }, [start]);
  const chyby = zkontrolujRozesilku({
    title,
    variants: varianty,
    groupIds: poradi.map((s) => s.id),
    batchSize,
    intervalMinut: interval,
    startsAt,
    ted: new Date(),
  });
  const rozpis = useMemo(() => {
    if (!startsAt || poradi.length === 0) return [];
    try {
      return rozpisDavek(poradi, Math.max(1, Math.min(3, varianty.length)), startsAt, batchSize, interval);
    } catch {
      return [];
    }
  }, [poradi, varianty.length, startsAt, batchSize, interval]);

  function prepni(id: string) {
    setVybrane((v) => {
      const n = new Set(v);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function odeslat() {
    setZkusenoOdeslat(true);
    if (chyby.length || !startsAt) return;
    setUkladam(true);
    setChyba(null);
    try {
      await zalozRozesilku({
        title: title.trim(),
        variants: varianty.map((v) => v.trim()),
        assetIds: media.map((m) => m.id),
        groupIds: poradi.map((s) => s.id),
        startsAt,
        batchSize,
        intervalMinut: interval,
      });
      router.push("/skupiny/kampane");
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setUkladam(false);
    }
  }

  if (nacitam) return <Nacitani />;

  return (
    <div className="space-y-4 pb-10">
      <NavSkupin />
      <Nadpis>Nová rozesílka do skupin</Nadpis>
      <div>
        <label className="stitek-pole" htmlFor="r-nazev">Název (jen pro vás)</label>
        <input id="r-nazev" className="pole" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nábor zedníci říjen" />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="stitek-pole">Varianty textu ({varianty.length}/3) — střídají se po skupinách</span>
          {varianty.length < 3 && <Tlacitko onClick={() => setVarianty([...varianty, ""])}>+ varianta</Tlacitko>}
        </div>
        {varianty.map((v, i) => (
          <div key={i} className="space-y-1 rounded-md border border-slate-200 bg-white p-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">Varianta {String.fromCharCode(65 + i)}</span>
              {sablony.length > 0 && (
                <select
                  aria-label="Vložit šablonu"
                  className="pole w-auto py-0.5 text-xs"
                  value=""
                  onChange={(e) => {
                    const s = sablony.find((x) => x.id === e.target.value);
                    if (s) setVarianty(varianty.map((x, j) => (j === i ? (x ? `${x}\n${s.body}` : s.body) : x)));
                  }}
                >
                  <option value="">Vložit šablonu…</option>
                  {sablony.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              )}
              {varianty.length > 1 && (
                <button type="button" className="ml-auto text-red-700" onClick={() => setVarianty(varianty.filter((_, j) => j !== i))}>
                  odebrat
                </button>
              )}
            </div>
            <textarea
              rows={6}
              className="pole"
              value={v}
              aria-label={`Varianta ${i + 1}`}
              onChange={(e) => setVarianty(varianty.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </div>
        ))}
      </section>

      <MediaRozesilky media={media} ucty={ucty.data} zmena={setMedia} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="stitek-pole" htmlFor="r-sada">Sada</label>
            <select id="r-sada" className="pole" value={sada} onChange={(e) => setSada(e.target.value)}>
              <option value="">Všechny skupiny</option>
              {vsechnySady.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <Tlacitko onClick={() => setVybrane(new Set([...vybrane, ...viditelne.filter((s) => s.is_active).map((s) => s.id)]))}>
            Vybrat vše aktivní
          </Tlacitko>
          <Tlacitko onClick={() => setVybrane(new Set())}>Zrušit výběr</Tlacitko>
          <span className="pb-1.5 text-sm text-slate-600">Vybráno: {poradi.length}</span>
        </div>
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm">
          {viditelne.map((s) => (
            <li key={s.id}>
              <label className={`flex items-center gap-2 px-3 py-1.5 ${s.is_active ? "" : "text-slate-400"}`}>
                <input type="checkbox" disabled={!s.is_active} checked={vybrane.has(s.id) && s.is_active} onChange={() => prepni(s.id)} />
                <span className="min-w-0 flex-1 break-words">{s.name}</span>
                {!s.is_active && <span className="text-xs">neaktivní</span>}
              </label>
            </li>
          ))}
          {viditelne.length === 0 && <li className="px-3 py-2 text-slate-500">Žádné skupiny — nejdřív je importujte.</li>}
        </ul>
        <p className="text-xs text-slate-500">Pořadí: nejdřív skupiny, kam se nejdéle (nebo vůbec) neposílalo.</p>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className="stitek-pole" htmlFor="r-datum">Začátek — datum</label>
          <input id="r-datum" type="date" className="pole" value={start.datum} onChange={(e) => setStart({ ...start, datum: e.target.value })} />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="r-cas">čas</label>
          <input id="r-cas" type="time" className="pole" value={start.cas} onChange={(e) => setStart({ ...start, cas: e.target.value })} />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="r-davka">Skupin v dávce</label>
          <input id="r-davka" type="number" min={1} max={100} className="pole" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="r-odstup">Odstup dávek (min)</label>
          <input id="r-odstup" type="number" min={15} max={1440} step={15} className="pole" value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))} />
        </div>
      </section>

      {rozpis.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <h2 className="mb-1 font-medium">Rozpis ({rozpis.length} dávek)</h2>
          <ol className="space-y-0.5 text-xs">
            {rozpis.map((d) => (
              <li key={d.batchNo}>
                Dávka {d.batchNo}: {formatVPasmu(d.dueAt, "EEEEEE d. M. H:mm")} — {d.ukoly.length} skupin
              </li>
            ))}
          </ol>
        </section>
      )}

      {zkusenoOdeslat && chyby.length > 0 && <Hlaska typ="chyba">{chyby.join(" ")}</Hlaska>}
      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
      <div className="flex justify-end">
        <Tlacitko varianta="primarni" onClick={() => void odeslat()} disabled={ukladam}>
          {ukladam ? "Zakládám…" : "Založit rozesílku"}
        </Tlacitko>
      </div>
    </div>
  );
}
