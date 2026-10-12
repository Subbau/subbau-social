// Klient Graph API. fetch se předává zvenku (Deno v Edge funkci, mock v testech).
// Token jde v hlavičce Authorization: Bearer (ne v URL), takže ho Deno nevypíše
// ve zprávě o selhání fetch. Každý text chyby navíc prochází ocistiText(): URL a
// access_token=… se z něj odstraní, kdyby se tam přece jen objevily.

/** Jediné místo s výchozí verzí Graph API; přebíjí ji env GRAPH_API_VERSION. */
export const VYCHOZI_VERZE_GRAPH = 'v26.0';
export const GRAPH_HOST = 'https://graph.facebook.com';
const VYCHOZI_LIMIT_MS = 30_000;

export function verzeGraph(zEnv: string | undefined | null): string {
  const v = (zEnv ?? '').trim();
  return /^v\d+\.\d+$/.test(v) ? v : VYCHOZI_VERZE_GRAPH;
}

/** Odstraní z textu URL a hodnoty tokenů (Deno uvádí ve zprávě o selhání fetch celou URL). */
export function ocistiText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)'"]+/g, '[URL]')
    .replace(/(access_token=)[^&\s)'",]+/gi, '$1***')
    .replace(/(access_token%3D)[A-Za-z0-9_\-.|]+/gi, '$1***')
    .replace(/("access_token"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9_\-.|]{16,}/g, '$1 ***');
}

export interface OdpovedFetch {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export interface VolbyFetch {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type FetchFn = (url: string, init?: VolbyFetch) => Promise<OdpovedFetch>;

export interface GraphChybaUdaje {
  http: number | null;
  code: number | null;
  subcode: number | null;
  typ: string | null;
  fbtraceId: string | null;
  isTransient: boolean;
  /** Výpadek spojení / timeout — nevíme, jestli požadavek došel. */
  sit: boolean;
  /** Šlo o volání, které příspěvek zveřejňuje (tam je výpadek = nejistý výsledek). */
  publikacni: boolean;
  /** Zveřejnění jde ověřit (viz VolbyVolani.overitelne). */
  overitelne: boolean;
  /** HTTP 2xx, ale prázdné / ne-JSON tělo nebo chybí očekávané id — nevíme, co se stalo. */
  nejasna: boolean;
}

export class GraphChyba extends Error implements GraphChybaUdaje {
  http: number | null;
  code: number | null;
  subcode: number | null;
  typ: string | null;
  fbtraceId: string | null;
  isTransient: boolean;
  sit: boolean;
  publikacni: boolean;
  overitelne: boolean;
  nejasna: boolean;

  constructor(zprava: string, u: Partial<GraphChybaUdaje>) {
    super(ocistiText(zprava));
    this.name = 'GraphChyba';
    this.http = u.http ?? null;
    this.code = u.code ?? null;
    this.subcode = u.subcode ?? null;
    this.typ = u.typ ?? null;
    this.fbtraceId = u.fbtraceId ?? null;
    this.isTransient = u.isTransient ?? false;
    this.sit = u.sit ?? false;
    this.publikacni = u.publikacni ?? false;
    this.overitelne = u.overitelne ?? false;
    this.nejasna = u.nejasna ?? false;
  }
}

export interface VolbyVolani {
  /** Volání příspěvek zveřejňuje: výpadek spojení = nejistý výsledek. */
  publikacni?: boolean;
  /**
   * Výsledek zveřejnění jde dodatečně ověřit (IG: stav kontejneru). Bez toho (Facebook)
   * se u zveřejňovacího volání i HTTP ≥ 500, kódy 1/2 a is_transient berou jako nejisté.
   */
  overitelne?: boolean;
  limitMs?: number;
}

/**
 * Vrátí id z úspěšné odpovědi. Chybí-li, je výsledek nejasný: u zveřejňovacího volání
 * (publikacni) to znamená „nevíme, jestli vyšel“, u přípravného kroku dočasnou chybu.
 */
export function potvrzeneId(odpoved: unknown, klic: string, publikacni: boolean): string {
  const v = (odpoved as Record<string, unknown> | null)?.[klic];
  if ((typeof v === 'string' && v !== '') || typeof v === 'number') return String(v);
  throw new GraphChyba(`Meta odpověděla bez ${klic}`, { http: 200, publikacni, nejasna: true });
}

export interface GraphKlient {
  readonly verze: string;
  get<T>(cesta: string, params: Record<string, string>, token: string, volby?: VolbyVolani): Promise<T>;
  post<T>(cesta: string, params: Record<string, string>, token: string, volby?: VolbyVolani): Promise<T>;
  /** POST na plnou URL (nahrávání reelu na rupload.facebook.com) s vlastními hlavičkami. */
  postNaUrl<T>(url: string, hlavicky: Record<string, string>, volby?: VolbyVolani): Promise<T>;
}

export function vytvorGraphKlienta(nastaveni: { fetch: FetchFn; verze?: string; limitMs?: number }): GraphKlient {
  const verze = verzeGraph(nastaveni.verze);
  const zaklad = `${GRAPH_HOST}/${verze}`;
  const vychoziLimit = nastaveni.limitMs ?? VYCHOZI_LIMIT_MS;

  async function volej<T>(url: string, init: VolbyFetch, volby: VolbyVolani = {}): Promise<T> {
    const publikacni = volby.publikacni ?? false;
    const overitelne = volby.overitelne ?? false;
    let odpoved: OdpovedFetch;
    let text: string;
    try {
      odpoved = await nastaveni.fetch(url, { ...init, signal: AbortSignal.timeout(volby.limitMs ?? vychoziLimit) });
      text = await odpoved.text();
    } catch (e) {
      const duvod = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      throw new GraphChyba(`Spojení s Graph API selhalo (${duvod})`, { sit: true, publikacni, overitelne });
    }
    let telo: unknown = null;
    try {
      telo = text ? JSON.parse(text) : null;
    } catch {
      telo = null;
    }
    const chyba = (telo as { error?: Record<string, unknown> } | null)?.error;
    if (!odpoved.ok || chyba) {
      const cislo = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : null);
      throw new GraphChyba(
        typeof chyba?.message === 'string' ? chyba.message : `HTTP ${odpoved.status}`,
        {
          http: odpoved.status,
          code: cislo(chyba?.code),
          subcode: cislo(chyba?.error_subcode),
          typ: typeof chyba?.type === 'string' ? chyba.type : null,
          fbtraceId: typeof chyba?.fbtrace_id === 'string' ? chyba.fbtrace_id : null,
          isTransient: chyba?.is_transient === true,
          publikacni,
          overitelne,
        },
      );
    }
    if (telo === null) {
      throw new GraphChyba('Graph API vrátilo prázdnou nebo neplatnou odpověď', { http: odpoved.status, publikacni, overitelne, nejasna: true });
    }
    return telo as T;
  }

  const cestaNaUrl = (cesta: string) => `${zaklad}/${cesta.replace(/^\/+/, '')}`;

  return {
    verze,
    get<T>(cesta: string, params: Record<string, string>, token: string, volby?: VolbyVolani) {
      const q = new URLSearchParams(params).toString();
      return volej<T>(`${cestaNaUrl(cesta)}${q ? `?${q}` : ''}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }, volby);
    },
    post<T>(cesta: string, params: Record<string, string>, token: string, volby?: VolbyVolani) {
      return volej<T>(cestaNaUrl(cesta), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` },
        body: new URLSearchParams(params).toString(),
      }, volby);
    },
    postNaUrl<T>(url: string, hlavicky: Record<string, string>, volby?: VolbyVolani) {
      return volej<T>(url, { method: 'POST', headers: hlavicky }, volby);
    },
  };
}
