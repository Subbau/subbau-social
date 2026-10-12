// Publikační smyčka v DB: claim_due_posts (i souběh), release_stale_posts,
// publisher_save_progress / publisher_finish s ověřením lock_token.
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jako, novaDatabaze, zalozPost, zalozUcet } from '../pomocnik/db';

let root: pg.Client;
let pripoj: () => Promise<pg.Client>;
let ucet: string;
const MINULOST = new Date(Date.now() - 3_600_000).toISOString();
const BUDOUCNOST = new Date(Date.now() + 3_600_000).toISOString();

const sluzba = <T>(c: pg.Client, fn: () => Promise<T>) => jako(c, { role: 'service_role' }, fn);
const claim = async (c: pg.Client, n = 5) =>
  sluzba(c, async () => (await c.query(`select * from public.claim_due_posts($1)`, [n])).rows);

beforeAll(async () => {
  ({ root, pripoj } = await novaDatabaze('smycka'));
  ucet = await zalozUcet(root);
});
afterAll(() => root.end());
beforeEach(async () => {
  await root.query(`delete from public.publish_attempts`);
  await root.query(`delete from public.posts`);
});

describe('claim_due_posts', () => {
  it('vezme jen splatné naplánované a zaseknuté zpracování kontejneru', async () => {
    const splatny = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST });
    const pozdeji = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: BUDOUCNOST });
    const ceka = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST, next_attempt_at: BUDOUCNOST });
    const uzCekal = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST, next_attempt_at: MINULOST, attempt_count: 1 });
    const kontejner = await zalozPost(root, ucet, {
      status: 'publishing', scheduled_at: MINULOST, step: 'container_processing', attempt_count: 1,
      locked_at: new Date(Date.now() - 60_000).toISOString(), lock_token: '00000000-0000-0000-0000-000000000001',
    });
    const kontejnerCerstvy = await zalozPost(root, ucet, {
      status: 'publishing', scheduled_at: MINULOST, step: 'container_processing',
      locked_at: new Date(Date.now() - 10_000).toISOString(),
    });
    const jinyKrok = await zalozPost(root, ucet, {
      status: 'publishing', scheduled_at: MINULOST, step: 'publishing', locked_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await zalozPost(root, ucet, { status: 'draft', scheduled_at: MINULOST });
    await zalozPost(root, ucet, { status: 'failed', scheduled_at: MINULOST });

    const vzate = await claim(root, 10);
    const ids = vzate.map((p) => p.id).sort();
    expect(ids).toEqual([splatny, uzCekal, kontejner].sort());
    expect(ids).not.toContain(pozdeji);
    expect(ids).not.toContain(ceka);
    expect(ids).not.toContain(kontejnerCerstvy);
    expect(ids).not.toContain(jinyKrok);
    for (const p of vzate) {
      expect(p.status).toBe('publishing');
      expect(p.lock_token).toBeTruthy();
      expect(new Date(p.locked_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    }
    const podle = Object.fromEntries(vzate.map((p) => [p.id, p]));
    expect(podle[splatny].attempt_count).toBe(1);
    expect(podle[uzCekal].attempt_count).toBe(2);
    expect(podle[kontejner].attempt_count).toBe(1); // pokračování kontejneru není nový pokus
    expect(podle[kontejner].lock_token).not.toBe('00000000-0000-0000-0000-000000000001');
  });

  it('respektuje limit', async () => {
    for (let i = 0; i < 7; i++) await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST });
    expect((await claim(root, 5)).length).toBe(5);
    expect((await claim(root, 5)).length).toBe(2);
    expect((await claim(root, 5)).length).toBe(0);
  });

  it('dvě spojení naráz: druhé nečeká a nevezme tentýž příspěvek', async () => {
    for (let i = 0; i < 10; i++) await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST });
    const a = await pripoj();
    const b = await pripoj();
    try {
      await a.query('begin');
      await a.query('set local role service_role');
      const prvni = (await a.query(`select * from public.claim_due_posts(5)`)).rows;
      // A drží zámky (transakce otevřená). B musí přeskočit, ne čekat.
      await b.query(`set statement_timeout = '3s'`);
      const druhy = await claim(b, 5);
      await a.query('commit');
      const ida = prvni.map((p) => p.id);
      const idb = druhy.map((p) => p.id);
      expect(ida.length).toBe(5);
      expect(idb.length).toBe(5);
      expect(ida.filter((id) => idb.includes(id))).toEqual([]);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it('čtyři běhy souběžně opakovaně: každý příspěvek vezme právě jeden', async () => {
    for (let i = 0; i < 20; i++) await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST });
    const spojeni = await Promise.all([pripoj(), pripoj(), pripoj(), pripoj()]);
    try {
      for (let kolo = 0; kolo < 5; kolo++) {
        await root.query(`update public.posts set status = 'scheduled', locked_at = null, lock_token = null`);
        const vysledky = await Promise.all(spojeni.map((c) => claim(c, 5)));
        const vse = vysledky.flat().map((p) => p.id);
        expect(new Set(vse).size).toBe(vse.length);
        expect(vse.length).toBe(20);
      }
    } finally {
      await Promise.all(spojeni.map((c) => c.end()));
    }
  });
});

describe('release_stale_posts', () => {
  it('po 20 minutách → failed / unknown_outcome, bez opakování; čerstvé nechá', async () => {
    const stary = await zalozPost(root, ucet, {
      status: 'publishing', scheduled_at: MINULOST, step: 'publishing', locked_at: new Date(Date.now() - 21 * 60_000).toISOString(),
      lock_token: '00000000-0000-0000-0000-000000000002', remote_state: '{"container_id":"c9"}', next_attempt_at: MINULOST,
      error_resolved_at: MINULOST,
    });
    const novy = await zalozPost(root, ucet, {
      status: 'publishing', scheduled_at: MINULOST, step: 'publishing', locked_at: new Date(Date.now() - 19 * 60_000).toISOString(),
    });
    const n = await sluzba(root, async () => (await root.query(`select public.release_stale_posts() n`)).rows[0].n);
    expect(n).toBe(1);
    const p = (await root.query(`select * from public.posts where id = $1`, [stary])).rows[0];
    expect(p.status).toBe('failed');
    expect(p.last_error_code).toBe('unknown_outcome');
    expect(p.last_error_message).toBe('Nevíme, jestli příspěvek vyšel — zkontrolujte stránku, než ho pustíte znovu.');
    expect(p.next_attempt_at).toBeNull();
    expect(p.error_resolved_at).toBeNull();
    expect(p.lock_token).toBeNull();
    expect(p.remote_state).toEqual({ container_id: 'c9' });
    expect((await root.query(`select status from public.posts where id = $1`, [novy])).rows[0].status).toBe('publishing');
    const a = await root.query(`select outcome, error_code from public.publish_attempts where post_id = $1`, [stary]);
    expect(a.rows).toEqual([{ outcome: 'unknown', error_code: 'unknown_outcome' }]);
    // failed se samo znovu nevezme
    expect(await claim(root, 10)).toEqual([]);
  });
});

describe('zápis výsledku s lock_token', () => {
  it('cizí token nic nezmění, správný uloží krok i výsledek', async () => {
    await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST });
    const [p] = await claim(root, 1);
    const cizi = '00000000-0000-0000-0000-000000000003';
    await sluzba(root, async () => {
      const spatne = await root.query(`select public.publisher_save_progress($1, $2, 'container_created', '{"container_id":"x"}') ok`, [p.id, cizi]);
      expect(spatne.rows[0].ok).toBe(false);
      const dobre = await root.query(`select public.publisher_save_progress($1, $2, 'container_created', '{"container_id":"c1"}') ok`, [p.id, p.lock_token]);
      expect(dobre.rows[0].ok).toBe(true);
      const konecSpatne = await root.query(`select public.publisher_finish($1, $2, '{"status":"published","external_id":"z"}') ok`, [p.id, cizi]);
      expect(konecSpatne.rows[0].ok).toBe(false);
    });
    let r = (await root.query(`select * from public.posts where id = $1`, [p.id])).rows[0];
    expect(r.status).toBe('publishing');
    expect(r.step).toBe('container_created');
    expect(r.remote_state).toEqual({ container_id: 'c1' });

    await sluzba(root, () => root.query(
      `select public.publisher_finish($1, $2, '{"status":"published","external_id":"m1","external_url":"https://x/m1","step":"done"}')`,
      [p.id, p.lock_token]));
    r = (await root.query(`select * from public.posts where id = $1`, [p.id])).rows[0];
    expect(r.status).toBe('published');
    expect(r.external_id).toBe('m1');
    expect(r.published_at).not.toBeNull();
    expect(r.lock_token).toBeNull();
    expect(r.locked_at).toBeNull();
  });

  it('pauza (publishing) zámek nechá; opakování nastaví next_attempt_at', async () => {
    await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST });
    const [p] = await claim(root, 1);
    await sluzba(root, () => root.query(
      `select public.publisher_finish($1, $2, '{"status":"publishing","step":"container_processing"}')`, [p.id, p.lock_token]));
    let r = (await root.query(`select * from public.posts where id = $1`, [p.id])).rows[0];
    expect(r.lock_token).toBe(p.lock_token);
    expect(r.step).toBe('container_processing');

    const dal = new Date(Date.now() + 120_000).toISOString();
    await sluzba(root, () => root.query(
      `select public.publisher_finish($1, $2, $3)`,
      [p.id, p.lock_token, JSON.stringify({ status: 'scheduled', next_attempt_at: dal, last_error_code: 'rate_limited', last_error_message: 'x' })]));
    r = (await root.query(`select * from public.posts where id = $1`, [p.id])).rows[0];
    expect(r.status).toBe('scheduled');
    expect(new Date(r.next_attempt_at).toISOString()).toBe(dal);
    expect(r.lock_token).toBeNull();
    expect(r.last_error_code).toBe('rate_limited');
  });

  it('nová chyba vynuluje error_resolved_at (jinak by zmizela ze stránky Chyby)', async () => {
    await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST });
    const [p] = await claim(root, 1);
    await root.query(`update public.posts set error_resolved_at = now() where id = $1`, [p.id]);
    await sluzba(root, () => root.query(
      `select public.publisher_finish($1, $2, '{"status":"failed","last_error_code":"blocked","last_error_message":"x"}')`, [p.id, p.lock_token]));
    const r = (await root.query(`select status, error_resolved_at from public.posts where id = $1`, [p.id])).rows[0];
    expect(r).toEqual({ status: 'failed', error_resolved_at: null });
  });
});

describe('publisher_return_claim', () => {
  it('naplánovaný → zpět scheduled, pokus se nepočítá; cizí token nic', async () => {
    await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: MINULOST, attempt_count: 2, remote_state: '{"video_id":"R1"}', step: 'reel_started' });
    const [p] = await claim(root, 1);
    expect(p.attempt_count).toBe(3);
    await sluzba(root, async () => {
      const cizi = await root.query(`select public.publisher_return_claim($1, gen_random_uuid()) ok`, [p.id]);
      expect(cizi.rows[0].ok).toBe(false);
      const ok = await root.query(`select public.publisher_return_claim($1, $2) ok`, [p.id, p.lock_token]);
      expect(ok.rows[0].ok).toBe(true);
    });
    const r = (await root.query(`select * from public.posts where id = $1`, [p.id])).rows[0];
    expect(r).toMatchObject({ status: 'scheduled', attempt_count: 2, lock_token: null, locked_at: null, remote_state: { video_id: 'R1' } });
    // hned se dá vzít znovu
    expect((await claim(root, 1)).map((x) => x.id)).toEqual([p.id]);
  });

  it('pokračování kontejneru zůstane publishing a claim (b) ho vezme po 45 s', async () => {
    await zalozPost(root, ucet, {
      status: 'publishing', scheduled_at: MINULOST, step: 'container_processing', attempt_count: 1,
      locked_at: new Date(Date.now() - 60_000).toISOString(), remote_state: '{"container_id":"C1"}',
    });
    const [p] = await claim(root, 1);
    await sluzba(root, () => root.query(`select public.publisher_return_claim($1, $2)`, [p.id, p.lock_token]));
    const r = (await root.query(`select * from public.posts where id = $1`, [p.id])).rows[0];
    expect(r).toMatchObject({ status: 'publishing', step: 'container_processing', attempt_count: 1 });
    expect(await claim(root, 1)).toEqual([]);
    await root.query(`update public.posts set locked_at = now() - interval '46 seconds' where id = $1`, [p.id]);
    expect((await claim(root, 1)).map((x) => x.attempt_count)).toEqual([1]);
  });
});
