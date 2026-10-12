// Kontrola duplicity v claim_due_posts (pod zámkem na účet + content_hash).
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jako, novaDatabaze, zalozPost, zalozUcet } from '../pomocnik/db';

let root: pg.Client;
let pripoj: () => Promise<pg.Client>;
let ucet: string;
const pred = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const za = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

const claim = async (c: pg.Client, n = 5) =>
  jako(c, { role: 'service_role' }, async () => (await c.query(`select * from public.claim_due_posts($1)`, [n])).rows);
const radek = async (id: string) => (await root.query(`select * from public.posts where id = $1`, [id])).rows[0];
const kopie = (pole: Record<string, unknown> = {}) =>
  zalozPost(root, ucet, { status: 'scheduled', scheduled_at: pred(10), content_hash: 'h1', ...pole });

beforeAll(async () => {
  ({ root, pripoj } = await novaDatabaze('duplicita'));
  ucet = await zalozUcet(root);
});
afterAll(() => root.end());
beforeEach(async () => {
  await root.query(`delete from public.publish_attempts`);
  await root.query(`update public.post_series set template_post_id = null`);
  await root.query(`delete from public.posts`);
  await root.query(`delete from public.post_series`);
});

describe('claim_due_posts — duplicita', () => {
  it('A v backoffu, běh 1 vezme B; běh 2 už A nepustí (failed, odkaz na B)', async () => {
    const a = await kopie({ scheduled_at: pred(30), attempt_count: 1, next_attempt_at: za(5) });
    const b = await kopie({ scheduled_at: pred(10) });
    expect((await claim(root)).map((p) => p.id)).toEqual([b]);
    // B zůstává publishing (např. IG kontejner se zpracovává); A dočekala backoff
    await root.query(`update public.posts set next_attempt_at = $2 where id = $1`, [a, pred(1)]);
    expect(await claim(root)).toEqual([]);
    const ra = await radek(a);
    expect(ra).toMatchObject({ status: 'failed', last_error_code: 'duplicate_suspected', attempt_count: 1, error_resolved_at: null });
    expect(ra.last_error_message).toContain(b);
    expect(ra.last_error_message).toMatch(/právě zveřejňuje/);
    const pokus = (await root.query(`select outcome, error_code, remote_ids from public.publish_attempts where post_id = $1`, [a])).rows;
    expect(pokus).toEqual([{ outcome: 'fatal_error', error_code: 'duplicate_suspected', remote_ids: { duplicate_of: b, duplicate_status: 'publishing' } }]);
    expect((await radek(b)).status).toBe('publishing');
  });

  it('stejná dávka: projde jen první, druhá rovnou failed', async () => {
    const a = await kopie({ scheduled_at: pred(20) });
    const b = await kopie({ scheduled_at: pred(10) });
    const vzate = await claim(root);
    expect(vzate.map((p) => p.id)).toEqual([a]);
    expect(await radek(b)).toMatchObject({ status: 'failed', last_error_code: 'duplicate_suspected' });
  });

  it('dvě spojení naráz: druhé nečeká, kopii přeskočí; další běh ji odmítne', async () => {
    const a = await kopie({ scheduled_at: pred(20) });
    const b = await kopie({ scheduled_at: pred(10) });
    const t1 = await pripoj();
    const t2 = await pripoj();
    try {
      await t1.query('begin');
      await t1.query('set local role service_role');
      const prvni = (await t1.query(`select * from public.claim_due_posts(1)`)).rows;
      expect(prvni.map((p) => p.id)).toEqual([a]);
      await t2.query(`set statement_timeout = '3s'`);
      expect(await claim(t2)).toEqual([]); // zámek drží t1 → B se přeskočí, nic se nečeká
      expect((await radek(b)).status).toBe('scheduled');
      await t1.query('commit');
      expect(await claim(t2)).toEqual([]);
      expect(await radek(b)).toMatchObject({ status: 'failed', last_error_code: 'duplicate_suspected', attempt_count: 0 });
    } finally {
      await t1.end();
      await t2.end();
    }
  });

  it('čtyři běhy souběžně opakovaně: nikdy nejsou dvě kopie ve zveřejňování', async () => {
    const spojeni = await Promise.all([pripoj(), pripoj(), pripoj(), pripoj()]);
    try {
      for (let kolo = 0; kolo < 5; kolo++) {
        await root.query(`delete from public.publish_attempts`);
        await root.query(`delete from public.posts`);
        for (let i = 0; i < 4; i++) await kopie({ scheduled_at: pred(10 + i) });
        const vzate = (await Promise.all(spojeni.map((c) => claim(c, 1)))).flat();
        expect(vzate.length).toBe(1);
        await claim(root);
        const stavy = (await root.query(`select status::text, count(*)::int n from public.posts group by status`)).rows;
        expect(Object.fromEntries(stavy.map((r) => [r.status, r.n]))).toEqual({ publishing: 1, failed: 3 });
      }
    } finally {
      await Promise.all(spojeni.map((c) => c.end()));
    }
  });

  it('zveřejněný za 30 dní = duplicita, starší ne', async () => {
    await kopie({ status: 'published', published_at: pred(29 * 24 * 60), external_id: 'x1' });
    const a = await kopie();
    await claim(root);
    expect((await radek(a)).last_error_code).toBe('duplicate_suspected');
    expect((await radek(a)).last_error_message).toMatch(/vyšel \d\d\. \d\d\. \d{4}/);

    await root.query(`delete from public.publish_attempts`);
    await root.query(`delete from public.posts`);
    await kopie({ status: 'published', published_at: pred(31 * 24 * 60), external_id: 'x2' });
    const b = await kopie();
    expect((await claim(root)).map((p) => p.id)).toEqual([b]);
  });

  /** Čistý stav, jedna kopie se zveřejňuje (publishing), pak kandidát; vrátí, co claim vzal. */
  async function scenar(kopiePole: Record<string, unknown>, kandidat: () => Promise<string>) {
    await root.query(`delete from public.publish_attempts`);
    await root.query(`delete from public.posts`);
    await kopie({ status: 'publishing', ...kopiePole });
    const id = await kandidat();
    return { id, vzate: (await claim(root, 10)).map((p) => p.id) };
  }

  /** Čistý stav, „jiná“ kopie podle `jina`, pak kandidát (výchozí: splatná kopie); vrátí, co claim vzal. */
  async function scenarBez(jina: () => Promise<string>, kandidat: () => Promise<string> = () => kopie()) {
    await root.query(`delete from public.publish_attempts`);
    await root.query(`delete from public.posts`);
    await jina();
    const id = await kandidat();
    return { id, vzate: (await claim(root, 10)).map((p) => p.id) };
  }

  it('výjimky: allow_duplicate, stejná série, jiný účet, bez hashe; failed/draft kopie se nepočítají', async () => {
    let r = await scenar({}, () => kopie({ platform_options: '{"allow_duplicate":true}' }));
    expect(r.vzate).toEqual([r.id]);
    const ucet2 = await zalozUcet(root);
    r = await scenar({}, () => zalozPost(root, ucet2, { status: 'scheduled', scheduled_at: pred(5), content_hash: 'h1' }));
    expect(r.vzate).toEqual([r.id]);
    r = await scenar({}, () => kopie({ content_hash: null }));
    expect(r.vzate).toEqual([r.id]);
    const serie = (await root.query(`insert into public.post_series (account_id, freq, weekdays, time_of_day, starts_on)
                                     values ($1, 'weekly', '{1}', '18:00', current_date) returning id`, [ucet])).rows[0].id;
    r = await scenar({ series_id: serie }, () => kopie({ series_id: serie, scheduled_at: pred(9) }));
    expect(r.vzate).toEqual([r.id]);
    // jiná série / bez série se stejným obsahem duplicitou je (v obou směrech)
    r = await scenar({}, () => kopie({ series_id: serie }));
    expect(r.vzate).toEqual([]);
    r = await scenar({ series_id: serie }, () => kopie());
    expect(r.vzate).toEqual([]);
    r = await scenar({ status: 'failed' }, async () => {
      await kopie({ status: 'draft' });
      return kopie();
    });
    expect(r.vzate).toEqual([r.id]);
  });

  it('IG v backoffu po nejistém media_publish: splatná kopie neprojde (možná už vyšel)', async () => {
    const p = await kopie({
      scheduled_at: pred(30), attempt_count: 1, next_attempt_at: za(5), last_error_code: 'unknown_outcome',
      remote_state: '{"container_id":"C1","publish_sent_at":"2026-10-12T10:00:00Z"}',
    });
    const q = await kopie({ scheduled_at: pred(10) });
    expect(await claim(root)).toEqual([]);
    const rq = await radek(q);
    expect(rq).toMatchObject({ status: 'failed', last_error_code: 'duplicate_suspected' });
    expect(rq.last_error_message).toMatch(/možná už vyšel/);
    expect(rq.last_error_message).toContain(p);
    const pokus = (await root.query(`select remote_ids from public.publish_attempts where post_id = $1`, [q])).rows[0];
    expect(pokus.remote_ids).toEqual({ duplicate_of: p, duplicate_status: 'unknown_outcome' });
    expect((await radek(p)).status).toBe('scheduled');
  });

  it('FB failed / unknown_outcome: kopie neprojde; starší než 30 dní, jiná chyba nebo koncept ano', async () => {
    let r = await scenarBez(() => kopie({ status: 'failed', last_error_code: 'unknown_outcome' }));
    expect(r.vzate).toEqual([]);
    expect((await radek(r.id)).last_error_message).toMatch(/možná už vyšel/);
    r = await scenarBez(() => kopie({ status: 'failed', last_error_code: 'unknown_outcome', updated_at: pred(31 * 24 * 60) }));
    expect(r.vzate).toEqual([r.id]);
    r = await scenarBez(() => kopie({ status: 'failed', last_error_code: 'rate_limited' }));
    expect(r.vzate).toEqual([r.id]);
    r = await scenarBez(() => kopie({ status: 'draft', last_error_code: 'unknown_outcome' }));
    expect(r.vzate).toEqual([r.id]);
  });

  it('nejistá kopie: výjimky série a allow_duplicate platí dál', async () => {
    const serie = (await root.query(`insert into public.post_series (account_id, freq, weekdays, time_of_day, starts_on)
                                     values ($1, 'weekly', '{1}', '18:00', current_date) returning id`, [ucet])).rows[0].id;
    let r = await scenarBez(() => kopie({ status: 'failed', last_error_code: 'unknown_outcome', series_id: serie, scheduled_at: pred(40) }),
      () => kopie({ series_id: serie }));
    expect(r.vzate).toEqual([r.id]);
    r = await scenarBez(() => kopie({ status: 'failed', last_error_code: 'unknown_outcome' }),
      () => kopie({ platform_options: '{"allow_duplicate":true}' }));
    expect(r.vzate).toEqual([r.id]);
  });

  it('pokračování kontejneru (claim b) se na duplicitu nekontroluje', async () => {
    await kopie({ status: 'publishing' });
    const pokracovani = await kopie({ status: 'publishing', step: 'container_processing', locked_at: pred(2) });
    expect((await claim(root)).map((p) => p.id)).toEqual([pokracovani]);
  });
});
