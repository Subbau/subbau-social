"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PostSeries, PostStatus, SocialAccount } from "@/lib/db-types";
import { casProOpakovani, jeNejistyVysledek } from "@/lib/akce";
import { utcNaMistni } from "@/lib/cas";
import {
  nactiPrispevek,
  nactiSerie,
  nactiSkupinu,
  smazPrispevek,
  ulozVariantu,
  zkusitZnovu as zkusitZnovuVDb,
} from "@/lib/data/prispevky";
import { lzeNaplanovat } from "@/lib/opakovani";
import { vysledekZChyby } from "@/lib/ukladani";
import { useCasoveSloty, useUcty } from "@/lib/data/ucty";
import { lzeUpravit, STAVY } from "@/lib/stavy";
import { zkontrolujVariantu, type VysledekKontroly } from "@/lib/validace";
import { oznamZmenu } from "@/lib/udalosti";
import { Hlaska, Nacitani, Tlacitko, textChyby } from "../ui";
import { blokujeDuplicita, useDuplicity, type NalezenaDuplicita } from "./Duplicity";
import { DuplikovatDialog } from "./DuplikovatDialog";
import {
  naUkladanou,
  novaVarianta,
  okamzikVarianty,
  zPrispevku,
  zpusobZkusitZnovu,
  type Varianta,
} from "./typy";
import { ZalozkaVarianty } from "./ZalozkaVarianty";

/** Neviditelný hlídač duplicit pro každou variantu (hooky nejdou volat ve smyčce). */
function HlidacDuplicit({ v, hlasit }: { v: Varianta; hlasit: (klic: string, d: NalezenaDuplicita[]) => void }) {
  const d = useDuplicity(v.id, v.series_id, v.account_id, v.format, v.caption, v.media);
  useEffect(() => hlasit(v.klic, d), [v.klic, d, hlasit]);
  return null;
}

function nejsouZmeny(v: Varianta) {
  return !v.caption.trim() && v.media.length === 0 && !v.link_url.trim();
}

export function Editor({ postId }: { postId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const ucty = useUcty();
  const sloty = useCasoveSloty();
  const uctyMapa = useMemo(() => new Map(ucty.data.map((u) => [u.id, u])), [ucty.data]);

  const [varianty, setVarianty] = useState<Varianta[]>([]);
  const [aktivni, setAktivni] = useState<string | null>(null);
  const [nacitam, setNacitam] = useState(Boolean(postId));
  const [chyba, setChyba] = useState<string | null>(null);
  const [zprava, setZprava] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);
  const [zmeneno, setZmeneno] = useState(false);
  const [duplicity, setDuplicity] = useState<Record<string, NalezenaDuplicita[]>>({});
  const [dupDialog, setDupDialog] = useState(false);
  const [verze, setVerze] = useState(0);
  /** varianty tak, jak přišly z DB — pro „Zkusit znovu“ bez ukládání */
  const [nactene, setNactene] = useState<Map<string, Varianta>>(new Map());
  const [serie, setSerie] = useState<PostSeries[]>([]);
  const citac = useRef(0);
  const novyKlic = () => `novy-${++citac.current}`;

  const vychoziCas = useMemo(() => {
    const c = params.get("cas");
    const d = c ? new Date(c) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }, [params]);

  // ---------- načtení ----------
  useEffect(() => {
    if (!postId || ucty.nacitam) return;
    let platne = true;
    (async () => {
      setNacitam(true);
      try {
        const p = await nactiPrispevek(postId);
        if (!p) throw new Error("Příspěvek neexistuje (nebo k němu nemáte přístup).");
        const [radky, vsechnySerie] = await Promise.all([
          p.group_id ? nactiSkupinu(p.group_id) : Promise.resolve([p]),
          nactiSerie(),
        ]);
        if (!platne) return;
        const tz = (id: string) => uctyMapa.get(id)?.timezone ?? "Europe/Prague";
        const nove = radky.map((r) => zPrispevku(r, tz(r.account_id)));
        setVarianty(nove);
        setNactene(new Map(nove.map((v) => [v.klic, v])));
        setSerie(vsechnySerie);
        setAktivni((a) => (a && radky.some((r) => r.id === a) ? a : p.id));
        setZmeneno(false);
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
  }, [postId, verze, ucty.nacitam, uctyMapa]);

  // nový příspěvek: předvybraný účet z ?ucet= (odvozeno při vykreslení, ne v efektu)
  const [predvybrano, setPredvybrano] = useState(false);
  if (!postId && !ucty.nacitam && !predvybrano) {
    setPredvybrano(true);
    const id = params.get("ucet");
    const u = id ? uctyMapa.get(id) : undefined;
    if (u) {
      const v = novaVarianta(u, vychoziCas, `predvybrany-${u.id}`);
      setVarianty([v]);
      setAktivni(v.klic);
    }
  }

  // upozornění při odchodu s neuloženými změnami
  useEffect(() => {
    if (!zmeneno) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [zmeneno]);

  const hlasitDuplicity = useCallback((klic: string, d: NalezenaDuplicita[]) => {
    setDuplicity((x) => (x[klic] === d ? x : { ...x, [klic]: d }));
  }, []);

  // ---------- odvozené ----------
  const ted = new Date();
  const kontroly: Record<string, VysledekKontroly> = {};
  for (const v of varianty) {
    const u = uctyMapa.get(v.account_id);
    if (!u) continue;
    const k = zkontrolujVariantu(
      {
        platform: u.platform,
        format: v.format,
        caption: v.caption,
        link_url: v.link_url.trim() || null,
        media: v.media,
        scheduledAt: okamzikVarianty(v, u.timezone),
      },
      "naplanovat",
      ted,
    );
    if (blokujeDuplicita(duplicity[v.klic] ?? [], v.platform_options.allow_duplicate === true)) {
      k.blokujici.push("Stejný obsah na tomto účtu už vyšel nebo právě vychází — upravte text či grafiku, nebo potvrďte „Opravdu zveřejnit znovu“.");
    }
    kontroly[v.klic] = k;
  }
  const upravitelne = varianty.filter((v) => v.id === null || lzeUpravit(v.status));
  const aktivniV = varianty.find((v) => v.klic === aktivni) ?? varianty[0];
  const aktivniUcet = aktivniV ? uctyMapa.get(aktivniV.account_id) : undefined;
  const pouziteUcty = new Set(varianty.map((v) => v.account_id));

  function zmenVariantu(klic: string, z: Partial<Varianta>) {
    setVarianty((vs) => vs.map((v) => (v.klic === klic ? { ...v, ...z } : v)));
    setZmeneno(true);
  }

  function prepniUcet(u: SocialAccount) {
    const existujici = varianty.find((v) => v.account_id === u.id);
    if (existujici) {
      if (existujici.id) {
        setAktivni(existujici.klic);
        return;
      }
      if (!nejsouZmeny(existujici) && !confirm(`Odebrat ${u.name} i s rozepsaným textem?`)) return;
      const zbytek = varianty.filter((v) => v.klic !== existujici.klic);
      setVarianty(zbytek);
      if (aktivni === existujici.klic) setAktivni(zbytek[0]?.klic ?? null);
      return;
    }
    const vzor = aktivniV && aktivniUcet ? okamzikVarianty(aktivniV, aktivniUcet.timezone) : vychoziCas;
    const v = novaVarianta(u, vzor ?? vychoziCas, novyKlic());
    setVarianty((vs) => [...vs, v]);
    setAktivni(v.klic);
    setZmeneno(true);
  }

  // ---------- ukládání ----------
  const sablonyVeSkupine = upravitelne.filter((v) => !lzeNaplanovat(v.id, serie));

  async function ulozVse(cil: "draft" | "scheduled") {
    setChyba(null);
    setZprava(null);
    if (upravitelne.length === 0) return;
    if (cil === "scheduled") {
      if (sablonyVeSkupine.length > 0) {
        setAktivni(sablonyVeSkupine[0].klic);
        setChyba("Šablonu opakování nejde naplánovat — výskyty vytváří opakování. Uložte ji jako koncept.");
        return;
      }
      const spatne = upravitelne.find((v) => (kontroly[v.klic]?.blokujici.length ?? 0) > 0);
      if (spatne) {
        setAktivni(spatne.klic);
        setChyba(`Nejde naplánovat — ${uctyMapa.get(spatne.account_id)?.name ?? "účet"}: ${kontroly[spatne.klic].blokujici[0]}`);
        return;
      }
    }
    setPracuji(true);
    const skupina =
      varianty.length > 1 ? varianty.find((v) => v.group_id)?.group_id ?? crypto.randomUUID() : varianty[0]?.group_id ?? null;
    const chyby: string[] = [];
    const vysledky = new Map<string, { id: string; status: PostStatus }>();
    let prvniId: string | null = null;
    for (const v of upravitelne) {
      const u = uctyMapa.get(v.account_id);
      if (!u) continue;
      try {
        const id = await ulozVariantu(naUkladanou({ ...v, group_id: skupina }, u.timezone), cil);
        vysledky.set(v.klic, { id, status: cil });
        prvniId = prvniId ?? id;
      } catch (e) {
        // Řádek v DB už je (nový bez médií, nebo naplánovaný vrácený do konceptu):
        // zapamatovat si id i stav, ať další uložení nezaloží druhý řádek.
        const r = vysledekZChyby(e);
        if (r) vysledky.set(v.klic, r);
        chyby.push(`${u.name}: ${textChyby(e)}`);
      }
    }
    setPracuji(false);
    oznamZmenu();
    if (chyby.length) {
      // Bez znovunačtení (neztratit rozepsané), ale s id a stavem, jak jsou teď v DB.
      setVarianty((vs) =>
        vs.map((v) => {
          const r = vysledky.get(v.klic);
          return r ? { ...v, id: r.id, status: r.status, group_id: skupina } : v;
        }),
      );
      setChyba(chyby.join(" · "));
      return;
    }
    setZmeneno(false);
    setZprava(cil === "scheduled" ? "Naplánováno." : "Uloženo jako koncept.");
    if (!postId && prvniId) router.replace(`/prispevky/${prvniId}`);
    else setVerze((x) => x + 1);
  }

  /** Pro opakování: uloží aktivní variantu jako koncept a vrátí id. */
  async function ulozitAktivniKoncept(): Promise<string | null> {
    if (!aktivniV || !aktivniUcet) return null;
    const skupina = varianty.length > 1 ? varianty.find((v) => v.group_id)?.group_id ?? crypto.randomUUID() : aktivniV.group_id;
    let id: string;
    try {
      id = await ulozVariantu(naUkladanou({ ...aktivniV, group_id: skupina }, aktivniUcet.timezone), "draft");
    } catch (e) {
      const r = vysledekZChyby(e);
      if (r) {
        const klic = aktivniV.klic;
        setVarianty((vs) => vs.map((x) => (x.klic === klic ? { ...x, id: r.id, status: r.status, group_id: skupina } : x)));
      }
      throw e;
    }
    setZmeneno(false);
    if (!postId) router.replace(`/prispevky/${id}`);
    return id;
  }

  async function zkusitZnovu(v: Varianta) {
    const u = uctyMapa.get(v.account_id);
    if (!u || !v.id) return;
    if (
      jeNejistyVysledek(v.last_error_code) &&
      !confirm("Nevíme, jestli příspěvek nevyšel. Zkontrolovali jste stránku? Pokračovat?")
    ) {
      return;
    }
    const k = kontroly[v.klic]?.blokujici.filter((t) => !/minulosti|Chybí datum/.test(t)) ?? [];
    if (k.length) {
      setChyba(`Nejde pustit znovu: ${k[0]}`);
      return;
    }
    setPracuji(true);
    setChyba(null);
    try {
      if (zpusobZkusitZnovu(nactene.get(v.klic), v) === "jen-stav") {
        // Bez úprav: jen failed → scheduled. Obsah ani média se nepřepisují (remote_state zůstane).
        await zkusitZnovuVDb({ id: v.id, status: v.status, scheduled_at: v.puvodniCas });
        const m = utcNaMistni(casProOpakovani(v.puvodniCas), u.timezone);
        setZprava(`Znovu naplánováno na ${m.datum} ${m.cas}.`);
      } else {
        const puvodni = okamzikVarianty(v, u.timezone);
        const m = utcNaMistni(casProOpakovani(puvodni ? puvodni.toISOString() : null), u.timezone);
        await ulozVariantu(naUkladanou({ ...v, datum: m.datum, cas: m.cas }, u.timezone), "scheduled");
        setZprava(`Uloženo a znovu naplánováno na ${m.datum} ${m.cas}.`);
      }
      setZmeneno(false);
      setVerze((x) => x + 1);
    } catch (e) {
      const r = vysledekZChyby(e);
      if (r) setVarianty((vs) => vs.map((x) => (x.klic === v.klic ? { ...x, id: r.id, status: r.status } : x)));
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  async function smazat(v: Varianta) {
    if (!v.id) {
      prepniUcet(uctyMapa.get(v.account_id) as SocialAccount);
      return;
    }
    if (!confirm("Opravdu smazat tento příspěvek?")) return;
    setPracuji(true);
    try {
      await smazPrispevek({ id: v.id, status: v.status });
      const zbytek = varianty.filter((x) => x.klic !== v.klic);
      if (zbytek.length === 0) {
        setZmeneno(false);
        router.push("/kalendar");
        return;
      }
      if (v.id === postId) {
        const dalsi = zbytek.find((x) => x.id);
        router.replace(dalsi?.id ? `/prispevky/${dalsi.id}` : "/kalendar");
        return;
      }
      setVarianty(zbytek);
      setAktivni(zbytek[0].klic);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  // ---------- vykreslení ----------
  if (ucty.nacitam || nacitam) return <Nacitani />;
  if (ucty.chyba) return <Hlaska typ="chyba">{ucty.chyba}</Hlaska>;

  const vyberoveUcty = ucty.data.filter((u) => (u.is_active || pouziteUcty.has(u.id)) && u.platform !== "tiktok");
  const vsechnoJenCteni = upravitelne.length === 0 && varianty.length > 0;

  return (
    <div className="space-y-4 pb-24">
      {varianty.map((v) => (
        <HlidacDuplicit key={v.klic} v={v} hlasit={hlasitDuplicity} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{postId ? "Příspěvek" : "Nový příspěvek"}</h1>
        {zmeneno && <span className="text-xs text-amber-700">neuložené změny</span>}
      </div>

      <div>
        <span className="stitek-pole">Účty (pro každý vlastní text, média a čas)</span>
        {vyberoveUcty.length === 0 && (
          <Hlaska typ="varovani">Nejsou žádné aktivní účty. Načtěte je v sekci Účty.</Hlaska>
        )}
        <div className="flex flex-wrap gap-1.5">
          {vyberoveUcty.map((u) => {
            const ano = pouziteUcty.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                aria-pressed={ano}
                disabled={vsechnoJenCteni && !ano}
                onClick={() => prepniUcet(u)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${ano ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white"} disabled:opacity-40`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: u.color }} />
                {u.name}
              </button>
            );
          })}
        </div>
      </div>

      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
      {zprava && <Hlaska typ="ok">{zprava}</Hlaska>}

      {varianty.length === 0 ? (
        <p className="text-sm text-slate-500">Vyberte aspoň jeden účet.</p>
      ) : (
        <>
          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
            {varianty.map((v) => {
              const u = uctyMapa.get(v.account_id);
              const k = kontroly[v.klic];
              const vybrana = v.klic === aktivniV?.klic;
              return (
                <button
                  key={v.klic}
                  role="tab"
                  type="button"
                  aria-selected={vybrana}
                  onClick={() => setAktivni(v.klic)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${vybrana ? "border-slate-300 bg-white font-medium" : "border-transparent text-slate-600 hover:bg-slate-100"}`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: u?.color ?? "#64748b" }} />
                  <span className="max-w-[9rem] truncate">{u?.name ?? "?"}</span>
                  <span title={STAVY[v.status].nazev}>{STAVY[v.status].ikona}</span>
                  {k && k.blokujici.length > 0 && lzeUpravit(v.status) && (
                    <span className="rounded-full bg-red-600 px-1.5 text-[10px] text-white">{k.blokujici.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          {aktivniV && aktivniUcet && (
            <ZalozkaVarianty
              key={aktivniV.klic}
              v={aktivniV}
              ucet={aktivniUcet}
              ucty={ucty.data}
              sloty={sloty.data.filter((s) => s.account_id === aktivniUcet.id)}
              kontrola={kontroly[aktivniV.klic] ?? { blokujici: [], varovani: [] }}
              duplicity={duplicity[aktivniV.klic] ?? []}
              jenCteni={aktivniV.id !== null && !lzeUpravit(aktivniV.status)}
              pracuji={pracuji}
              zmena={(z) => zmenVariantu(aktivniV.klic, z)}
              akce={{
                zkusitZnovu: () => void zkusitZnovu(aktivniV),
                smazat: () => void smazat(aktivniV),
                duplikovat: () => setDupDialog(true),
                ulozitKoncept: ulozitAktivniKoncept,
                obnovit: () => setVerze((x) => x + 1),
              }}
            />
          )}
        </>
      )}

      {upravitelne.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur md:left-56">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2">
            {upravitelne.length > 1 && (
              <span className="mr-auto text-xs text-slate-500">Platí pro {upravitelne.length} účty</span>
            )}
            <Tlacitko onClick={() => void ulozVse("draft")} disabled={pracuji}>
              Uložit koncept
            </Tlacitko>
            {sablonyVeSkupine.length > 0 ? (
              <span className="text-xs text-violet-800">Šablona opakování se nenaplánuje — výskyty vytváří opakování.</span>
            ) : (
              <Tlacitko varianta="primarni" onClick={() => void ulozVse("scheduled")} disabled={pracuji}>
                {pracuji ? "Ukládám…" : "Naplánovat"}
              </Tlacitko>
            )}
          </div>
        </div>
      )}

      {dupDialog && aktivniV?.id && aktivniUcet && (
        <DuplikovatDialog
          otevreno
          zavrit={() => setDupDialog(false)}
          zdroj={{
            id: aktivniV.id,
            format: aktivniV.format,
            caption: aktivniV.caption,
            link_url: aktivniV.link_url.trim() || null,
            platform_options: aktivniV.platform_options,
          }}
          media={aktivniV.media}
          ucty={ucty.data}
          vychoziUcet={aktivniUcet.id}
          vychoziDatum={aktivniV.datum}
          vychoziCas={aktivniV.cas}
        />
      )}
    </div>
  );
}
