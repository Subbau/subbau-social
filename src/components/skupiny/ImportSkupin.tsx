"use client";

import { useMemo, useState } from "react";
import type { FbGroup } from "@/lib/db-types";
import { nactiSkupiny, vlozDavkuSkupin } from "@/lib/data/skupiny";
import { rozeberImport, souhrnOpakovanychJmen, ulozImport, vyberKVlozeni, type DuvodPreskoceni } from "@/lib/skupiny/import";
import { Hlaska, Modal, Tlacitko, textChyby } from "../ui";

const DUVODY: Record<DuvodPreskoceni, string> = {
  "uz-existuje-url": "už je uložená (stejný odkaz)",
  "uz-existuje-jmeno": "už je uložená (stejné jméno)",
  "duplicita-v-importu": "v importu podruhé",
};

export function ImportSkupin({
  otevreno,
  zavrit,
  existujici,
  poUlozeni,
  obnovSkupiny,
}: {
  otevreno: boolean;
  zavrit: () => void;
  existujici: FbGroup[];
  poUlozeni: (pocet: number) => void;
  /** po chybě v půlce: aktuální skupiny z DB, aby se výběr přepočítal */
  obnovSkupiny: (skupiny: FbGroup[]) => void;
}) {
  const [text, setText] = useState("");
  const [sady, setSady] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [ukladam, setUkladam] = useState(false);
  const rozbor = useMemo(() => rozeberImport(text), [text]);
  const vyber = useMemo(() => vyberKVlozeni(rozbor.polozky, existujici), [rozbor, existujici]);
  const opakovana = useMemo(() => souhrnOpakovanychJmen(rozbor.polozky, vyber.vlozit), [rozbor, vyber]);

  async function ulozit() {
    setUkladam(true);
    setChyba(null);
    try {
      const tagy = sady.split(",").map((s) => s.trim()).filter(Boolean);
      // Výběr se počítá z čerstvě načtené DB — opakované Uložit po chybě nic nezdvojí.
      const v = await ulozImport(rozbor.polozky, {
        nactiExistujici: nactiSkupiny,
        vlozDavku: (davka) => vlozDavkuSkupin(davka, tagy),
      });
      obnovSkupiny(v.existujici);
      if (v.chyba) {
        setChyba(`Uloženo ${v.vlozeno}, pak chyba: ${textChyby(v.chyba)}. Náhled ukazuje, co zbývá — zkuste Uložit znovu.`);
        return;
      }
      setText("");
      poUlozeni(v.vlozeno);
      zavrit();
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setUkladam(false);
    }
  }

  return (
    <Modal otevreno={otevreno} zavrit={zavrit} nadpis="Import skupin z Facebooku" siroky>
      <div className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600">
          <li>Na počítači otevřete facebook.com/groups/joins (Skupiny, ve kterých jste) a sjeďte úplně dolů.</li>
          <li>Označte celou stránku (Ctrl/Cmd + A), zkopírujte a vložte sem.</li>
          <li>Řádky navíc („Naposledy jste tu byl(a)“, „před 3 týdny“ …) appka sama vynechá.</li>
          <li>Jde vložit i řádky „název [Tab] odkaz na skupinu“ (např. z tabulky).</li>
        </ol>
        <textarea
          className="pole h-48 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Sem vložte zkopírovanou stránku…"
          aria-label="Text k importu"
        />
        <div>
          <label className="stitek-pole" htmlFor="imp-sady">Sady pro nové skupiny (oddělit čárkou, nepovinné)</label>
          <input id="imp-sady" className="pole" value={sady} onChange={(e) => setSady(e.target.value)} placeholder="OSVČ Německo" />
        </div>
        {text.trim() && (
          <div className="space-y-2">
            <p>
              Nalezeno <strong>{rozbor.polozky.length}</strong> skupin, uloží se <strong>{vyber.vlozit.length}</strong>
              {vyber.preskocit.length > 0 && `, přeskočí se ${vyber.preskocit.length}`}. Vynecháno řádků: {rozbor.ignorovano}.
            </p>
            <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
              <ul className="divide-y divide-slate-100 text-xs">
                {rozbor.polozky.map((p, i) => {
                  const pres = vyber.preskocit.find((x) => x.polozka === p);
                  return (
                    <li key={i} className={`flex flex-wrap items-center gap-2 px-2 py-1 ${pres ? "text-slate-400 line-through" : ""}`}>
                      <span className="min-w-0 break-words">{p.name}</span>
                      {p.url && <span className="text-slate-400">odkaz ✓</span>}
                      {p.duplicitniJmeno && <span className="rounded bg-amber-100 px-1 text-amber-900 no-underline">stejné jméno víckrát</span>}
                      {pres && <span className="no-underline">— {DUVODY[pres.duvod]}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
            {opakovana.length > 0 && (
              <Hlaska typ="info">
                <p className="mb-1">Stejné jméno víckrát — na Facebooku jsou to různé skupiny:</p>
                <ul className="list-disc pl-5">
                  {opakovana.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Hlaska>
            )}
          </div>
        )}
        {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
        <div className="flex justify-end gap-2">
          <Tlacitko onClick={zavrit}>Zrušit</Tlacitko>
          <Tlacitko varianta="primarni" disabled={ukladam || vyber.vlozit.length === 0} onClick={() => void ulozit()}>
            {ukladam ? "Ukládám…" : `Uložit ${vyber.vlozit.length} skupin`}
          </Tlacitko>
        </div>
      </div>
    </Modal>
  );
}
