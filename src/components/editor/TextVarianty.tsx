"use client";

import { useEffect, useRef, useState } from "react";
import type { Platform, TextSnippet } from "@/lib/db-types";
import { supabase } from "@/lib/supabase/client";
import { IG_MAX_HASHTAGU, LIMIT_ZNAKU, pocetHashtagu, pocetZnaku } from "@/lib/validace";

export function TextVarianty({
  accountId,
  platform,
  caption,
  linkUrl,
  jenCteni,
  zmena,
}: {
  accountId: string;
  platform: Platform;
  caption: string;
  linkUrl: string;
  jenCteni: boolean;
  zmena: (z: { caption?: string; link_url?: string }) => void;
}) {
  const [sablony, setSablony] = useState<TextSnippet[]>([]);
  const pole = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let platne = true;
    supabase()
      .from("text_snippets")
      .select("*")
      .or(`account_id.eq.${accountId},account_id.is.null`)
      .order("title")
      .then(({ data }) => {
        if (platne) setSablony(data ?? []);
      });
    return () => {
      platne = false;
    };
  }, [accountId]);

  const znaky = pocetZnaku(caption);
  const limit = LIMIT_ZNAKU[platform];
  const tagy = pocetHashtagu(caption);

  function vlozit(text: string) {
    const el = pole.current;
    if (!el) {
      zmena({ caption: caption + text });
      return;
    }
    const zacatek = el.selectionStart ?? caption.length;
    const konec = el.selectionEnd ?? caption.length;
    const pred = caption.slice(0, zacatek);
    const oddelovac = pred && !pred.endsWith("\n") && !pred.endsWith(" ") ? "\n" : "";
    const novy = pred + oddelovac + text + caption.slice(konec);
    zmena({ caption: novy });
    requestAnimationFrame(() => {
      el.focus();
      const pozice = (pred + oddelovac + text).length;
      el.setSelectionRange(pozice, pozice);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="stitek-pole" htmlFor="text-prispevku">Text</label>
        {!jenCteni && sablony.length > 0 && (
          <select
            aria-label="Vložit šablonu textu"
            className="pole w-auto max-w-full py-1 text-xs"
            value=""
            onChange={(e) => {
              const s = sablony.find((x) => x.id === e.target.value);
              if (s) vlozit(s.body);
            }}
          >
            <option value="">Vložit šablonu…</option>
            {sablony.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}{s.account_id ? "" : " (sdílená)"}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea
        id="text-prispevku"
        ref={pole}
        rows={8}
        className="pole font-[inherit]"
        value={caption}
        readOnly={jenCteni}
        onChange={(e) => zmena({ caption: e.target.value })}
      />
      <div className="flex flex-wrap justify-end gap-3 text-xs">
        {platform === "instagram" && (
          <span className={tagy > IG_MAX_HASHTAGU ? "font-semibold text-red-700" : "text-slate-500"}>
            hashtagy {tagy}/{IG_MAX_HASHTAGU}
          </span>
        )}
        <span className={znaky > limit ? "font-semibold text-red-700" : "text-slate-500"}>
          {znaky.toLocaleString("cs-CZ")}/{limit.toLocaleString("cs-CZ")} znaků
        </span>
      </div>
      {platform === "facebook" && (
        <div>
          <label className="stitek-pole" htmlFor="odkaz">Odkaz (nepovinné)</label>
          <input
            id="odkaz"
            type="url"
            className="pole"
            placeholder="https://"
            value={linkUrl}
            readOnly={jenCteni}
            onChange={(e) => zmena({ link_url: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
