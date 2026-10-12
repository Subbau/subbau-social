// Jednoduchý signál „příspěvky se změnily“ mezi částmi stránky
// (např. počet chyb v menu po kliknutí na Vyřešeno).

const NAZEV = "subbau:prispevky-zmena";

export function oznamZmenu(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAZEV));
}

export function poslouchejZmeny(fn: () => void): () => void {
  window.addEventListener(NAZEV, fn);
  return () => window.removeEventListener(NAZEV, fn);
}
