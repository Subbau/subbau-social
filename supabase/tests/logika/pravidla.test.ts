// Backoff, předkontroly a termín publikační smyčky.
import { describe, expect, it } from 'vitest';
import { dalsiPokus, MAX_POKUSU } from '../../functions/_shared/pravidla';
import { zpracujPost } from '../../functions/_shared/publikace';
import { chybaGraph, foto, hodiny, mockMeta, pametovaDb, post, prostredi, ucet, vezmi } from '../pomocnik/meta';

const TED = new Date('2026-10-12T10:00:00.000Z');
const minutPo = (d: Date | null) => (d ? (d.getTime() - TED.getTime()) / 60_000 : null);

describe('backoff', () => {
  it('2 / 10 / 30 minut podle attempt_count, pak konec', () => {
    expect([1, 2, 3, 4, 5].map((n) => minutPo(dalsiPokus(n, TED)))).toEqual([2, 10, 30, null, null]);
    expect(MAX_POKUSU).toBe(4);
  });

  it('smyčka: dočasná chyba vrací do fronty se 2/10/30 min, po 3. opakování failed', async () => {
    const meta = mockMeta()
      .na('GET', '/PAGE1', { telo: { access_token: 'PT' } })
      .na('POST', '/PAGE1/feed', chybaGraph(4, undefined, 400, 'Application request limit reached'));
    const { db, stav } = pametovaDb(ucet('facebook'));
    stav.post = post();
    const h = hodiny();
    const cekani: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await zpracujPost(vezmi(stav), prostredi(meta, db, h));
      const dalsi = stav.post.next_attempt_at as string | null;
      cekani.push(dalsi ? (Date.parse(dalsi) - h.ted().getTime()) / 60_000 : null);
      expect(r.vysledek).toBe(i < 3 ? 'scheduled' : 'failed');
      h.posun(60 * 60_000);
    }
    expect(cekani).toEqual([2, 10, 30, null]);
    expect(stav.post).toMatchObject({ status: 'failed', attempt_count: 4, last_error_code: 'rate_limited' });
    expect(stav.post.last_error_message).toMatch(/ani po 4 pokusech/);
    expect(stav.pokusy.map((p) => p.outcome)).toEqual(['retryable_error', 'retryable_error', 'retryable_error', 'retryable_error']);
  });
});

// Kontrola duplicity je v DB (claim_due_posts) — testy v db/duplicita.test.ts.

describe('předkontroly a zámek', () => {
  it('TikTok → platform_not_supported', async () => {
    const meta = mockMeta();
    const { db, stav } = pametovaDb(ucet('tiktok'));
    stav.post = post();
    expect(await zpracujPost(vezmi(stav), prostredi(meta, db))).toMatchObject({ vysledek: 'failed', kod: 'platform_not_supported' });
    expect(meta.volani).toHaveLength(0);
  });

  it('vypnutý účet a nepropojený účet → failed s českou zprávou', async () => {
    for (const [pole, kod] of [[{ is_active: false }, 'account_inactive'], [{ connection_status: 'not_connected' as const }, 'not_connected'], [{ credential_id: null }, 'not_connected']] as const) {
      const { db, stav } = pametovaDb(ucet('facebook', pole));
      stav.post = post();
      expect(await zpracujPost(vezmi(stav), prostredi(mockMeta(), db))).toMatchObject({ vysledek: 'failed', kod });
    }
  });

  it('po termínu běhu se příspěvek nezačne: zpět do fronty bez započítání pokusu, nic se nevolá', async () => {
    const meta = mockMeta();
    const { db, stav } = pametovaDb(ucet('facebook'));
    stav.post = post({ attempt_count: 2 });
    const r = await zpracujPost(vezmi(stav), prostredi(meta, db, hodiny(), 0));
    expect(r).toEqual({ postId: 'post-1', vysledek: 'deferred' });
    expect(meta.volani).toHaveLength(0);
    expect(stav.vraceno).toBe(1);
    expect(stav.post).toMatchObject({ status: 'scheduled', attempt_count: 2 });
    expect(stav.pokusy).toHaveLength(0);
  });

  it('ztracený zámek: výsledek se nezapíše, příspěvek se nepřepíše', async () => {
    const meta = mockMeta().na('POST', '/IG1/media', { telo: { id: 'C1' } });
    const { db, stav } = pametovaDb(ucet('instagram'), [foto(0)]);
    stav.post = post();
    stav.ztratitZamekPoKroku = 0;
    const r = await zpracujPost(vezmi(stav), prostredi(meta, db));
    expect(r).toEqual({ postId: 'post-1', vysledek: 'lock_lost' });
    expect(stav.zapisy).toHaveLength(0);
    expect(stav.pokusy[0]).toMatchObject({ outcome: 'unknown', error_code: 'lock_lost' });
  });
});
