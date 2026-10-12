// Mapování chyb → {retryable | fatal | token | unknown} + česká zpráva pro UI.
import { GraphChyba, ocistiText } from './graph.ts';

export type DruhChyby = 'retryable' | 'fatal' | 'token' | 'unknown';

export interface Klasifikace {
  druh: DruhChyby;
  /** Kód do posts.last_error_code a publish_attempts.error_code. */
  kod: string;
  /** Česká zpráva do posts.last_error_message a publish_attempts.error_message_cs. */
  zprava: string;
  http: number | null;
  /** Surová zpráva platformy (publish_attempts.error_message). */
  puvodni: string | null;
  graph: { code: number | null; subcode: number | null; type: string | null; fbtrace_id: string | null } | null;
}

/** Chyba vzniklá u nás (nepodporovaný formát, duplicita…). */
export class ChybaPublikace extends Error {
  constructor(public druh: DruhChyby, public kod: string, public zprava: string) {
    super(`${kod}: ${zprava}`);
    this.name = 'ChybaPublikace';
  }
}

export const ZPRAVA_NEJISTY_VYSLEDEK = 'Nevíme, jestli příspěvek vyšel — zkontrolujte stránku, než ho pustíte znovu.';

export const ZPRAVY: Record<string, string> = {
  token_invalid: 'Přístup k účtu přestal platit (klíč Meta je neplatný nebo odebraný). Propojte účet znovu na stránce Účty.',
  rate_limited: 'Meta dočasně omezila počet požadavků. Zkusíme to znovu.',
  meta_unavailable: 'Služba Meta je dočasně nedostupná. Zkusíme to znovu.',
  network: 'Nepodařilo se spojit se službou Meta. Zkusíme to znovu.',
  invalid_parameter: 'Meta odmítla příspěvek kvůli neplatnému údaji (často nepodporovaný formát, rozměr nebo nedostupné médium).',
  permission_denied: 'Chybí oprávnění k publikování na tento účet. Zkontrolujte přístup systémového uživatele v Meta Business Suite.',
  blocked: 'Meta příspěvek zablokovala (porušení pravidel nebo dočasný zákaz publikování).',
  duplicate_rejected: 'Meta odmítla příspěvek jako duplicitní k nedávnému příspěvku.',
  ig_daily_limit: 'Instagram: vyčerpán limit 100 příspěvků za 24 hodin. Naplánujte příspěvek znovu až za několik hodin.',
  unknown_outcome: ZPRAVA_NEJISTY_VYSLEDEK,
  graph_error: 'Meta příspěvek odmítla.',
  internal_error: 'Neočekávaná chyba při publikování. Zkusíme to znovu.',
};

const KODY_TOKEN = new Set([190, 102]);
const PODKODY_TOKEN = new Set([458, 459, 460, 463, 464, 467, 492]);
const KODY_LIMIT = new Set([4, 17, 32, 613]);
const KODY_DOCASNE = new Set([1, 2]);

function zGraphu(e: GraphChyba, druh: DruhChyby, kod: string, zprava?: string): Klasifikace {
  return {
    druh,
    kod,
    zprava: zprava ?? ZPRAVY[kod] ?? ZPRAVY.graph_error,
    http: e.http,
    puvodni: e.message,
    graph: e.sit ? null : { code: e.code, subcode: e.subcode, type: e.typ, fbtrace_id: e.fbtraceId },
  };
}

/**
 * @param publikaceOdeslana  už odešlo volání, které příspěvek zveřejňuje — u chyb,
 *   které nejsou z Graph API (pád našeho kódu, výpadek DB), pak nevíme, jak to dopadlo.
 */
export function klasifikujChybu(e: unknown, publikaceOdeslana = false): Klasifikace {
  if (e instanceof ChybaPublikace) {
    return { druh: e.druh, kod: e.kod, zprava: e.zprava, http: null, puvodni: null, graph: null };
  }
  if (e instanceof GraphChyba) {
    if (e.sit) {
      return e.publikacni
        ? zGraphu(e, 'unknown', 'unknown_outcome')
        : zGraphu(e, 'retryable', 'network');
    }
    // 2xx bez použitelného těla / id: u zveřejnění nevíme, jestli vyšel; jinak dočasná chyba.
    if (e.nejasna) {
      return e.publikacni
        ? zGraphu(e, 'unknown', 'unknown_outcome')
        : zGraphu(e, 'retryable', 'meta_unavailable');
    }
    const code = e.code ?? -1;
    if (KODY_TOKEN.has(code) || (e.subcode !== null && PODKODY_TOKEN.has(e.subcode))) {
      return zGraphu(e, 'token', 'token_invalid');
    }
    if (code === 9 && e.subcode === 2207042) return zGraphu(e, 'fatal', 'ig_daily_limit');
    if (KODY_LIMIT.has(code)) return zGraphu(e, 'retryable', 'rate_limited');
    // Zveřejňovací volání, které nejde ověřit (Facebook): dočasná chyba na straně Mety
    // neznamená, že příspěvek nevyšel → nejistý výsledek, žádné automatické opakování.
    const docasna = KODY_DOCASNE.has(code) || e.isTransient || (e.http !== null && e.http >= 500);
    if (docasna && e.publikacni && !e.overitelne) return zGraphu(e, 'unknown', 'unknown_outcome');
    if (KODY_DOCASNE.has(code) || e.isTransient) return zGraphu(e, 'retryable', 'meta_unavailable');
    if (code === 100) return zGraphu(e, 'fatal', 'invalid_parameter', `${ZPRAVY.invalid_parameter} Meta: ${e.message}`);
    if (code === 200 || code === 10 || (code > 200 && code < 300)) return zGraphu(e, 'fatal', 'permission_denied');
    if (code === 368) return zGraphu(e, 'fatal', 'blocked');
    if (code === 506) return zGraphu(e, 'fatal', 'duplicate_rejected');
    if (e.http !== null && e.http >= 500) return zGraphu(e, 'retryable', 'meta_unavailable');
    return zGraphu(e, 'fatal', 'graph_error', `${ZPRAVY.graph_error} Meta: ${e.message}`);
  }
  const text = ocistiText(e instanceof Error ? e.message : String(e));
  return publikaceOdeslana
    ? { druh: 'unknown', kod: 'unknown_outcome', zprava: ZPRAVA_NEJISTY_VYSLEDEK, http: null, puvodni: text, graph: null }
    : { druh: 'retryable', kod: 'internal_error', zprava: ZPRAVY.internal_error, http: null, puvodni: text, graph: null };
}

export const fatal = (kod: string, zprava: string) => new ChybaPublikace('fatal', kod, zprava);
