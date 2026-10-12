"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Post, PostStatus } from "@/lib/db-types";
import { APP_TZ, dnes, hezkyCas, mistniNaUtc, posunOMistniDny, pridejDny } from "@/lib/cas";
import { idSablon, nactiSerie, prevedNaKoncept, zmenCas } from "@/lib/data/prispevky";
import { mapaUctu, useUcty } from "@/lib/data/ucty";
import { FORMATY_NAZEV, STAVY, lzeUpravit } from "@/lib/stavy";
import { oznamZmenu } from "@/lib/udalosti";
import { supabase } from "@/lib/supabase/client";
import { Hlaska, Nacitani, Nadpis, StavStitek, Tlacitko, textChyby } from "./ui";

const LIMIT = 300;
type Jednotka = "min" | "h" | "d";

export function Seznam() {
  const ucty = useUcty();
  const uctyMapa = useMemo(() => mapaUctu(ucty.data), [ucty.data]);
  const [stav, setStav] = useState<"" | PostStatus>("");
  const [ucet, setUcet] = useState("");
  const [od, setOd] = useState(() => pridejDny(dnes(APP_TZ), -30));
  const [do_, setDo] = useState("");
  const [bezCasu, setBezCasu] = useState(true);
  const [hledat, setHledat] = useState("");
  const [radky, setRadky] = useState<Post[]>([]);
  const [sablony, setSablony] = useState<Set<string>>(new Set());
  const [vybrane, setVybrane] = useState<Set<string>>(new Set());
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [zprava, setZprava] = useState<string | null>(null);
  const [verze, setVerze] = useState(0);
  const [posunO, setPosunO] = useState(1);
  const [jednotka, setJednotka] = useState<Jednotka>("d");
  const [pracuji, setPracuji] = useState(false);

  useEffect(() => {
    let platne = true;
    const t = setTimeout(async () => {
      setNacitam(true);
      try {
        let q = supabase().from("posts").select("*");
        if (stav) q = q.eq("status", stav);
        if (ucet) q = q.eq("account_id", ucet);
        if (hledat.trim()) q = q.ilike("caption", `%${hledat.trim().replace(/[%_]/g, " ")}%`);
        const casy: string[] = [];
        if (od) casy.push(`scheduled_at.gte.${mistniNaUtc(od, "00:00", APP_TZ).toISOString()}`);
        if (do_) casy.push(`scheduled_at.lt.${mistniNaUtc(pridejDny(do_, 1), "00:00", APP_TZ).toISOString()}`);
        if (casy.length) {
          const rozsah = casy.length === 1 ? casy[0] : `and(${casy.join(",")})`;
          q = bezCasu ? q.or(`scheduled_at.is.null,${rozsah}`) : q.or(rozsah);
        } else if (!bezCasu) {
          q = q.not("scheduled_at", "is", null);
        }
        const [{ data, error }, serie] = await Promise.all([
          q.order("scheduled_at", { ascending: true, nullsFirst: true }).limit(LIMIT),
          nactiSerie(),
        ]);
        if (error) throw error;
        if (!platne) return;
        setRadky(data ?? []);
        setSablony(idSablon(serie));
        setVybrane(new Set());
        setChyba(null);
      } catch (e) {
        if (platne) setChyba(textChyby(e));
      } finally {
        if (platne) setNacitam(false);
      }
    }, hledat ? 300 : 0);
    return () => {
      platne = false;
      clearTimeout(t);
    };
  }, [stav, ucet, od, do_, bezCasu, hledat, verze]);

  const vybraneRadky = radky.filter((r) => vybrane.has(r.id));
  const vse = radky.length > 0 && radky.every((r) => vybrane.has(r.id));

  function prepni(id: string) {
    setVybrane((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function hromadne(akce: "posun" | "koncept") {
    setPracuji(true);
    setZprava(null);
    const preskoceno: string[] = [];
    let hotovo = 0;
    for (const r of vybraneRadky) {
      try {
        if (akce === "koncept") {
          if (r.status !== "scheduled" && r.status !== "failed") {
            preskoceno.push(`${STAVY[r.status].nazev.toLowerCase()} nejde převést`);
            continue;
          }
          await prevedNaKoncept(r);
        } else {
          if (!lzeUpravit(r.status) || !r.scheduled_at) {
            preskoceno.push(r.scheduled_at ? `${STAVY[r.status].nazev.toLowerCase()} nejde posunout` : "bez času");
            continue;
          }
          const novy =
            jednotka === "d"
              ? posunOMistniDny(r.scheduled_at, posunO, APP_TZ)
              : new Date(new Date(r.scheduled_at).getTime() + posunO * (jednotka === "h" ? 3600_000 : 60_000));
          if (r.status !== "draft" && novy.getTime() <= Date.now()) {
            preskoceno.push("vyšlo by do minulosti");
            continue;
          }
          await zmenCas(r, novy);
        }
        hotovo++;
      } catch (e) {
        preskoceno.push(textChyby(e));
      }
    }
    setPracuji(false);
    oznamZmenu();
    setZprava(
      `Hotovo: ${hotovo}.${preskoceno.length ? ` Přeskočeno ${preskoceno.length}: ${[...new Set(preskoceno)].join("; ")}.` : ""}`,
    );
    setVerze((v) => v + 1);
  }

  return (
    <div className="space-y-3">
      <Nadpis>Seznam příspěvků</Nadpis>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <div>
          <label className="stitek-pole" htmlFor="s-stav">Stav</label>
          <select id="s-stav" className="pole" value={stav} onChange={(e) => setStav(e.target.value as "" | PostStatus)}>
            <option value="">Vše</option>
            {(Object.keys(STAVY) as PostStatus[]).map((s) => (
              <option key={s} value={s}>{STAVY[s].nazev}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="stitek-pole" htmlFor="s-ucet">Účet</label>
          <select id="s-ucet" className="pole" value={ucet} onChange={(e) => setUcet(e.target.value)}>
            <option value="">Všechny</option>
            {ucty.data.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="stitek-pole" htmlFor="s-od">Od</label>
          <input id="s-od" type="date" className="pole" value={od} onChange={(e) => setOd(e.target.value)} />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="s-do">Do</label>
          <input id="s-do" type="date" className="pole" value={do_} onChange={(e) => setDo(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="stitek-pole" htmlFor="s-hledat">Hledat v textu</label>
          <input id="s-hledat" className="pole" value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder="např. akce" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={bezCasu} onChange={(e) => setBezCasu(e.target.checked)} />
        i koncepty bez času
      </label>

      {vybrane.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-sm">
          <span className="font-medium">Vybráno {vybrane.size}:</span>
          <span>posunout o</span>
          <input type="number" className="pole w-20 py-1" value={posunO} onChange={(e) => setPosunO(Number(e.target.value))} aria-label="O kolik" />
          <select className="pole w-auto py-1" value={jednotka} onChange={(e) => setJednotka(e.target.value as Jednotka)} aria-label="Jednotka">
            <option value="min">minut</option>
            <option value="h">hodin</option>
            <option value="d">dní</option>
          </select>
          <Tlacitko onClick={() => void hromadne("posun")} disabled={pracuji || !posunO}>Posunout</Tlacitko>
          <Tlacitko onClick={() => void hromadne("koncept")} disabled={pracuji}>Převést na koncept</Tlacitko>
        </div>
      )}

      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
      {zprava && <Hlaska typ="info">{zprava}</Hlaska>}
      {nacitam && <Nacitani />}
      {!nacitam && radky.length === 0 && <p className="text-sm text-slate-500">Nic neodpovídá filtru.</p>}
      {!nacitam && radky.length >= LIMIT && (
        <Hlaska typ="varovani">Zobrazeno prvních {LIMIT} — zužte filtr.</Hlaska>
      )}

      {radky.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs text-slate-500">
            <input
              type="checkbox"
              aria-label="Vybrat vše"
              checked={vse}
              onChange={() => setVybrane(vse ? new Set() : new Set(radky.map((r) => r.id)))}
            />
            <span>Vybrat vše</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {radky.map((r) => {
              const u = uctyMapa.get(r.account_id);
              return (
                <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" className="mt-1" aria-label="Vybrat" checked={vybrane.has(r.id)} onChange={() => prepni(r.id)} />
                  <Link href={`/prispevky/${r.id}`} className="grid min-w-0 flex-1 gap-1 md:grid-cols-[10rem_10rem_6rem_minmax(0,1fr)_8rem] md:items-center md:gap-3">
                    <span className="tabular-nums">{hezkyCas(r.scheduled_at, u?.timezone ?? APP_TZ)}</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: u?.color ?? "#64748b" }} />
                      <span className="truncate">{u?.name ?? "?"}</span>
                    </span>
                    <span className="text-slate-500">{FORMATY_NAZEV[r.format]}</span>
                    <span className="truncate text-slate-700">
                      {sablony.has(r.id) && <span className="mr-1 rounded bg-violet-100 px-1 text-xs text-violet-800">šablona opakování</span>}
                      {r.series_id && <span className="mr-1" title="Výskyt opakování">↻</span>}
                      {r.caption || <em className="text-slate-400">bez textu</em>}
                    </span>
                    <span><StavStitek status={r.status} /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
