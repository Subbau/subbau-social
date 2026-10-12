// Duplicity v editoru — stejné pravidlo jako claim_due_posts v DB
// (supabase/migrations/0005_publikace.sql). Příspěvek NEVYJDE (failed duplicate_suspected),
// když na stejném účtu existuje JINÝ příspěvek se stejným content_hash, který
//   - je publishing, nebo
//   - je published za posledních 30 dní, nebo
//   - skončil nejistě (last_error_code = 'unknown_outcome', stav scheduled/failed,
//     změněný za posledních 30 dní).
// Výjimky: výskyty téže série, platform_options.allow_duplicate = true.

import type { Post } from "./db-types";

export const OKNO_DUPLICITY_MS = 30 * 24 * 3600_000;

export type KandidatDuplicity = Pick<
  Post,
  | "id"
  | "status"
  | "scheduled_at"
  | "published_at"
  | "updated_at"
  | "created_at"
  | "caption"
  | "external_url"
  | "last_error_code"
  | "series_id"
>;

export type DruhDuplicity = "zastavi" | "ceka";
export type NalezenaDuplicita = KandidatDuplicity & { druh: DruhDuplicity };

export const VETA_ORIGINAL_CEKA =
  "Jakmile originál vyjde, tato kopie bez úprav nevyjde — upravte text nebo grafiku, nebo zaškrtněte ‚Opravdu zveřejnit znovu‘.";
export const VETA_ZASTAVI = "Bez potvrzení publikační smyčka příspěvek odmítne jako duplicitní.";

/** Zastavil by tenhle kandidát publikaci (stejně jako DB)? */
export function zastaviPublikaci(k: KandidatDuplicity, ted: Date): boolean {
  const od = ted.getTime() - OKNO_DUPLICITY_MS;
  if (k.status === "publishing") return true;
  if (k.status === "published") return k.published_at != null && new Date(k.published_at).getTime() >= od;
  if (k.last_error_code === "unknown_outcome" && (k.status === "scheduled" || k.status === "failed")) {
    return new Date(k.updated_at).getTime() >= od;
  }
  return false;
}

/**
 * Roztřídí kandidáty (stejný účet + content_hash, bez sebe sama):
 * - „zastavi“: podle pravidla DB příspěvek nevyjde,
 * - „ceka“: originál ještě nevyšel (koncept / naplánovaný) — až vyjde, kopie bez úprav neprojde.
 * Výskyty téže série se nepočítají. Staré chyby a starší zveřejněné se nepočítají.
 */
export function rozdelDuplicity(
  kandidati: KandidatDuplicity[],
  ja: { id: string | null; series_id: string | null },
  ted: Date = new Date(),
): NalezenaDuplicita[] {
  const vysledek: NalezenaDuplicita[] = [];
  for (const k of kandidati) {
    if (ja.id && k.id === ja.id) continue;
    if (ja.series_id && k.series_id === ja.series_id) continue;
    if (zastaviPublikaci(k, ted)) vysledek.push({ ...k, druh: "zastavi" });
    else if (k.status === "scheduled" || k.status === "draft") vysledek.push({ ...k, druh: "ceka" });
  }
  return vysledek;
}

/** Blokuje „Naplánovat“: je tu duplicita, kvůli které by DB příspěvek zastavila, a není povolená. */
export function blokujeDuplicita(nalezene: NalezenaDuplicita[], povoleno: boolean): boolean {
  return !povoleno && nalezene.some((d) => d.druh === "zastavi");
}

/** Které věty ukázat u upozornění. */
export function vetyUpozorneni(nalezene: NalezenaDuplicita[], povoleno: boolean): string[] {
  if (povoleno) return [];
  const vety: string[] = [];
  if (nalezene.some((d) => d.druh === "zastavi")) vety.push(VETA_ZASTAVI);
  if (nalezene.some((d) => d.druh === "ceka" && d.status === "scheduled")) vety.push(VETA_ORIGINAL_CEKA);
  return vety;
}
