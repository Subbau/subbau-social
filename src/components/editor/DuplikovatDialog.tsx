"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MediaAsset, Post, SocialAccount } from "@/lib/db-types";
import { mistniNaUtc } from "@/lib/cas";
import { duplikuj } from "@/lib/data/prispevky";
import { Hlaska, Modal, Tlacitko, textChyby } from "../ui";

/** Duplikovat na jiný čas nebo účet → nový koncept s copied_from_id. */
export function DuplikovatDialog({
  otevreno,
  zavrit,
  zdroj,
  media,
  ucty,
  vychoziUcet,
  vychoziDatum,
  vychoziCas,
}: {
  otevreno: boolean;
  zavrit: () => void;
  zdroj: Pick<Post, "id" | "format" | "caption" | "link_url" | "platform_options">;
  media: MediaAsset[];
  ucty: SocialAccount[];
  vychoziUcet: string;
  vychoziDatum: string;
  vychoziCas: string;
}) {
  const router = useRouter();
  const aktivni = ucty.filter((u) => u.is_active && u.platform !== "tiktok");
  const [ucetId, setUcetId] = useState(vychoziUcet);
  const [datum, setDatum] = useState(vychoziDatum);
  const [cas, setCas] = useState(vychoziCas);
  const [chyba, setChyba] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);

  async function vytvorit() {
    const ucet = ucty.find((u) => u.id === ucetId);
    if (!ucet) return;
    setPracuji(true);
    setChyba(null);
    try {
      const kdy = datum && cas ? mistniNaUtc(datum, cas, ucet.timezone) : null;
      const id = await duplikuj(zdroj, media, ucet, kdy);
      zavrit();
      router.push(`/prispevky/${id}`);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  return (
    <Modal otevreno={otevreno} zavrit={zavrit} nadpis="Duplikovat příspěvek">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-600">Vznikne nový koncept se stejným textem a médii. Otevře se k úpravě.</p>
        <div>
          <label className="stitek-pole" htmlFor="dup-ucet">Účet</label>
          <select id="dup-ucet" className="pole" value={ucetId} onChange={(e) => setUcetId(e.target.value)}>
            {aktivni.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="stitek-pole" htmlFor="dup-datum">Datum</label>
            <input id="dup-datum" type="date" className="pole" value={datum} onChange={(e) => setDatum(e.target.value)} />
          </div>
          <div>
            <label className="stitek-pole" htmlFor="dup-cas">Čas</label>
            <input id="dup-cas" type="time" className="pole" value={cas} onChange={(e) => setCas(e.target.value)} />
          </div>
        </div>
        {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
        <div className="flex justify-end gap-2">
          <Tlacitko onClick={zavrit}>Zrušit</Tlacitko>
          <Tlacitko varianta="primarni" onClick={vytvorit} disabled={pracuji || !ucetId}>
            {pracuji ? "Vytvářím…" : "Vytvořit kopii"}
          </Tlacitko>
        </div>
      </div>
    </Modal>
  );
}
