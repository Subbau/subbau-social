// Zpracování jednoho vzatého příspěvku: kontroly → adaptér → zápis výsledku a pokusu.
// Přístup k DB, podepisování URL, čas a spánek se předávají zvenku (Edge funkce / testy).
import { ChybaPublikace, type Klasifikace, ZPRAVA_NEJISTY_VYSLEDEK, fatal, klasifikujChybu } from './chyby.ts';
import { publikujFacebook } from './facebook.ts';
import type { GraphKlient, VolbyVolani } from './graph.ts';
import { publikujInstagram } from './instagram.ts';
import {
  type Cekani, type KontextAdapteru, MAX_ODKLADU_CASU, MaloCasu, VYCHOZI_CEKANI, type VysledekAdapteru, ZPRAVA_BEZ_CASU, ZtracenyZamek,
} from './kontext.ts';
import { MAX_POKUSU, type Podepisovac, dalsiPokus, podepisMedia } from './pravidla.ts';
import type { MediumPostu, Pokus, Prispevek, RemoteState, Ucet, VysledekPokusu, ZapisVysledku } from './typy.ts';

export interface PublikacniDb {
  nactiUcet(accountId: string): Promise<Ucet | null>;
  nactiMedia(postId: string): Promise<MediumPostu[]>;
  ziskejToken(credentialId: string): Promise<string | null>;
  /** publisher_save_progress — false = zámek patří jinému běhu. */
  ulozPostup(postId: string, lockToken: string, step: string, remoteState: RemoteState): Promise<boolean>;
  /** publisher_finish — false = zámek patří jinému běhu. */
  dokonci(postId: string, lockToken: string, vysledek: ZapisVysledku): Promise<boolean>;
  /** publisher_return_claim — vrátí vzatý příspěvek do fronty bez započítání pokusu. */
  vratClaim(postId: string, lockToken: string): Promise<boolean>;
  zapisPokus(pokus: Pokus): Promise<void>;
  oznacUcetKOpojeni(accountId: string, zprava: string): Promise<void>;
}

export interface Prostredi {
  db: PublikacniDb;
  graph: GraphKlient;
  podepisovac: Podepisovac;
  ted(): Date;
  spanek(ms: number): Promise<void>;
  pageTokeny: Map<string, string>;
  cekani?: Cekani;
  /** Termín běhu (publisher: ~110 s od startu). Po něm se nové příspěvky nezačínají. */
  termin?: Date;
}

export type Souhrn =
  | { postId: string; vysledek: 'published'; externalId: string | null }
  | { postId: string; vysledek: 'processing' }
  | { postId: string; vysledek: 'scheduled' | 'failed'; kod: string; druh: Klasifikace['druh'] }
  | { postId: string; vysledek: 'lock_lost' }
  | { postId: string; vysledek: 'deferred' };

async function predkontroly(post: Prispevek, p: Prostredi): Promise<{ ucet: Ucet; token: string }> {
  const ucet = await p.db.nactiUcet(post.account_id);
  if (!ucet) throw fatal('account_missing', 'Účet příspěvku neexistuje.');
  if (ucet.platform === 'tiktok') throw fatal('platform_not_supported', 'TikTok zatím publikovat neumíme.');
  if (!ucet.is_active) throw fatal('account_inactive', 'Účet je vypnutý. Zapněte ho na stránce Účty a příspěvek naplánujte znovu.');
  if (ucet.connection_status === 'needs_reconnect') {
    throw new ChybaPublikace('token', 'needs_reconnect', 'Účet je potřeba znovu propojit (stránka Účty).');
  }
  if (ucet.connection_status !== 'connected' || !ucet.credential_id) {
    throw fatal('not_connected', 'Účet není propojený s Metou. Na stránce Účty klikněte na Načíst účty.');
  }
  // Kontrola duplicity proběhla v claim_due_posts (DB, pod zámkem) — sem duplicita nedojde.
  const token = await p.db.ziskejToken(ucet.credential_id);
  if (!token) throw fatal('not_connected', 'Klíč Meta chybí. Uložte ho znovu (admin_set_credential) a načtěte účty.');
  return { ucet, token };
}

export async function zpracujPost(post: Prispevek, p: Prostredi): Promise<Souhrn> {
  const zacatek = p.ted().toISOString();
  const zbyvaMs = () => (p.termin ? p.termin.getTime() - p.ted().getTime() : Infinity);
  // Po termínu běhu nový příspěvek nezačínat — vrátit ho do fronty, pokus se nepočítá.
  if (zbyvaMs() <= 0) {
    await p.db.vratClaim(post.id, post.lock_token);
    return { postId: post.id, vysledek: 'deferred' };
  }
  const stav: RemoteState = { ...(post.remote_state ?? {}) };
  let krokNazev: string | null = post.step;
  let publikaceOdeslana = false;
  let platforma: Ucet['platform'] | null = null;

  const pokus = (outcome: VysledekPokusu, k: Klasifikace | null, navic: Record<string, unknown> = {}): Pokus => ({
    post_id: post.id,
    started_at: zacatek,
    finished_at: p.ted().toISOString(),
    step: krokNazev,
    outcome,
    http_status: k?.http ?? null,
    error_code: k?.kod ?? null,
    error_message: k?.puvodni ?? null,
    error_message_cs: k?.zprava ?? null,
    remote_ids: { ...stav, ...navic, ...(k?.graph ? { fbtrace_id: k.graph.fbtrace_id, graph_error: k.graph } : {}) },
  });

  try {
    const { ucet, token } = await predkontroly(post, p);
    platforma = ucet.platform;
    const media = await podepisMedia(await p.db.nactiMedia(post.id), p.podepisovac);

    const kontext: KontextAdapteru = {
      graph: p.graph,
      token,
      ucet,
      post,
      media,
      stav,
      async krok(step, zmena = {}) {
        for (const [klic, hodnota] of Object.entries(zmena)) {
          if (hodnota === undefined) delete stav[klic];
          else stav[klic] = hodnota;
        }
        krokNazev = step;
        if (!(await p.db.ulozPostup(post.id, post.lock_token, step, { ...stav }))) throw new ZtracenyZamek();
      },
      publikuj<T>(cesta: string, params: Record<string, string>, tok: string, volby?: VolbyVolani) {
        publikaceOdeslana = true;
        return p.graph.post<T>(cesta, params, tok, { ...volby, publikacni: true });
      },
      ted: p.ted,
      spanek: p.spanek,
      cekani: p.cekani ?? VYCHOZI_CEKANI,
      pageTokeny: p.pageTokeny,
      zbyvaMs,
    };

    const v: VysledekAdapteru = ucet.platform === 'facebook' ? await publikujFacebook(kontext) : await publikujInstagram(kontext);

    if (v.typ === 'zpracovava') {
      // Krok container_processing je uložený; zámek zůstává, claim ho za 45 s vezme znovu.
      if (!(await p.db.dokonci(post.id, post.lock_token, { status: 'publishing', step: 'container_processing' }))) {
        throw new ZtracenyZamek();
      }
      return { postId: post.id, vysledek: 'processing' };
    }

    const zapsano = await p.db.dokonci(post.id, post.lock_token, {
      status: 'published',
      step: 'done',
      remote_state: { ...stav },
      external_id: v.externalId,
      external_url: v.externalUrl,
    });
    if (!zapsano) throw new ZtracenyZamek();
    krokNazev = 'done';
    await p.db.zapisPokus(pokus('success', null, { external_id: v.externalId, external_url: v.externalUrl }));
    return { postId: post.id, vysledek: 'published', externalId: v.externalId };
  } catch (e) {
    if (e instanceof MaloCasu) {
      // Odklady se počítají v remote_state; po MAX_ODKLADU_CASU už žádný další → failed.
      const odklady = typeof stav.odklady_casu === 'number' ? stav.odklady_casu : 0;
      if (odklady >= MAX_ODKLADU_CASU) {
        return zapisChybu(post, p, {
          druh: 'fatal', kod: 'no_time', zprava: ZPRAVA_BEZ_CASU, http: null, puvodni: e.message, graph: null,
        }, stav, platforma, pokus, publikaceOdeslana);
      }
      stav.odklady_casu = odklady + 1;
      if (!(await p.db.ulozPostup(post.id, post.lock_token, krokNazev ?? 'deferred', { ...stav }))) {
        return { postId: post.id, vysledek: 'lock_lost' };
      }
      await p.db.vratClaim(post.id, post.lock_token);
      return { postId: post.id, vysledek: 'deferred' };
    }
    if (e instanceof ZtracenyZamek) {
      await p.db.zapisPokus(pokus('unknown', {
        druh: 'unknown', kod: 'lock_lost', zprava: e.message, http: null, puvodni: null, graph: null,
      })).catch(() => {});
      return { postId: post.id, vysledek: 'lock_lost' };
    }
    return zapisChybu(post, p, klasifikujChybu(e, publikaceOdeslana), stav, platforma, pokus, publikaceOdeslana);
  }
}

async function zapisChybu(
  post: Prispevek,
  p: Prostredi,
  k: Klasifikace,
  stav: RemoteState,
  platforma: Ucet['platform'] | null,
  pokus: (o: VysledekPokusu, k: Klasifikace | null) => Pokus,
  publikaceOdeslana: boolean,
): Promise<Souhrn> {
  let zapis: ZapisVysledku;
  let outcome: VysledekPokusu;
  const selhani = (zprava = k.zprava, kod = k.kod): ZapisVysledku => ({
    status: 'failed', next_attempt_at: null, last_error_code: kod, last_error_message: zprava,
  });

  if (k.druh === 'token') {
    outcome = 'fatal_error';
    zapis = { ...selhani(), remote_state: { ...stav } };
    await p.db.oznacUcetKOpojeni(post.account_id, k.zprava);
  } else if (k.druh === 'fatal') {
    outcome = 'fatal_error';
    // Rozpracovaný stav po trvalé chybě nemá smysl držet (je v publish_attempts.remote_ids) —
    // KROMĚ případu, kdy už odešlo zveřejnění (publish_sent_at / zveřejňovací volání): pak je
    // kontejner jediný důkaz, a ruční „zkusit znovu“ podle něj pozná, že příspěvek vyšel.
    const ponechat = publikaceOdeslana || Boolean(stav.publish_sent_at);
    zapis = { ...selhani(), remote_state: ponechat ? { ...stav } : {} };
  } else if (k.druh === 'unknown') {
    outcome = 'unknown';
    // Instagram: kontejner známe → další pokus nejdřív ověří jeho stav, nic nezdvojí.
    const bezpecneOpakovat = platforma === 'instagram' && Boolean(stav.container_id);
    const dalsi = bezpecneOpakovat ? dalsiPokus(post.attempt_count, p.ted()) : null;
    zapis = dalsi
      ? {
        status: 'scheduled', next_attempt_at: dalsi.toISOString(), last_error_code: 'unknown_outcome',
        last_error_message: 'Instagram neodpověděl, jestli příspěvek vyšel. Při dalším pokusu nejdřív ověříme stav, nic se nezdvojí.',
        remote_state: { ...stav },
      }
      : { ...selhani(ZPRAVA_NEJISTY_VYSLEDEK, 'unknown_outcome'), remote_state: { ...stav } };
  } else {
    outcome = 'retryable_error';
    const dalsi = dalsiPokus(post.attempt_count, p.ted());
    zapis = dalsi
      ? { status: 'scheduled', next_attempt_at: dalsi.toISOString(), last_error_code: k.kod, last_error_message: k.zprava, remote_state: { ...stav } }
      : { ...selhani(`${k.zprava.replace(/ Zkusíme to znovu\.$/, '')} Nepodařilo se ani po ${MAX_POKUSU} pokusech.`), remote_state: { ...stav } };
  }

  const zapsano = await p.db.dokonci(post.id, post.lock_token, zapis);
  await p.db.zapisPokus(pokus(outcome, k)).catch(() => {});
  if (!zapsano) return { postId: post.id, vysledek: 'lock_lost' };
  return { postId: post.id, vysledek: zapis.status === 'scheduled' ? 'scheduled' : 'failed', kod: k.kod, druh: k.druh };
}
