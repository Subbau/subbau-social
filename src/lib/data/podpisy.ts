"use client";

import { useEffect, useState } from "react";
import { BUCKET } from "../media-cesta";
import { supabase } from "../supabase/client";

// Podepsané URL z privátního bucketu. Platí hodinu, v mezipaměti držíme 50 min.
const PLATNOST_S = 3600;
const DRZET_MS = 50 * 60 * 1000;
const mezipamet = new Map<string, { url: string; do: number }>();

export async function podepis(cesty: string[]): Promise<Record<string, string>> {
  const ted = Date.now();
  const vysledek: Record<string, string> = {};
  const chybi: string[] = [];
  for (const c of new Set(cesty.filter(Boolean))) {
    const z = mezipamet.get(c);
    if (z && z.do > ted) vysledek[c] = z.url;
    else chybi.push(c);
  }
  for (let i = 0; i < chybi.length; i += 100) {
    const davka = chybi.slice(i, i + 100);
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls(davka, PLATNOST_S);
    if (error || !data) continue;
    for (const radek of data) {
      if (radek.signedUrl && radek.path) {
        mezipamet.set(radek.path, { url: radek.signedUrl, do: ted + DRZET_MS });
        vysledek[radek.path] = radek.signedUrl;
      }
    }
  }
  return vysledek;
}

/** Hook: cesty → podepsané URL (průběžně doplňuje). */
export function usePodepsane(cesty: (string | null | undefined)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const klic = [...new Set(cesty.filter((c): c is string => Boolean(c)))].sort().join("\n");
  useEffect(() => {
    if (!klic) return;
    let platne = true;
    podepis(klic.split("\n"))
      .then((u) => {
        if (platne) setUrls((p) => ({ ...p, ...u }));
      })
      .catch(() => undefined);
    return () => {
      platne = false;
    };
  }, [klic]);
  return urls;
}
