"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// Množina řetězců uložená v localStorage, bez rozdílu mezi serverem a prohlížečem
// při hydrataci (server vidí prázdno, prohlížeč pak svou hodnotu).

const UDALOST = "subbau:ulozene";

function odebirej(fn: () => void) {
  window.addEventListener("storage", fn);
  window.addEventListener(UDALOST, fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener(UDALOST, fn);
  };
}

export function useUlozenaMnozina(klic: string): [Set<string>, (id: string) => void] {
  const surove = useSyncExternalStore(
    odebirej,
    () => localStorage.getItem(klic) ?? "[]",
    () => "[]",
  );
  const mnozina = useMemo(() => {
    try {
      const v: unknown = JSON.parse(surove);
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [surove]);
  const prepni = useCallback(
    (id: string) => {
      const n = new Set(mnozina);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      localStorage.setItem(klic, JSON.stringify([...n]));
      window.dispatchEvent(new Event(UDALOST));
    },
    [klic, mnozina],
  );
  return [mnozina, prepni];
}
