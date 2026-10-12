// Backoff, podepsané URL médií, pomocné kontroly. Čistá logika.
import type { MediumPostu, PodepsaneMedium } from './typy.ts';

// ---------------------------------------------------------------- backoff
/**
 * Čekání před opakováním podle attempt_count (claim ho zvyšuje před každým pokusem):
 * po 1. pokusu 2 min, po 2. 10 min, po 3. 30 min; když selže i další pokus → failed.
 * Viz ROZHODNUTI.md (SPEC „2/10/30 … po 3. pokusu failed“ = tři opakování).
 */
export const ZPOZDENI_MINUT = [2, 10, 30] as const;
export const MAX_POKUSU = ZPOZDENI_MINUT.length + 1;

export function dalsiPokus(attemptCount: number, ted: Date): Date | null {
  const minut = ZPOZDENI_MINUT[attemptCount - 1];
  if (minut === undefined) return null;
  return new Date(ted.getTime() + minut * 60_000);
}

// Kontrola duplicity je v DB (claim_due_posts, migrace 0005) — pod zámkem na
// (account_id, content_hash), aby dvě kopie nemohly projít souběžně ani ve stejné dávce.

// ---------------------------------------------------------------- média
export const PLATNOST_URL_SEKUND = 3600;

/** Rozhraní pro podepsané URL z bucketu media (v Edge funkci supabase.storage). */
export interface Podepisovac {
  podepsat(cesta: string, platnostSekund: number): Promise<string>;
}

export async function podepisMedia(media: MediumPostu[], podepisovac: Podepisovac): Promise<PodepsaneMedium[]> {
  const serazena = [...media].sort((a, b) => a.position - b.position);
  const vysledek: PodepsaneMedium[] = [];
  for (const m of serazena) {
    vysledek.push({ ...m, url: await podepisovac.podepsat(m.storage_path, PLATNOST_URL_SEKUND) });
  }
  return vysledek;
}

/** Instagram bere jen JPEG. UI převádí; tady pojistka (i podle přípony, když chybí mime). */
export function jeJpeg(m: MediumPostu): boolean {
  if (m.mime_type) return m.mime_type.toLowerCase() === 'image/jpeg';
  return /\.jpe?g$/i.test(m.storage_path);
}

/** Normalizace popisku pro dohledání příspěvku na Instagramu. */
export function normalizujText(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ');
}
