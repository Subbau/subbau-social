"use client";

import { useEffect, useMemo, useState } from "react";
import type { FbGroup } from "@/lib/db-types";
import { hezkyCas } from "@/lib/cas";
import { nactiSkupiny, upravSkupinu } from "@/lib/data/skupiny";
import { klicJmena } from "@/lib/skupiny/import";
import { odkazSkupiny } from "@/lib/skupiny/odkaz";
import { Hlaska, Nacitani, Nadpis, Tlacitko, textChyby } from "../ui";
import { ImportSkupin } from "./ImportSkupin";
import { NavSkupin } from "./NavSkupin";
import { UpozorneniTelefon } from "./UpozorneniTelefon";
import { UpravaSkupiny } from "./UpravaSkupiny";

export function SeznamSkupin() {
  const [skupiny, setSkupiny] = useState<FbGroup[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [zprava, setZprava] = useState<string | null>(null);
  const [hledat, setHledat] = useState("");
  const [sada, setSada] = useState("");
  const [jenAktivni, setJenAktivni] = useState(false);
  const [import_, setImport] = useState(false);
  const [uprava, setUprava] = useState<FbGroup | null>(null);
  const [verze, setVerze] = useState(0);

  useEffect(() => {
    let platne = true;
    nactiSkupiny()
      .then((s) => {
        if (platne) {
          setSkupiny(s);
          setChyba(null);
        }
      })
      .catch((e) => platne && setChyba(textChyby(e)))
      .finally(() => platne && setNacitam(false));
    return () => {
      platne = false;
    };
  }, [verze]);

  const vsechnySady = useMemo(() => [...new Set(skupiny.flatMap((s) => s.sady))].sort((a, b) => a.localeCompare(b, "cs")), [skupiny]);
  const viditelne = useMemo(() => {
    const h = klicJmena(hledat);
    return skupiny.filter(
      (s) => (!h || klicJmena(s.name).includes(h)) && (!sada || s.sady.includes(sada)) && (!jenAktivni || s.is_active),
    );
  }, [skupiny, hledat, sada, jenAktivni]);
  const aktivnich = skupiny.filter((s) => s.is_active).length;

  async function prepniAktivni(s: FbGroup) {
    try {
      const n = await upravSkupinu(s.id, { is_active: !s.is_active });
      setSkupiny((xs) => xs.map((x) => (x.id === n.id ? n : x)));
    } catch (e) {
      setChyba(textChyby(e));
    }
  }

  return (
    <div className="space-y-3">
      <NavSkupin />
      <Nadpis akce={<Tlacitko varianta="primarni" onClick={() => setImport(true)}>Import z Facebooku</Tlacitko>}>
        Skupiny ({aktivnich} aktivních z {skupiny.length})
      </Nadpis>
      <Hlaska typ="info">
        Do skupin appka nic sama neposílá (Facebook to nedovoluje a osobní účet by mohl zablokovat). Připraví dávky,
        upozorní telefon a na obrazovce „Dnes“ jedním klepnutím zkopíruje text a otevře sdílení.
      </Hlaska>
      <UpozorneniTelefon />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <div>
          <label className="stitek-pole" htmlFor="sk-hledat">Hledat</label>
          <input id="sk-hledat" className="pole" value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder="název skupiny" />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="sk-sada">Sada</label>
          <select id="sk-sada" className="pole" value={sada} onChange={(e) => setSada(e.target.value)}>
            <option value="">Všechny</option>
            {vsechnySady.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={jenAktivni} onChange={(e) => setJenAktivni(e.target.checked)} />
          jen aktivní
        </label>
      </div>

      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
      {zprava && <Hlaska typ="ok">{zprava}</Hlaska>}
      {nacitam && <Nacitani />}
      {!nacitam && skupiny.length === 0 && (
        <p className="text-sm text-slate-500">Zatím žádné skupiny. Začněte importem ze stránky Facebooku.</p>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {viditelne.map((s) => (
          <li key={s.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${s.is_active ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{s.name}</p>
              <p className="text-xs text-slate-500">
                {s.last_sent_at ? `naposledy odesláno ${hezkyCas(s.last_sent_at)}` : "zatím neodesláno"}
                {s.sady.length > 0 && ` · ${s.sady.join(", ")}`}
                {!s.url && " · bez odkazu"}
              </p>
            </div>
            <a href={odkazSkupiny(s)} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline">
              otevřít
            </a>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={s.is_active} onChange={() => void prepniAktivni(s)} />
              aktivní
            </label>
            <Tlacitko varianta="tiche" onClick={() => setUprava(s)}>Upravit</Tlacitko>
          </li>
        ))}
      </ul>

      <ImportSkupin
        otevreno={import_}
        zavrit={() => setImport(false)}
        existujici={skupiny}
        obnovSkupiny={setSkupiny}
        poUlozeni={(n) => {
          setZprava(`Uloženo ${n} nových skupin.`);
          setVerze((v) => v + 1);
        }}
      />
      {uprava && (
        <UpravaSkupiny
          skupina={uprava}
          zavrit={() => setUprava(null)}
          poZmene={(n) => {
            setUprava(null);
            setSkupiny((xs) => (n ? xs.map((x) => (x.id === n.id ? n : x)) : xs.filter((x) => x.id !== uprava.id)));
          }}
        />
      )}
    </div>
  );
}
