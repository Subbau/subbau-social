// Přechody stavů příspěvku a omezení sloupců pro klienta (trigger posts_hlidac).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chyba, jako, novaDatabaze, zalozMedium, zalozPost, zalozUcet, zalozUzivatele } from '../pomocnik/db';

let root: pg.Client;
let uzivatel: string;
let ucet: string;
const klient = () => ({ role: 'authenticated' as const, uid: uzivatel });
const jakoKlient = (sql: string, params: unknown[] = []) => jako(root, klient(), () => root.query(sql, params));
const stav = async (id: string) => (await root.query(`select * from public.posts where id = $1`, [id])).rows[0];
const ZITRA = new Date(Date.now() + 86_400_000).toISOString();

beforeAll(async () => {
  ({ root } = await novaDatabaze('prechody'));
  uzivatel = await zalozUzivatele(root, true);
  ucet = await zalozUcet(root);
});
afterAll(() => root.end());

describe('nový příspěvek od klienta', () => {
  it.each(['publishing', 'published', 'failed'])('nesmí vzniknout ve stavu %s', async (s) => {
    const e = await chyba(jakoKlient(`insert into public.posts (account_id, status, scheduled_at) values ($1, $2, $3)`, [ucet, s, ZITRA]));
    expect(e).toMatch(/jen koncept nebo naplánovaný/);
  });

  it('draft i scheduled projdou; systémové sloupce se nepřenesou', async () => {
    const r = await jakoKlient(
      `insert into public.posts (account_id, status, scheduled_at, external_id, attempt_count, remote_state, last_error_code)
       values ($1, 'scheduled', $2, 'cizi', 7, '{"container_id":"1"}', 'x') returning *`, [ucet, ZITRA]);
    const p = r.rows[0];
    expect(p.status).toBe('scheduled');
    expect(p.external_id).toBeNull();
    expect(p.attempt_count).toBe(0);
    expect(p.remote_state).toEqual({});
    expect(p.last_error_code).toBeNull();
    await jakoKlient(`insert into public.posts (account_id) values ($1)`, [ucet]);
  });

  it('naplánovaný bez času neprojde', async () => {
    expect(await chyba(jakoKlient(`insert into public.posts (account_id, status) values ($1, 'scheduled')`, [ucet])))
      .toMatch(/posts_scheduled_needs_time/);
  });
});

describe('přechody od klienta', () => {
  it('draft ↔ scheduled', async () => {
    const id = await zalozPost(root, ucet);
    await jakoKlient(`update public.posts set status = 'scheduled', scheduled_at = $2 where id = $1`, [id, ZITRA]);
    expect((await stav(id)).status).toBe('scheduled');
    await jakoKlient(`update public.posts set status = 'draft' where id = $1`, [id]);
    expect((await stav(id)).status).toBe('draft');
  });

  it.each(['publishing', 'published', 'failed'])('scheduled → %s zakázáno', async (cil) => {
    const id = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: ZITRA });
    expect(await chyba(jakoKlient(`update public.posts set status = $2 where id = $1`, [id, cil]))).toMatch(/není dovolená/);
  });

  it.each(['publishing', 'published'])('draft → %s zakázáno', async (cil) => {
    const id = await zalozPost(root, ucet);
    expect(await chyba(jakoKlient(`update public.posts set status = $2, scheduled_at = $3 where id = $1`, [id, cil, ZITRA])))
      .toMatch(/není dovolená/);
  });

  it('publishing nesmí měnit vůbec a nesmí smazat', async () => {
    const id = await zalozPost(root, ucet, { status: 'publishing', scheduled_at: ZITRA });
    expect(await chyba(jakoKlient(`update public.posts set caption = 'x' where id = $1`, [id]))).toMatch(/právě publikuje/);
    expect(await chyba(jakoKlient(`update public.posts set status = 'scheduled' where id = $1`, [id]))).toMatch(/právě publikuje/);
    expect(await chyba(jakoKlient(`update public.posts set error_resolved_at = now() where id = $1`, [id]))).toMatch(/právě publikuje/);
    expect(await chyba(jakoKlient(`delete from public.posts where id = $1`, [id]))).toMatch(/nelze smazat/);
  });

  it('published: jen error_resolved_at; smazat nelze', async () => {
    const id = await zalozPost(root, ucet, { status: 'published', scheduled_at: ZITRA, external_id: 'p1' });
    await jakoKlient(`update public.posts set error_resolved_at = now() where id = $1`, [id]);
    expect((await stav(id)).error_resolved_at).not.toBeNull();
    expect(await chyba(jakoKlient(`update public.posts set caption = 'x' where id = $1`, [id]))).toMatch(/jen „chyba vyřešena“/);
    expect(await chyba(jakoKlient(`update public.posts set status = 'draft' where id = $1`, [id]))).toMatch(/jen „chyba vyřešena“/);
    expect(await chyba(jakoKlient(`delete from public.posts where id = $1`, [id]))).toMatch(/nelze smazat/);
  });

  it('failed → scheduled vynuluje pokusy, krok a čekání; chyba zůstane', async () => {
    const id = await zalozPost(root, ucet, {
      status: 'failed', scheduled_at: ZITRA, attempt_count: 3, next_attempt_at: ZITRA, step: 'publishing',
      last_error_code: 'rate_limited', last_error_message: 'Zkusíme znovu', error_resolved_at: ZITRA,
    });
    await jakoKlient(`update public.posts set status = 'scheduled' where id = $1`, [id]);
    const p = await stav(id);
    expect(p.status).toBe('scheduled');
    expect(p.error_resolved_at).toBeNull();
    expect(p.attempt_count).toBe(0);
    expect(p.next_attempt_at).toBeNull();
    expect(p.step).toBeNull();
    expect(p.last_error_code).toBe('rate_limited');
    expect(p.last_error_message).toBe('Zkusíme znovu');
  });

  it('failed → draft projde, failed → published ne', async () => {
    const id = await zalozPost(root, ucet, { status: 'failed', scheduled_at: ZITRA, error_resolved_at: ZITRA });
    expect(await chyba(jakoKlient(`update public.posts set status = 'published' where id = $1`, [id]))).toMatch(/není dovolená/);
    await jakoKlient(`update public.posts set status = 'draft' where id = $1`, [id]);
    expect((await stav(id)).status).toBe('draft');
    expect((await stav(id)).error_resolved_at).toBeNull();
    // u chyby (failed → failed) jde „vyřešeno“ nastavit a zůstane
    const f = await zalozPost(root, ucet, { status: 'failed', scheduled_at: ZITRA });
    await jakoKlient(`update public.posts set error_resolved_at = now() where id = $1`, [f]);
    expect((await stav(f)).error_resolved_at).not.toBeNull();
  });

  it('systémové sloupce klient nezmění', async () => {
    const id = await zalozPost(root, ucet);
    for (const sql of [
      `update public.posts set attempt_count = 5 where id = $1`,
      `update public.posts set external_id = 'x' where id = $1`,
      `update public.posts set lock_token = gen_random_uuid() where id = $1`,
      `update public.posts set remote_state = '{"a":1}' where id = $1`,
      `update public.posts set last_error_code = 'x' where id = $1`,
    ]) {
      expect(await chyba(jakoKlient(sql, [id]))).toMatch(/mění jen publikační smyčka/);
    }
  });

  it('smazat koncept smí (i s médii)', async () => {
    const id = await zalozPost(root, ucet);
    const m = await zalozMedium(root);
    await root.query(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [id, m]);
    expect((await jakoKlient(`delete from public.posts where id = $1`, [id])).rowCount).toBe(1);
  });
});

describe('service_role smí vše', () => {
  it('scheduled → publishing → published a zpět', async () => {
    const id = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: ZITRA });
    await jako(root, { role: 'service_role' }, async () => {
      await root.query(`update public.posts set status = 'publishing', step = 'x' where id = $1`, [id]);
      await root.query(`update public.posts set status = 'published', external_id = 'e1', caption = 'c' where id = $1`, [id]);
      await root.query(`delete from public.posts where id = $1`, [id]);
    });
  });
});

describe('rozpracovaný stav se zahodí při změně obsahu', () => {
  it('změna textu vynuluje remote_state', async () => {
    const id = await zalozPost(root, ucet, {
      status: 'scheduled', scheduled_at: ZITRA, remote_state: '{"container_id":"c1"}', step: 'container_created',
      attempt_count: 2, next_attempt_at: ZITRA,
    });
    await jakoKlient(`update public.posts set scheduled_at = scheduled_at + interval '1 hour' where id = $1`, [id]);
    expect(await stav(id)).toMatchObject({ remote_state: { container_id: 'c1' }, attempt_count: 2 });
    await jakoKlient(`update public.posts set caption = 'jiný text' where id = $1`, [id]);
    const p = await stav(id);
    expect(p).toMatchObject({ step: null, attempt_count: 0, next_attempt_at: null });
    expect(p.remote_state).toEqual({}); // toMatchObject by {} uznal u jakéhokoli objektu
    // i u konceptu a chyby, i změna formátu / odkazu / účtu
    for (const [pocatek, zmena] of [['draft', `format = 'reel'`], ['failed', `link_url = 'https://x.cz'`]]) {
      const q = await zalozPost(root, ucet, { status: pocatek, scheduled_at: ZITRA, attempt_count: 3, next_attempt_at: ZITRA, step: 'x', remote_state: '{"a":1}' });
      await jakoKlient(`update public.posts set ${zmena} where id = $1`, [q]);
      expect(await stav(q)).toMatchObject({ step: null, attempt_count: 0, next_attempt_at: null });
      expect((await stav(q)).remote_state).toEqual({});
    }
  });

  it('změna médií vynuluje remote_state; u zveřejněného média měnit nelze', async () => {
    const id = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: ZITRA, remote_state: '{"photo_ids":["1"]}', attempt_count: 2, next_attempt_at: ZITRA });
    const m = await zalozMedium(root);
    await jakoKlient(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [id, m]);
    expect(await stav(id)).toMatchObject({ attempt_count: 0, next_attempt_at: null });
    expect((await stav(id)).remote_state).toEqual({});
    // jen pokusy bez remote_state se vynulují taky
    const jen = await zalozPost(root, ucet, { status: 'failed', scheduled_at: ZITRA, attempt_count: 4 });
    await jakoKlient(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [jen, m]);
    expect((await stav(jen)).attempt_count).toBe(0);

    const pub = await zalozPost(root, ucet, { status: 'published', scheduled_at: ZITRA });
    expect(await chyba(jakoKlient(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0)`, [pub, m])))
      .toMatch(/nelze měnit/);
  });
});

describe('audit', () => {
  it('zapíše vznik, změnu stavu, přeplánování a smazání s aktérem', async () => {
    const r = await jakoKlient(`insert into public.posts (account_id) values ($1) returning id`, [ucet]);
    const id = r.rows[0].id;
    await jakoKlient(`update public.posts set status = 'scheduled', scheduled_at = $2 where id = $1`, [id, ZITRA]);
    await jakoKlient(`update public.posts set scheduled_at = scheduled_at + interval '1 day' where id = $1`, [id]);
    await jakoKlient(`update public.posts set caption = 'jen text' where id = $1`, [id]);
    await jakoKlient(`delete from public.posts where id = $1`, [id]);
    const a = await root.query(`select actor, action, details from public.audit_log where entity_id = $1 order by id`, [id]);
    expect(a.rows.map((x) => x.action)).toEqual(['insert', 'status_change', 'reschedule', 'delete']);
    expect(a.rows.every((x) => x.actor === uzivatel)).toBe(true);
    expect(a.rows[1].details).toMatchObject({ from_status: 'draft', to_status: 'scheduled' });
  });
});
