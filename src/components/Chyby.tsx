"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Post, PublishAttempt } from "@/lib/db-types";
import { APP_TZ, hezkyCas } from "@/lib/cas";
import { jeNejistyVysledek } from "@/lib/akce";
import { oznacVyresene, zkusitZnovu } from "@/lib/data/prispevky";
import { mapaUctu, useUcty } from "@/lib/data/ucty";
import { supabase } from "@/lib/supabase/client";
import { poslouchejZmeny } from "@/lib/udalosti";
import { Hlaska, Nacitani, Nadpis, Tlacitko, textChyby } from "./ui";

const VYSLEDEK: Record<string, string> = {
  success: "úspěch",
  retryable_error: "dočasná chyba",
  fatal_error: "trvalá chyba",
  unknown: "nevíme",
};

function Denik({ postId }: { postId: string }) {
  const [pokusy, setPokusy] = useState<PublishAttempt[] | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  useEffect(() => {
    let platne = true;
    supabase()
      .from("publish_attempts")
      .select("*")
      .eq("post_id", postId)
      .order("started_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!platne) return;
        if (error) setChyba(error.message);
        else setPokusy(data ?? []);
      });
    return () => {
      platne = false;
    };
  }, [postId]);
  if (chyba) return <p className="text-xs text-red-700">{chyba}</p>;
  if (!pokusy) return <Nacitani text="Načítám deník…" />;
  if (pokusy.length === 0) return <p className="text-xs text-slate-500">Žádné záznamy pokusů.</p>;
  return (
    <ol className="space-y-2 text-xs">
      {pokusy.map((a) => (
        <li key={a.id} className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="font-medium">{a.started_at ? hezkyCas(a.started_at) : "?"}</span>
            {a.step && <span>krok: {a.step}</span>}
            {a.outcome && <span>výsledek: {VYSLEDEK[a.outcome] ?? a.outcome}</span>}
            {a.http_status != null && <span>HTTP {a.http_status}</span>}
            {a.error_code && <span>kód: {a.error_code}</span>}
          </div>
          {(a.error_message_cs || a.error_message) && (
            <p className="mt-1">{a.error_message_cs ?? a.error_message}</p>
          )}
          {a.error_message_cs && a.error_message && a.error_message !== a.error_message_cs && (
            <details className="mt-1">
              <summary className="cursor-pointer text-slate-500">původní hláška</summary>
              <pre className="whitespace-pre-wrap break-words text-[11px] text-slate-600">{a.error_message}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Chyby() {
  const ucty = useUcty();
  const uctyMapa = useMemo(() => mapaUctu(ucty.data), [ucty.data]);
  const [radky, setRadky] = useState<Post[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [rozbalene, setRozbalene] = useState<Set<string>>(new Set());
  const [pracuji, setPracuji] = useState<string | null>(null);
  /** hláška z akce — znovunačtení seznamu ji nemaže */
  const [zpravaAkce, setZpravaAkce] = useState<string | null>(null);
  const [verze, setVerze] = useState(0);

  useEffect(() => {
    let platne = true;
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("posts")
          .select("*")
          .eq("status", "failed")
          .is("error_resolved_at", null)
          .order("scheduled_at", { ascending: false });
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
  }, [verze]);

  useEffect(() => poslouchejZmeny(() => setVerze((v) => v + 1)), []);

  async function akce(p: Post, co: "znovu" | "vyreseno") {
    if (co === "znovu" && jeNejistyVysledek(p.last_error_code)) {
      if (!confirm("Nevíme, jestli příspěvek nevyšel. Zkontrolovali jste stránku, že tam není? Pustit znovu?")) return;
    }
    setPracuji(p.id);
    setZpravaAkce(null);
    try {
      if (co === "znovu") await zkusitZnovu(p);
      else await oznacVyresene(p.id);
      setRadky((r) => r.filter((x) => x.id !== p.id));
    } catch (e) {
      // Typicky zastaralá stránka (příspěvek už změnil stav) → ukázat proč a načíst znovu.
      setZpravaAkce(textChyby(e));
      setVerze((v) => v + 1);
    } finally {
      setPracuji(null);
    }
  }

  return (
    <div className="space-y-3">
      <Nadpis>Chyby publikace</Nadpis>
      {chyba && <Hlaska typ="chyba">{chyba}</Hlaska>}
      {zpravaAkce && <Hlaska typ="varovani">{zpravaAkce}</Hlaska>}
      {nacitam && <Nacitani />}
      {!nacitam && radky.length === 0 && <Hlaska typ="ok">Žádné nevyřešené chyby.</Hlaska>}
      <ul className="space-y-3">
        {radky.map((p) => {
          const u = uctyMapa.get(p.account_id);
          const nejiste = jeNejistyVysledek(p.last_error_code);
          const otevreno = rozbalene.has(p.id);
          return (
            <li key={p.id} className={`rounded-lg border bg-white p-3 ${nejiste ? "border-red-400 ring-2 ring-red-200" : "border-slate-200"}`}>
              {nejiste && (
                <p className="mb-2 rounded bg-red-600 px-2 py-1 text-sm font-semibold text-white">
                  Nejdřív zkontrolujte stránku — příspěvek možná vyšel. Teprve pak ho pouštějte znovu.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: u?.color ?? "#64748b" }} />
                  {u?.name ?? "?"}
                </span>
                <span className="tabular-nums text-slate-600">{hezkyCas(p.scheduled_at, u?.timezone ?? APP_TZ)}</span>
                {p.last_error_code && <span className="text-xs text-slate-400">{p.last_error_code}</span>}
              </div>
              <p className="mt-1 text-sm text-red-800">{p.last_error_message ?? "Publikace selhala (bez popisu)."}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{p.caption || "bez textu"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Tlacitko varianta="primarni" disabled={pracuji === p.id} onClick={() => void akce(p, "znovu")}>
                  Zkusit znovu
                </Tlacitko>
                <Link href={`/prispevky/${p.id}`} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
                  Upravit
                </Link>
                <Tlacitko disabled={pracuji === p.id} onClick={() => void akce(p, "vyreseno")}>
                  Vyřešeno
                </Tlacitko>
                <Tlacitko
                  varianta="tiche"
                  onClick={() =>
                    setRozbalene((s) => {
                      const n = new Set(s);
                      if (n.has(p.id)) n.delete(p.id);
                      else n.add(p.id);
                      return n;
                    })
                  }
                >
                  {otevreno ? "Skrýt deník" : "Deník pokusů"}
                </Tlacitko>
              </div>
              {otevreno && (
                <div className="mt-3">
                  <Denik postId={p.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">
        Zkusit znovu = naplánuje na původní čas, nejdřív ale za 2 minuty. Vyřešeno = chyba zmizí z přehledu, příspěvek zůstane.
      </p>
    </div>
  );
}
