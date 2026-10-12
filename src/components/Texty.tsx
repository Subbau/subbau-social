"use client";

import { useEffect, useMemo, useState } from "react";
import type { TextSnippet } from "@/lib/db-types";
import { mapaUctu, useUcty } from "@/lib/data/ucty";
import { supabase } from "@/lib/supabase/client";
import { Hlaska, Modal, Nacitani, Nadpis, Tlacitko, textChyby } from "./ui";

type Formular = { id: string | null; title: string; body: string; account_id: string };
const PRAZDNY: Formular = { id: null, title: "", body: "", account_id: "" };

export function Texty() {
  const ucty = useUcty();
  const uctyMapa = useMemo(() => mapaUctu(ucty.data), [ucty.data]);
  const [filtr, setFiltr] = useState("");
  const [radky, setRadky] = useState<TextSnippet[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [form, setForm] = useState<Formular | null>(null);
  const [pracuji, setPracuji] = useState(false);
  const [verze, setVerze] = useState(0);

  useEffect(() => {
    let platne = true;
    (async () => {
      try {
        let q = supabase().from("text_snippets").select("*").order("title");
        if (filtr === "sdilene") q = q.is("account_id", null);
        else if (filtr) q = q.eq("account_id", filtr);
        const { data, error } = await q;
        if (error) throw error;
        if (platne) {
          setRadky(data ?? []);
          setChyba(null);
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
  }, [filtr, verze]);

  async function ulozit() {
    if (!form) return;
    if (!form.title.trim() || !form.body.trim()) {
      setChyba("Vyplňte název i text.");
      return;
    }
    setPracuji(true);
    setChyba(null);
    try {
      const radek = { title: form.title.trim(), body: form.body, account_id: form.account_id || null };
      const { error } = form.id
        ? await supabase().from("text_snippets").update(radek).eq("id", form.id)
        : await supabase().from("text_snippets").insert(radek);
      if (error) throw error;
      setForm(null);
      setVerze((v) => v + 1);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  async function smazat(s: TextSnippet) {
    if (!confirm(`Smazat šablonu „${s.title}“?`)) return;
    const { error } = await supabase().from("text_snippets").delete().eq("id", s.id);
    if (error) setChyba(error.message);
    else setVerze((v) => v + 1);
  }

  return (
    <div className="space-y-3">
      <Nadpis akce={<Tlacitko varianta="primarni" onClick={() => setForm({ ...PRAZDNY, account_id: filtr && filtr !== "sdilene" ? filtr : "" })}>+ Nová šablona</Tlacitko>}>
        Šablony textů
      </Nadpis>
      <div className="max-w-xs">
        <label className="stitek-pole" htmlFor="t-filtr">Účet</label>
        <select id="t-filtr" className="pole" value={filtr} onChange={(e) => setFiltr(e.target.value)}>
          <option value="">Všechny</option>
          <option value="sdilene">Sdílené (pro všechny účty)</option>
          {ucty.data.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>
      {chyba && !form && <Hlaska typ="chyba">{chyba}</Hlaska>}
      {nacitam && <Nacitani />}
      {!nacitam && radky.length === 0 && (
        <p className="text-sm text-slate-500">Zatím žádné šablony. Hodí se na podpisy, kontakty, opakované hashtagy.</p>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {radky.map((s) => (
          <li key={s.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.title}</p>
                <p className="text-xs text-slate-500">
                  {s.account_id ? uctyMapa.get(s.account_id)?.name ?? "účet" : "sdílená"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Tlacitko varianta="tiche" onClick={() => setForm({ id: s.id, title: s.title, body: s.body, account_id: s.account_id ?? "" })}>
                  Upravit
                </Tlacitko>
                <Tlacitko varianta="tiche" onClick={() => void smazat(s)}>
                  Smazat
                </Tlacitko>
              </div>
            </div>
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-slate-700">{s.body}</p>
          </li>
        ))}
      </ul>

      <Modal otevreno={form !== null} zavrit={() => setForm(null)} nadpis={form?.id ? "Upravit šablonu" : "Nová šablona"}>
        {form && (
          <div className="space-y-3">
            <div>
              <label className="stitek-pole" htmlFor="f-nazev">Název</label>
              <input id="f-nazev" className="pole" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="stitek-pole" htmlFor="f-ucet">Účet</label>
              <select id="f-ucet" className="pole" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                <option value="">Sdílená (pro všechny účty)</option>
                {ucty.data.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="stitek-pole" htmlFor="f-text">Text</label>
              <textarea id="f-text" rows={8} className="pole" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
            <div className="flex justify-end gap-2">
              <Tlacitko onClick={() => setForm(null)}>Zrušit</Tlacitko>
              <Tlacitko varianta="primarni" onClick={() => void ulozit()} disabled={pracuji}>Uložit</Tlacitko>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
