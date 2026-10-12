// Drobná čistá logika akcí nad příspěvky.

export const ODKLAD_OPAKOVANI_MS = 2 * 60 * 1000;

/** „Zkusit znovu“: scheduled_at = max(původní, teď + 2 min). */
export function casProOpakovani(puvodni: string | null, ted: Date = new Date()): Date {
  const nejdriv = ted.getTime() + ODKLAD_OPAKOVANI_MS;
  if (!puvodni) return new Date(nejdriv);
  return new Date(Math.max(new Date(puvodni).getTime(), nejdriv));
}

/** Kódy chyb, u kterých nevíme, jestli příspěvek nevyšel. */
export function jeNejistyVysledek(kod: string | null): boolean {
  return kod === "unknown_outcome";
}
