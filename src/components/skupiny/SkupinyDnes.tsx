"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatVPasmu } from "@/lib/cas";
import { podepis } from "@/lib/data/podpisy";
import { mediaRozesilky, nactiUkolyAktivnich, nastavStavUkolu, type UkolDnes } from "@/lib/data/skupiny";
import { sestavFrontu, type UkolProFrontu } from "@/lib/skupiny/fronta";
import { odkazSkupiny } from "@/lib/skupiny/odkaz";
import { HLASKA_SCHRANKA } from "@/lib/skupiny/texty";
import { Hlaska, Nacitani, textChyby } from "../ui";
import { NavSkupin } from "./NavSkupin";

function naFrontu(u: UkolDnes): UkolProFrontu | null {
  if (!u.fb_groups || !u.group_batches || !u.group_campaigns) return null;
  return {
    id: u.id,
    campaign_id: u.campaign_id,
    batch_id: u.batch_id,
    status: u.status,
    variant_index: u.variant_index,
    skupina: { name: u.fb_groups.name, url: u.fb_groups.url, note: u.fb_groups.note },
    davka: { batch_no: u.group_batches.batch_no, due_at: u.group_batches.due_at },
    kampan: { title: u.group_campaigns.title, variants: u.group_campaigns.variants },
  };
}

type Soubor = { file: File; url: string } | null;

/** Obrázek rozesílky jako File pro navigator.share — připraví se předem (sdílení musí běžet hned po klepnutí). */
function useSouborKampane(campaignId: string | null): { soubor: Soubor; chyba: string | null } {
  const [stav, setStav] = useState<{ id: string | null; soubor: Soubor; chyba: string | null }>({ id: null, soubor: null, chyba: null });
  useEffect(() => {
    if (!campaignId) return;
    let platne = true;
    (async () => {
      try {
        const media = await mediaRozesilky(campaignId);
        const m = media.find((x) => x.kind === "image") ?? media[0];
        if (!m) {
          if (platne) setStav({ id: campaignId, soubor: null, chyba: null });
          return;
        }
        const urls = await podepis([m.storage_path]);
        const url = urls[m.storage_path];
        if (!url) throw new Error("Obrázek nejde načíst.");
        const blob = await (await fetch(url)).blob();
        const pripona = m.storage_path.split(".").pop() ?? "jpg";
        const file = new File([blob], `subbau.${pripona}`, { type: m.mime_type ?? blob.type });
        if (platne) setStav({ id: campaignId, soubor: { file, url }, chyba: null });
      } catch (e) {
        if (platne) setStav({ id: campaignId, soubor: null, chyba: textChyby(e) });
      }
    })();
    return () => {
      platne = false;
    };
  }, [campaignId]);
  return stav.id === campaignId ? { soubor: stav.soubor, chyba: stav.chyba } : { soubor: null, chyba: null };
}

export function SkupinyDnes() {
  const [ukoly, setUkoly] = useState<UkolProFrontu[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [zprava, setZprava] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);
  const [ted, setTed] = useState(() => new Date());
  const historie = useRef<{ id: string; z: "sent" | "skipped" }[]>([]);
  const [lzeZpet, setLzeZpet] = useState(false);

  const nacti = useCallback(async () => {
    try {
      const data = await nactiUkolyAktivnich();
      setUkoly(data.map(naFrontu).filter((u): u is UkolProFrontu => u !== null));
      setTed(new Date());
      setChyba(null);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setNacitam(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void nacti(), 0);
    const i = setInterval(() => void nacti(), 60_000);
    const fokus = () => void nacti();
    window.addEventListener("focus", fokus);
    return () => {
      clearTimeout(t);
      clearInterval(i);
      window.removeEventListener("focus", fokus);
    };
  }, [nacti]);

  const { fronta, budouci } = useMemo(() => sestavFrontu(ukoly, ted), [ukoly, ted]);
  const aktualni = fronta[0] ?? null;
  const { soubor, chyba: chybaSouboru } = useSouborKampane(aktualni?.campaign_id ?? null);

  async function sdilet() {
    if (!aktualni) return;
    setZprava(null);
    // Obojí v jednom klepnutí: schránka i sdílení potřebují „čerstvé“ klepnutí, proto bez čekání předem.
    const schranka = navigator.clipboard?.writeText(aktualni.text).then(
      () => true,
      () => false,
    );
    let sdileno = false;
    try {
      if (soubor && navigator.canShare?.({ files: [soubor.file] })) {
        await navigator.share({ files: [soubor.file], text: aktualni.text });
        sdileno = true;
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") sdileno = true; // zavřeno uživatelem
    }
    if (!sdileno && soubor) {
      // náhrada: stáhnout obrázek
      const a = document.createElement("a");
      a.href = URL.createObjectURL(soubor.file);
      a.download = soubor.file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
    const ok = schranka ? await schranka : false;
    setZprava(ok ? HLASKA_SCHRANKA : "Text se nepodařilo zkopírovat — označte ho níže a zkopírujte ručně.");
  }

  async function oznac(na: "sent" | "skipped") {
    if (!aktualni) return;
    setPracuji(true);
    try {
      await nastavStavUkolu(aktualni.id, "pending", na);
      historie.current.push({ id: aktualni.id, z: na });
      setLzeZpet(true);
      setUkoly((us) => us.map((u) => (u.id === aktualni.id ? { ...u, status: na } : u)));
      setZprava(null);
    } catch (e) {
      setChyba(textChyby(e));
      void nacti();
    } finally {
      setPracuji(false);
    }
  }

  async function zpet() {
    const posledni = historie.current.pop();
    setLzeZpet(historie.current.length > 0);
    if (!posledni) return;
    setPracuji(true);
    try {
      await nastavStavUkolu(posledni.id, posledni.z, "pending");
      setUkoly((us) => us.map((u) => (u.id === posledni.id ? { ...u, status: "pending" } : u)));
    } catch (e) {
      // Kampaň se mohla posledním úkolem uzavřít (done) — pak se úkol tady už neukáže.
      setChyba(textChyby(e));
      void nacti();
    } finally {
      setPracuji(false);
    }
  }

  if (nacitam) return <Nacitani />;

  return (
    <div className="mx-auto max-w-md space-y-3 pb-10">
      <NavSkupin />
      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}

      {!aktualni && (
        <Hlaska typ="ok">Teď nic nečeká.{budouci.length > 0 ? " Další dávka je níže." : " Žádná dávka není naplánovaná."}</Hlaska>
      )}

      {aktualni && (
        <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">
            {aktualni.kampan.title} · dávka {aktualni.davka.batch_no}
          </div>
          <h1 className="break-words text-xl font-semibold leading-tight">{aktualni.skupina.name}</h1>
          <p className="text-sm tabular-nums text-slate-700">
            {aktualni.vDavce.poradi} / {aktualni.vDavce.celkem} v dávce · {aktualni.celkem.poradi} / {aktualni.celkem.celkem} celkem
          </p>
          {aktualni.skupina.note && <Hlaska typ="varovani">{aktualni.skupina.note}</Hlaska>}
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 text-sm select-all">
            {aktualni.text}
          </div>
          {soubor && (
            // eslint-disable-next-line @next/next/no-img-element -- podepsaná URL z privátního bucketu
            <img src={soubor.url} alt="" className="max-h-40 rounded-md object-contain" />
          )}
          {chybaSouboru && <p className="text-xs text-red-700">{chybaSouboru}</p>}

          <button
            type="button"
            onClick={() => void sdilet()}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white active:bg-blue-700"
          >
            Sdílet do skupiny
          </button>
          <a
            href={odkazSkupiny(aktualni.skupina)}
            target="_blank"
            rel="noreferrer"
            className="block w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-base font-medium"
          >
            Otevřít skupinu
          </a>
          {zprava && <Hlaska typ="info">{zprava}</Hlaska>}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pracuji}
              onClick={() => void oznac("sent")}
              className="rounded-lg bg-green-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
            >
              Odesláno ✓
            </button>
            <button
              type="button"
              disabled={pracuji}
              onClick={() => void oznac("skipped")}
              className="rounded-lg border border-slate-300 px-4 py-3 text-base disabled:opacity-50"
            >
              Přeskočit
            </button>
          </div>
        </article>
      )}

      {lzeZpet && (
        <button type="button" disabled={pracuji} onClick={() => void zpet()} className="text-sm text-blue-700 underline">
          ← Zpět o jednu (vrátit poslední mezi čekající)
        </button>
      )}

      {fronta.length > 1 && <p className="text-xs text-slate-500">Ve frontě ještě {fronta.length - 1} skupin.</p>}

      {budouci.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <h2 className="mb-1 font-medium">Další dávky</h2>
          <ul className="space-y-0.5 text-xs">
            {budouci.map((b) => (
              <li key={`${b.campaign_id}-${b.batch_no}`}>
                {formatVPasmu(b.due_at, "EEEEEE d. M. H:mm")} — {b.title}, dávka {b.batch_no}: {b.cekajicich} skupin
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
