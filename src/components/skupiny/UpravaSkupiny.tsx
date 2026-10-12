"use client";

import { useState } from "react";
import type { FbGroup } from "@/lib/db-types";
import { smazSkupinu, upravSkupinu } from "@/lib/data/skupiny";
import { normalizujUrlSkupiny } from "@/lib/skupiny/import";
import { Hlaska, Modal, Tlacitko, textChyby } from "../ui";

/** Úprava jedné skupiny (nebo nová, když `skupina` je null). */
export function UpravaSkupiny({
  skupina,
  zavrit,
  poZmene,
}: {
  skupina: FbGroup;
  zavrit: () => void;
  poZmene: (s: FbGroup | null) => void;
}) {
  const [name, setName] = useState(skupina.name);
  const [url, setUrl] = useState(skupina.url ?? "");
  const [sady, setSady] = useState(skupina.sady.join(", "));
  const [note, setNote] = useState(skupina.note ?? "");
  const [chyba, setChyba] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);

  async function ulozit() {
    const cistaUrl = url.trim() ? normalizujUrlSkupiny(url) : null;
    if (url.trim() && !cistaUrl) {
      setChyba("Odkaz musí vypadat jako https://www.facebook.com/groups/…");
      return;
    }
    if (!name.trim()) {
      setChyba("Vyplňte název.");
      return;
    }
    setPracuji(true);
    setChyba(null);
    try {
      const s = await upravSkupinu(skupina.id, {
        name: name.trim(),
        url: cistaUrl,
        sady: sady.split(",").map((x) => x.trim()).filter(Boolean),
        note: note.trim() || null,
      });
      poZmene(s);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  async function smazat() {
    if (!confirm(`Smazat skupinu „${skupina.name}“? Zmizí i z nedokončených rozesílek.`)) return;
    setPracuji(true);
    try {
      await smazSkupinu(skupina.id);
      poZmene(null);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  return (
    <Modal otevreno zavrit={zavrit} nadpis="Upravit skupinu">
      <div className="space-y-3 text-sm">
        <div>
          <label className="stitek-pole" htmlFor="sk-nazev">Název</label>
          <input id="sk-nazev" className="pole" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="sk-url">Odkaz na skupinu</label>
          <input id="sk-url" className="pole" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/groups/…" />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="sk-sady">Sady (oddělit čárkou)</label>
          <input id="sk-sady" className="pole" value={sady} onChange={(e) => setSady(e.target.value)} />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="sk-note">Poznámka (pravidla skupiny)</label>
          <textarea id="sk-note" rows={3} className="pole" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
        <div className="flex flex-wrap justify-between gap-2">
          <Tlacitko varianta="nebezpecne" onClick={() => void smazat()} disabled={pracuji}>Smazat</Tlacitko>
          <div className="flex gap-2">
            <Tlacitko onClick={zavrit}>Zrušit</Tlacitko>
            <Tlacitko varianta="primarni" onClick={() => void ulozit()} disabled={pracuji}>Uložit</Tlacitko>
          </div>
        </div>
      </div>
    </Modal>
  );
}
