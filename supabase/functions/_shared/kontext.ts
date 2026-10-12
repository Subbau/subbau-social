// Kontext, který publikační smyčka předává adaptérům Facebook/Instagram.
import type { GraphKlient, VolbyVolani } from './graph.ts';
import type { PodepsaneMedium, Prispevek, RemoteState, Ucet } from './typy.ts';

/** Zámek příspěvku mezitím převzal jiný běh (nebo ho uvolnil release_stale_posts). */
export class ZtracenyZamek extends Error {
  constructor() {
    super('Příspěvek mezitím převzal jiný běh — výsledek se nezapisuje.');
    this.name = 'ZtracenyZamek';
  }
}

/**
 * Do termínu běhu nezbývá dost času na další krok. Příspěvek se vrátí do fronty
 * (publisher_return_claim) bez započítání pokusu; uložený remote_state zůstává.
 */
export class MaloCasu extends Error {
  constructor(krok: string) {
    super(`Do konce běhu nezbývá dost času na krok ${krok} — příspěvek se vrací do fronty.`);
    this.name = 'MaloCasu';
  }
}

/** Nejdelší krok (nahrání videa / reelu přes file_url). Musí se vejít do termínu běhu. */
export const DLOUHY_KROK_MS = 90_000;

/** Kolikrát smí být příspěvek vrácen kvůli nedostatku času (MaloCasu), pak failed. */
export const MAX_ODKLADU_CASU = 10;
export const ZPRAVA_BEZ_CASU =
  'Video se nepodařilo začít nahrávat — server neměl ani po 10 pokusech dost času. Zkuste příspěvek naplánovat znovu.';

export interface Cekani {
  /** Jak dlouho v jednom běhu čekat na zpracování IG kontejneru (výchozí 20 s). */
  celkemMs: number;
  /** Rozestup dotazů na stav kontejneru (výchozí 3 s). */
  intervalMs: number;
  /** Po jaké době od vytvoření kontejneru to vzdát (výchozí 60 min). */
  vzdatPoMs: number;
}
export const VYCHOZI_CEKANI: Cekani = { celkemMs: 20_000, intervalMs: 3_000, vzdatPoMs: 60 * 60_000 };

export interface KontextAdapteru {
  graph: GraphKlient;
  /** Klíč systémového uživatele Meta. */
  token: string;
  ucet: Ucet;
  post: Prispevek;
  media: PodepsaneMedium[];
  /** Aktuální remote_state (mění ho jen `krok`). */
  readonly stav: RemoteState;
  /** Uloží krok + změnu remote_state do DB (ověřuje lock_token). undefined = smazat klíč. */
  krok(step: string, zmena?: Partial<RemoteState>): Promise<void>;
  /** POST, který příspěvek zveřejňuje: od té chvíle je výpadek = nejistý výsledek. */
  publikuj<T>(cesta: string, params: Record<string, string>, token: string, volby?: VolbyVolani): Promise<T>;
  ted(): Date;
  spanek(ms: number): Promise<void>;
  cekani: Cekani;
  /** Cache page tokenů v rámci jednoho běhu (page id → token). */
  pageTokeny: Map<string, string>;
  /** Kolik ms zbývá do termínu běhu (publisher ~110 s od startu). */
  zbyvaMs(): number;
}

export type VysledekAdapteru =
  | { typ: 'publikovano'; externalId: string | null; externalUrl: string | null }
  | { typ: 'zpracovava' };
