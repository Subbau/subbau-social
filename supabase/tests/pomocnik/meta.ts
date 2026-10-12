// Napodobenina Graph API (mock fetch), paměťová DB pro publikační smyčku a falešné hodiny.
import type { FetchFn } from '../../functions/_shared/graph';
import { vytvorGraphKlienta } from '../../functions/_shared/graph';
import type { Prostredi, PublikacniDb } from '../../functions/_shared/publikace';
import type { MediumPostu, Pokus, Prispevek, RemoteState, Ucet, ZapisVysledku } from '../../functions/_shared/typy';

export const VERZE = 'v26.0';

export interface Volani {
  metoda: string;
  url: string;
  /** Cesta za verzí Graph API (/123/feed), u jiných hostů celá cesta. */
  cesta: string;
  params: Record<string, string>;
  hlavicky: Record<string, string>;
  /** Token z hlavičky Authorization: Bearer … (null = bez hlavičky). */
  token: string | null;
}

/**
 * 'sit' = výpadek spojení se zprávou jako v Deno (celá URL).
 * 'sit-token' = totéž, ale zpráva obsahuje i ?access_token=<token> (runtime/proxy, který
 * token do URL přidá) — ověřuje, že se token do chyb nedostane ani tak.
 */
type Odpoved = { status?: number; telo?: unknown; text?: string } | 'sit' | 'sit-token';
interface Pravidlo { metoda: string; cesta: string | RegExp; odpovedi: Odpoved[]; kdyz?: (v: Volani) => boolean }

export function mockMeta() {
  const volani: Volani[] = [];
  const pravidla: Pravidlo[] = [];

  const fetch: FetchFn = async (url, init) => {
    const u = new URL(url);
    const metoda = init?.method ?? 'GET';
    const params: Record<string, string> = Object.fromEntries(u.searchParams.entries());
    if (init?.body) Object.assign(params, Object.fromEntries(new URLSearchParams(init.body).entries()));
    const cesta = u.hostname === 'graph.facebook.com' ? u.pathname.replace(/^\/v\d+\.\d+/, '') : u.pathname;
    const hlavicky = init?.headers ?? {};
    const token = /^Bearer (.+)$/.exec(hlavicky.Authorization ?? '')?.[1] ?? null;
    const v: Volani = { metoda, url, cesta, params, hlavicky, token };
    volani.push(v);
    const p = pravidla.find((r) => r.metoda === metoda
      && (typeof r.cesta === 'string' ? r.cesta === cesta : r.cesta.test(cesta))
      && (!r.kdyz || r.kdyz(v)));
    if (!p) throw new Error(`mock: nečekané volání ${metoda} ${cesta} ${JSON.stringify(params)}`);
    const o = p.odpovedi.length > 1 ? p.odpovedi.shift()! : p.odpovedi[0];
    if (o === 'sit') throw new TypeError(`error sending request for url (${url}): client error (Connect): connection reset`);
    if (o === 'sit-token') {
      throw new TypeError(`error sending request for url (${url}${url.includes('?') ? '&' : '?'}access_token=${token}): connection reset; Authorization: Bearer ${token}`);
    }
    const status = o.status ?? 200;
    const text = o.text ?? JSON.stringify(o.telo ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };

  return {
    fetch,
    volani,
    graph: vytvorGraphKlienta({ fetch, verze: VERZE }),
    /** Přidá pravidlo; poslední odpověď se opakuje. Novější pravidla mají přednost. */
    na(metoda: string, cesta: string | RegExp, ...odpovedi: Odpoved[]) {
      pravidla.unshift({ metoda, cesta, odpovedi });
      return this;
    },
    naKdyz(metoda: string, cesta: string | RegExp, kdyz: (v: Volani) => boolean, ...odpovedi: Odpoved[]) {
      pravidla.unshift({ metoda, cesta, odpovedi, kdyz });
      return this;
    },
    kolik(metoda: string, cesta: string | RegExp, kdyz?: (v: Volani) => boolean) {
      return volani.filter((v) => v.metoda === metoda
        && (typeof cesta === 'string' ? v.cesta === cesta : cesta.test(v.cesta))
        && (!kdyz || kdyz(v))).length;
    },
    vymaz() {
      volani.length = 0;
    },
  };
}
export type MockMeta = ReturnType<typeof mockMeta>;

export const chybaGraph = (code: number, subcode?: number, status = 400, zprava = 'Chyba z Graphu') => ({
  status,
  telo: { error: { message: zprava, type: 'OAuthException', code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: 'TRACE123' } },
});

// ---------------------------------------------------------------- paměťová DB
export function pametovaDb(ucet: Ucet, media: MediumPostu[] = []) {
  const stav = {
    post: null as (Prispevek & Record<string, unknown>) | null,
    kroky: [] as { step: string; remote: RemoteState }[],
    pokusy: [] as Pokus[],
    zapisy: [] as ZapisVysledku[],
    ucet: { ...ucet } as Ucet & { last_check_error?: string },
    media,
    token: 'SYSTEMOVY_KLIC' as string | null,
    ztratitZamekPoKroku: Infinity,
    vraceno: 0,
  };
  const db: PublikacniDb = {
    async nactiUcet(id) { return id === stav.ucet.id ? { ...stav.ucet } : null; },
    async nactiMedia() { return stav.media; },
    async ziskejToken() { return stav.token; },
    async ulozPostup(postId, lock, step, remote) {
      if (!stav.post || stav.post.id !== postId || stav.post.lock_token !== lock || stav.post.status !== 'publishing') return false;
      if (stav.kroky.length >= stav.ztratitZamekPoKroku) return false;
      stav.kroky.push({ step, remote: structuredClone(remote) });
      stav.post.step = step;
      stav.post.remote_state = structuredClone(remote);
      return true;
    },
    async dokonci(postId, lock, v) {
      if (!stav.post || stav.post.id !== postId || stav.post.lock_token !== lock || stav.post.status !== 'publishing') return false;
      stav.zapisy.push(structuredClone(v));
      for (const [k, h] of Object.entries(v)) (stav.post as Record<string, unknown>)[k] = h;
      if (v.status !== 'publishing') stav.post.lock_token = '';
      return true;
    },
    async zapisPokus(p) { stav.pokusy.push(p); },
    async vratClaim(postId, lock) {
      const p = stav.post;
      if (!p || p.id !== postId || p.lock_token !== lock || p.status !== 'publishing') return false;
      stav.vraceno += 1;
      if (p.step !== 'container_processing') {
        p.status = 'scheduled';
        p.attempt_count = Math.max(p.attempt_count - 1, 0);
        p.lock_token = '';
      }
      return true;
    },
    async oznacUcetKOpojeni(_id, zprava) {
      stav.ucet.connection_status = 'needs_reconnect';
      stav.ucet.last_check_error = zprava;
    },
  };
  return { db, stav };
}

/** Simulace claim_due_posts nad paměťovou DB (zvýší attempt_count u naplánovaného). */
export function vezmi(stav: ReturnType<typeof pametovaDb>['stav']): Prispevek {
  const p = stav.post!;
  if (p.status === 'scheduled') p.attempt_count += 1;
  p.status = 'publishing';
  p.lock_token = `zamek-${Math.random()}`;
  return structuredClone(p) as Prispevek;
}

export function hodiny(start = '2026-10-12T10:00:00.000Z') {
  let t = Date.parse(start);
  return {
    ted: () => new Date(t),
    spanek: async (ms: number) => { t += ms; },
    posun(ms: number) { t += ms; },
  };
}

export function ucet(platform: Ucet['platform'], pole: Partial<Ucet> = {}): Ucet {
  return {
    id: 'ucet-1',
    platform,
    external_id: platform === 'facebook' ? 'PAGE1' : 'IG1',
    name: 'SubBau',
    is_active: true,
    connection_status: 'connected',
    credential_id: 'cred-1',
    linked_page_external_id: platform === 'instagram' ? 'PAGE1' : null,
    ...pole,
  };
}

export function post(pole: Partial<Prispevek> = {}): Prispevek & Record<string, unknown> {
  return {
    id: 'post-1',
    account_id: 'ucet-1',
    series_id: null,
    format: 'feed',
    caption: 'Dnes betonujeme strop.',
    link_url: null,
    scheduled_at: '2026-10-12T09:59:00.000Z',
    status: 'scheduled',
    platform_options: {},
    content_hash: 'hash1',
    attempt_count: 0,
    lock_token: '',
    step: null,
    remote_state: {},
    ...pole,
  };
}

export const foto = (i: number, mime = 'image/jpeg'): MediumPostu => ({ position: i, storage_path: `m/foto${i}.jpg`, kind: 'image', mime_type: mime });
export const video = (i: number): MediumPostu => ({ position: i, storage_path: `m/video${i}.mp4`, kind: 'video', mime_type: 'video/mp4' });

export const podepisovac = { podepsat: async (cesta: string, s: number) => `https://ref.supabase.co/storage/v1/object/sign/media/${cesta}?token=x&exp=${s}` };

/** Sestaví Prostředí pro zpracujPost. `termin` = ms od teď (výchozí 110 s jako publisher). */
export function prostredi(meta: MockMeta, db: PublikacniDb, h = hodiny(), terminZaMs = 110_000): Prostredi {
  return {
    db, graph: meta.graph, podepisovac, ted: h.ted, spanek: h.spanek, pageTokeny: new Map(),
    termin: new Date(h.ted().getTime() + terminZaMs),
  };
}
