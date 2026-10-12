// Skupiny (0008): RLS a granty, create_group_campaign, due_group_batches (i souběh), trigger úkolů.
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chyba, jako, novaDatabaze, zalozMedium, zalozUzivatele } from '../pomocnik/db';

let root: pg.Client;
let pripoj: () => Promise<pg.Client>;
let majitel: string;
let druhy: string;
let cizi: string;
const TABULKY = ['fb_groups', 'group_campaigns', 'group_campaign_media', 'group_batches', 'group_tasks', 'push_subscriptions'];
const HOD = 3_600_000;
const iso = (msOdTed: number) => new Date(Date.now() + msOdTed).toISOString();

const app = (uid = majitel) => ({ role: 'authenticated' as const, uid });
const sluzba = <T>(c: pg.Client, fn: () => Promise<T>) => jako(c, { role: 'service_role' }, fn);

async function skupina(pole: Record<string, unknown> = {}): Promise<string> {
  const r = await root.query(
    `insert into public.fb_groups (name, url, is_active, sady) values ($1, $2, $3, $4) returning id`,
    [pole.name ?? 'Skupina', pole.url ?? null, pole.is_active ?? true, pole.sady ?? '{}']);
  return r.rows[0].id as string;
}

async function kampan(skupiny: string[], pole: Record<string, unknown> = {}, uid = majitel): Promise<string> {
  return jako(root, app(uid), async () => (await root.query(
    `select public.create_group_campaign($1, $2, $3, $4, $5, $6, $7) id`,
    [pole.title ?? 'Nábor', pole.variants ?? ['Text A', 'Text B', 'Text C'], pole.assets ?? [], skupiny,
     pole.starts_at ?? iso(-HOD), pole.batch_size ?? 20, pole.interval ?? 120])).rows[0].id as string);
}

const due = (c: pg.Client = root, n = 10) =>
  sluzba(c, async () => (await c.query(`select * from public.due_group_batches($1)`, [n])).rows);

beforeAll(async () => {
  ({ root, pripoj } = await novaDatabaze('skupiny'));
  majitel = await zalozUzivatele(root, true);
  druhy = await zalozUzivatele(root, true);
  cizi = await zalozUzivatele(root, false);
});
afterAll(() => root.end());
beforeEach(async () => {
  await root.query(`delete from public.group_campaigns`);
  await root.query(`delete from public.fb_groups`);
  await root.query(`delete from public.push_subscriptions`);
});

describe('práva', () => {
  beforeEach(async () => {
    const g = await skupina();
    await kampan([g]);
    await root.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/a', 'k', 'a')`, [majitel]);
  });

  it.each(TABULKY)('anon nesmí číst %s', async (t) => {
    expect(await chyba(jako(root, { role: 'anon' }, () => root.query(`select * from public.${t}`)))).toMatch(/permission denied/);
  });

  it('anon nesmí volat funkce skupin', async () => {
    expect(await chyba(jako(root, { role: 'anon' }, () =>
      root.query(`select public.create_group_campaign('x', '{a}', '{}', '{}', now(), 20, 120)`)))).toMatch(/permission denied/);
    expect(await chyba(jako(root, { role: 'anon' }, () => root.query(`select * from public.due_group_batches(10)`)))).toMatch(/permission denied/);
    const r = await root.query(`select
      has_function_privilege('anon', 'public.create_group_campaign(text, text[], uuid[], uuid[], timestamptz, int, int)', 'EXECUTE') a,
      has_function_privilege('anon', 'public.due_group_batches(int)', 'EXECUTE') b,
      has_function_privilege('anon', 'public.varianty_platne(text[])', 'EXECUTE') c,
      has_function_privilege('authenticated', 'public.due_group_batches(int)', 'EXECUTE') d,
      has_function_privilege('authenticated', 'public.create_group_campaign(text, text[], uuid[], uuid[], timestamptz, int, int)', 'EXECUTE') e,
      has_function_privilege('anon', 'public.release_group_batch(uuid)', 'EXECUTE') f,
      has_function_privilege('authenticated', 'public.release_group_batch(uuid)', 'EXECUTE') g,
      has_function_privilege('service_role', 'public.release_group_batch(uuid)', 'EXECUTE') h`);
    expect(r.rows[0]).toEqual({ a: false, b: false, c: false, d: false, e: true, f: false, g: false, h: true });
    expect(await chyba(jako(root, app(), () => root.query(`select public.release_group_batch(gen_random_uuid())`)))).toMatch(/permission denied/);
  });

  it.each(TABULKY)('přihlášený mimo app_users nevidí nic v %s', async (t) => {
    expect((await jako(root, app(cizi), () => root.query(`select * from public.${t}`))).rowCount).toBe(0);
  });

  it('přihlášený mimo app_users nic nezaloží ani přes create_group_campaign', async () => {
    expect(await chyba(jako(root, app(cizi), () =>
      root.query(`insert into public.fb_groups (name) values ('x')`)))).toMatch(/row-level security/);
    const g = (await root.query(`select id from public.fb_groups limit 1`)).rows[0].id;
    const pred = (await root.query(`select count(*)::int n from public.group_campaigns`)).rows[0].n;
    expect(await chyba(kampan([g], {}, cizi))).toMatch(/Nemáte přístup do aplikace/);
    expect((await root.query(`select count(*)::int n from public.group_campaigns`)).rows[0].n).toBe(pred);
  });

  it('app_user: CRUD skupin, vidí kampaně, dávky, úkoly a média', async () => {
    await jako(root, app(), async () => {
      const r = await root.query(`insert into public.fb_groups (name, url, sady) values ('Němci', 'https://www.facebook.com/groups/1', '{OSVČ Německo}') returning id`);
      expect((await root.query(`update public.fb_groups set note = 'Jen pondělí' where id = $1`, [r.rows[0].id])).rowCount).toBe(1);
      expect((await root.query(`delete from public.fb_groups where id = $1`, [r.rows[0].id])).rowCount).toBe(1);
      for (const t of TABULKY.filter((x) => x !== 'group_campaign_media')) {
        expect((await root.query(`select * from public.${t}`)).rowCount).toBeGreaterThan(0);
      }
    });
  });

  it('dávky: app_user jen čte (vložit, změnit ani smazat nesmí); smazání kampaně je smaže s ní', async () => {
    const b = (await root.query(`select id, campaign_id from public.group_batches limit 1`)).rows[0];
    await root.query(`update public.group_batches set notified_at = now() where id = $1`, [b.id]);
    await jako(root, app(), async () => {
      expect((await root.query(`select * from public.group_batches`)).rowCount).toBeGreaterThan(0);
    });
    for (const sql of [
      `update public.group_batches set notified_at = null`,
      `delete from public.group_batches`,
      `insert into public.group_batches (campaign_id, batch_no, due_at) values ('${b.campaign_id}', 99, now())`,
    ]) {
      expect(await chyba(jako(root, app(), () => root.query(sql)))).toMatch(/permission denied/);
    }
    expect((await root.query(`select notified_at from public.group_batches where id = $1`, [b.id])).rows[0].notified_at).not.toBeNull();
    const r = await root.query(`select
      has_table_privilege('authenticated', 'public.group_batches', 'UPDATE') u,
      has_table_privilege('authenticated', 'public.group_batches', 'INSERT') i,
      has_table_privilege('authenticated', 'public.group_batches', 'DELETE') d`);
    expect(r.rows[0]).toEqual({ u: false, i: false, d: false });
    await jako(root, app(), () => root.query(`delete from public.group_campaigns where id = $1`, [b.campaign_id]));
    expect((await root.query(`select count(*)::int n from public.group_batches where campaign_id = $1`, [b.campaign_id])).rows[0].n).toBe(0);
  });

  it('due_group_batches jen service_role', async () => {
    expect(await chyba(jako(root, app(), () => root.query(`select * from public.due_group_batches(10)`)))).toMatch(/permission denied/);
    await due();
  });

  it('push_subscriptions: každý jen své (číst, vložit, změnit, smazat)', async () => {
    await jako(root, app(druhy), async () => {
      expect((await root.query(`select * from public.push_subscriptions`)).rowCount).toBe(0);
      await root.query(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push/b', 'k', 'a')`);
      const moje = await root.query(`select user_id from public.push_subscriptions`);
      expect(moje.rows).toEqual([{ user_id: druhy }]);
      expect((await root.query(`delete from public.push_subscriptions where endpoint = 'https://push/a'`)).rowCount).toBe(0);
      expect((await root.query(`update public.push_subscriptions set auth = 'x' where endpoint = 'https://push/a'`)).rowCount).toBe(0);
    });
    expect(await chyba(jako(root, app(druhy), () =>
      root.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/c', 'k', 'a')`, [majitel]))))
      .toMatch(/row-level security/);
    expect(await chyba(jako(root, app(druhy), () =>
      root.query(`update public.push_subscriptions set user_id = $1 where endpoint = 'https://push/b'`, [majitel])))).toMatch(/row-level security/);
    expect(await chyba(jako(root, app(cizi), () =>
      root.query(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push/d', 'k', 'a')`)))).toMatch(/row-level security/);
    // bez WHERE: platí jen politika update/delete (select politika se nepřidá) → musí stačit sama
    expect(await chyba(jako(root, app(druhy), () =>
      root.query(`update public.push_subscriptions set user_id = $1`, [majitel])))).toMatch(/row-level security/);
    await jako(root, app(druhy), () => root.query(`delete from public.push_subscriptions`));
    expect((await root.query(`select endpoint from public.push_subscriptions order by 1`)).rows).toEqual([{ endpoint: 'https://push/a' }]);
  });

  it('url skupiny je unikátní, jméno ne', async () => {
    await skupina({ name: 'Stejná', url: 'https://www.facebook.com/groups/9' });
    await skupina({ name: 'Stejná' });
    await skupina({ name: 'Stejná' });
    expect(await chyba(skupina({ name: 'Jiná', url: 'https://www.facebook.com/groups/9' }))).toMatch(/fb_groups_url_key/);
  });
});

describe('create_group_campaign', () => {
  it('rozpis: dávky po 20 s odstupem, pořadí pole, varianty se střídají, neaktivní a duplicity přeskočí', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 45; i++) ids.push(await skupina({ name: `S${i}`, is_active: i % 10 !== 9 })); // 4 neaktivní
    const pole = [...ids, ids[0], ids[1], '00000000-0000-0000-0000-000000000000'];
    const start = '2026-11-02T08:00:00.000Z';
    const m1 = await zalozMedium(root);
    const m2 = await zalozMedium(root);
    const id = await kampan(pole, { starts_at: start, assets: [m2, m1] });

    const aktivni = ids.filter((_, i) => i % 10 !== 9);
    const ulohy = (await root.query(
      `select t.group_id, t.variant_index, b.batch_no, t.status from public.group_tasks t
         join public.group_batches b on b.id = t.batch_id where t.campaign_id = $1
        order by b.batch_no, (select g.name from public.fb_groups g where g.id = t.group_id) collate "C"`, [id])).rows;
    expect(ulohy).toHaveLength(41);
    const podleSkupiny = Object.fromEntries(ulohy.map((u) => [u.group_id, u]));
    aktivni.forEach((g, i) => {
      expect(podleSkupiny[g]).toMatchObject({ variant_index: i % 3, batch_no: Math.floor(i / 20) + 1, status: 'pending' });
    });
    const davky = (await root.query(`select batch_no, due_at, notified_at from public.group_batches where campaign_id = $1 order by batch_no`, [id])).rows;
    expect(davky.map((d) => [d.batch_no, d.due_at.toISOString(), d.notified_at])).toEqual([
      [1, '2026-11-02T08:00:00.000Z', null],
      [2, '2026-11-02T10:00:00.000Z', null],
      [3, '2026-11-02T12:00:00.000Z', null],
    ]);
    const media = (await root.query(`select asset_id, position from public.group_campaign_media where campaign_id = $1 order by position`, [id])).rows;
    expect(media).toEqual([{ asset_id: m2, position: 0 }, { asset_id: m1, position: 1 }]);
    const k = (await root.query(`select * from public.group_campaigns where id = $1`, [id])).rows[0];
    expect(k).toMatchObject({ title: 'Nábor', status: 'active', batch_size: 20, batch_interval_minutes: 120, created_by: majitel });
  });

  it('jedna varianta, výchozí velikost a odstup při null', async () => {
    const ids = [await skupina(), await skupina(), await skupina()];
    const id = await jako(root, app(), async () => (await root.query(
      `select public.create_group_campaign('X', '{Jediný text}', null, $1, '2026-11-02T08:00:00Z', null, null) id`, [ids])).rows[0].id);
    const k = (await root.query(`select batch_size, batch_interval_minutes from public.group_campaigns where id = $1`, [id])).rows[0];
    expect(k).toEqual({ batch_size: 20, batch_interval_minutes: 120 });
    const v = (await root.query(`select distinct variant_index from public.group_tasks where campaign_id = $1`, [id])).rows;
    expect(v).toEqual([{ variant_index: 0 }]);
  });

  it('chyby česky; nic se nezaloží', async () => {
    const g = await skupina();
    const neaktivni = await skupina({ is_active: false });
    expect(await chyba(kampan([g], { title: '  ' }))).toMatch(/musí mít název/);
    expect(await chyba(kampan([g], { variants: [] }))).toMatch(/1 až 3 varianty/);
    expect(await chyba(kampan([g], { variants: ['a', 'b', 'c', 'd'] }))).toMatch(/1 až 3 varianty/);
    expect(await chyba(kampan([g], { variants: ['a', '   '] }))).toMatch(/nesmí být prázdná/);
    expect(await chyba(kampan([]))).toMatch(/aspoň jednu skupinu/);
    expect(await chyba(kampan([neaktivni]))).toMatch(/Žádná z vybraných skupin není aktivní/);
    expect(await chyba(jako(root, app(), () => root.query(
      `select public.create_group_campaign('X', '{a}', '{}', $1, null, 20, 120)`, [[g]])))).toMatch(/Chybí čas začátku/);
    expect(await chyba(kampan([g], { batch_size: 101 }))).toMatch(/batch_size/);
    expect(await chyba(kampan([g], { interval: 14 }))).toMatch(/batch_interval_minutes/);
    // neexistující médium → celá rozesílka se vrátí (jedna transakce)
    expect(await chyba(kampan([g], { assets: ['00000000-0000-0000-0000-000000000000'] }))).toMatch(/foreign key/);
    expect((await root.query(`select count(*)::int n from public.group_campaigns`)).rows[0].n).toBe(0);
  });

  it('varianty se kontrolují i v tabulce', async () => {
    expect(await chyba(root.query(`insert into public.group_campaigns (title, variants, starts_at) values ('x', '{a,""}', now())`)))
      .toMatch(/group_campaigns_variants_check/);
    expect(await chyba(root.query(`insert into public.group_campaigns (title, variants, starts_at) values ('x', '{}', now())`)))
      .toMatch(/group_campaigns_variants_check/);
  });
});

describe('due_group_batches', () => {
  it('vrátí splatné dávky s počty, zmeškané > 12 h jen označí, budoucí a zrušené nechá', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await skupina());
    // dávky po 2 skupinách, start před 13 h, odstup 12 h → dávka 1: −13 h, 2: −1 h, 3: +11 h
    const id = await kampan(ids, { starts_at: iso(-13 * HOD), batch_size: 2, interval: 720, title: 'Jaro' });
    const zrusena = await kampan([await skupina()], { starts_at: iso(-HOD) });
    await root.query(`update public.group_campaigns set status = 'cancelled' where id = $1`, [zrusena]);

    const r = await due();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ campaign_id: id, campaign_title: 'Jaro', batch_no: 2, batch_count: 3, pending_count: 2 });
    const davky = (await root.query(`select batch_no, notified_at is not null as oznamena from public.group_batches where campaign_id = $1 order by batch_no`, [id])).rows;
    expect(davky).toEqual([{ batch_no: 1, oznamena: true }, { batch_no: 2, oznamena: true }, { batch_no: 3, oznamena: false }]);
    expect((await root.query(`select notified_at from public.group_batches where campaign_id = $1`, [zrusena])).rows[0].notified_at).toBeNull();
    expect(await due()).toEqual([]);
  });

  it('hranice 12 h: 11 h 59 min se vrátí, 12 h 1 min ne', async () => {
    const a = await kampan([await skupina()], { starts_at: iso(-(12 * HOD - 60_000)) });
    const b = await kampan([await skupina()], { starts_at: iso(-(12 * HOD + 60_000)) });
    expect((await due()).map((x) => x.campaign_id)).toEqual([a]);
    expect((await root.query(`select notified_at is not null n from public.group_batches where campaign_id = $1`, [b])).rows[0].n).toBe(true);
  });

  it('dávka bez čekajících úkolů se označí, ale nevrátí', async () => {
    const id = await kampan([await skupina(), await skupina()], { starts_at: iso(-HOD) });
    await jako(root, app(), () => root.query(`update public.group_tasks set status = 'skipped' where campaign_id = $1`, [id]));
    await root.query(`update public.group_campaigns set status = 'active' where id = $1`, [id]);
    expect(await due()).toEqual([]);
    expect((await root.query(`select notified_at is not null n from public.group_batches where campaign_id = $1`, [id])).rows[0].n).toBe(true);
  });

  it('limit', async () => {
    for (let i = 0; i < 4; i++) await kampan([await skupina()], { starts_at: iso(-HOD - i * 60_000) });
    expect(await due(root, 3)).toHaveLength(3);
    expect(await due(root, 3)).toHaveLength(1);
  });

  it('dvě spojení naráz: druhé nečeká a dávku nevrátí; ani po potvrzení prvního', async () => {
    for (let i = 0; i < 3; i++) await kampan([await skupina()], { starts_at: iso(-HOD) });
    const a = await pripoj();
    const b = await pripoj();
    try {
      await a.query('begin');
      await a.query('set local role service_role');
      const prvni = (await a.query(`select * from public.due_group_batches(10)`)).rows;
      expect(prvni).toHaveLength(3);
      await b.query(`set statement_timeout = '3s'`);
      expect(await due(b)).toEqual([]);
      await a.query('commit');
      expect(await due(b)).toEqual([]);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it('čtyři spojení souběžně: každá dávka právě jednou', async () => {
    const spojeni = await Promise.all([pripoj(), pripoj(), pripoj(), pripoj()]);
    try {
      for (let kolo = 0; kolo < 3; kolo++) {
        await root.query(`delete from public.group_campaigns`);
        for (let i = 0; i < 12; i++) await kampan([await skupina()], { starts_at: iso(-HOD) });
        const vse = (await Promise.all(spojeni.map((c) => due(c, 5)))).flat().map((x) => x.batch_id);
        expect(new Set(vse).size).toBe(vse.length);
        const zbytek = await due(root, 50);
        expect(vse.length + zbytek.length).toBe(12);
      }
    } finally {
      await Promise.all(spojeni.map((c) => c.end()));
    }
  });
});

describe('release_group_batch', () => {
  const release = (id: string) =>
    sluzba(root, async () => (await root.query(`select public.release_group_batch($1) ok`, [id])).rows[0].ok as boolean);
  const davka = async (kampanId: string) => (await root.query(`select * from public.group_batches where campaign_id = $1`, [kampanId])).rows[0];

  it('nedoručená notifikace: dávka se uvolní a další běh ji vrátí znovu', async () => {
    const k = await kampan([await skupina(), await skupina()], { starts_at: iso(-HOD) });
    const [prvni] = await due();
    expect(prvni.campaign_id).toBe(k);
    expect(await release(prvni.batch_id)).toBe(true);
    expect((await davka(k)).notified_at).toBeNull();
    const znovu = await due();
    expect(znovu.map((x) => x.batch_id)).toEqual([prvni.batch_id]);
    expect(await due()).toEqual([]);
  });

  it('false: zrušená nebo hotová kampaň, dávka bez pending úkolů, neexistující dávka; nic se nezmění', async () => {
    const zrusena = await kampan([await skupina()], { starts_at: iso(-HOD) });
    const hotova = await kampan([await skupina()], { starts_at: iso(-HOD) });
    const prazdna = await kampan([await skupina(), await skupina()], { starts_at: iso(-HOD) });
    await due();
    await root.query(`update public.group_campaigns set status = 'cancelled' where id = $1`, [zrusena]);
    await jako(root, app(), () => root.query(`update public.group_tasks set status = 'sent' where campaign_id = $1`, [hotova]));
    await jako(root, app(), () => root.query(`update public.group_tasks set status = 'skipped' where campaign_id = $1`, [prazdna]));
    await root.query(`update public.group_campaigns set status = 'active' where id = $1`, [prazdna]);
    for (const k of [zrusena, hotova, prazdna]) {
      const d = await davka(k);
      expect(await release(d.id)).toBe(false);
      expect((await davka(k)).notified_at).not.toBeNull();
    }
    expect(await release('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('strop 12 h platí i po uvolnění: zmeškaná dávka se znovu jen označí', async () => {
    const k = await kampan([await skupina()], { starts_at: iso(-13 * HOD) });
    expect(await due()).toEqual([]);
    const d = await davka(k);
    expect(await release(d.id)).toBe(true);
    expect(await due()).toEqual([]);
    expect((await davka(k)).notified_at).not.toBeNull();
  });
});

describe('trigger úkolů', () => {
  const ukol = async (kampanId: string, groupId: string) =>
    (await root.query(`select * from public.group_tasks where campaign_id = $1 and group_id = $2`, [kampanId, groupId])).rows[0];
  const nastav = (kampanId: string, groupId: string, stav: string) => jako(root, app(), () =>
    root.query(`update public.group_tasks set status = $3 where campaign_id = $1 and group_id = $2`, [kampanId, groupId, stav]));
  const skupinaRadek = async (id: string) => (await root.query(`select * from public.fb_groups where id = $1`, [id])).rows[0];
  const stavKampane = async (id: string) => (await root.query(`select status from public.group_campaigns where id = $1`, [id])).rows[0].status;

  it('sent → done_at a last_sent_at; skipped → done_at bez last_sent_at; zpět → přepočet', async () => {
    const [g1, g2, g3] = [await skupina(), await skupina(), await skupina()];
    const k = await kampan([g1, g2, g3]);
    await nastav(k, g1, 'sent');
    const u1 = await ukol(k, g1);
    expect(u1.done_at).not.toBeNull();
    expect((await skupinaRadek(g1)).last_sent_at).toEqual(u1.done_at);
    await nastav(k, g2, 'skipped');
    expect((await ukol(k, g2)).done_at).not.toBeNull();
    expect((await skupinaRadek(g2)).last_sent_at).toBeNull();
    expect(await stavKampane(k)).toBe('active');

    await nastav(k, g1, 'pending');
    expect((await ukol(k, g1)).done_at).toBeNull();
    expect((await skupinaRadek(g1)).last_sent_at).toBeNull();
  });

  it('poslední odeslaná skupina z dřívější kampaně zůstane jako last_sent_at po vrácení', async () => {
    const g = await skupina();
    const k1 = await kampan([g]);
    await nastav(k1, g, 'sent');
    const prvni = (await skupinaRadek(g)).last_sent_at;
    const k2 = await kampan([g]);
    await nastav(k2, g, 'sent');
    await nastav(k2, g, 'pending');
    expect((await skupinaRadek(g)).last_sent_at).toEqual(prvni);
  });

  it('všechny úkoly hotové → kampaň done; zpět → active; zrušená zůstane zrušená', async () => {
    const [g1, g2] = [await skupina(), await skupina()];
    const k = await kampan([g1, g2]);
    await nastav(k, g1, 'sent');
    expect(await stavKampane(k)).toBe('active');
    await nastav(k, g2, 'skipped');
    expect(await stavKampane(k)).toBe('done');
    await nastav(k, g2, 'pending');
    expect(await stavKampane(k)).toBe('active');

    await root.query(`update public.group_campaigns set status = 'cancelled' where id = $1`, [k]);
    await nastav(k, g2, 'sent');
    expect(await stavKampane(k)).toBe('cancelled');
  });

  it('souběh: poslední dva úkoly odškrtnuté naráz ze dvou spojení → kampaň done', async () => {
    for (let kolo = 0; kolo < 3; kolo++) {
      const [g1, g2] = [await skupina(), await skupina()];
      const k = await kampan([g1, g2]);
      const a = await pripoj();
      const b = await pripoj();
      try {
        const prihlas = async (c: pg.Client) => {
          await c.query('begin');
          await c.query('set local role authenticated');
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: majitel, role: 'authenticated' })]);
        };
        await prihlas(a);
        await prihlas(b);
        await a.query(`update public.group_tasks set status = 'sent' where campaign_id = $1 and group_id = $2`, [k, g1]);
        const druhy = b.query(`update public.group_tasks set status = 'sent' where campaign_id = $1 and group_id = $2`, [k, g2])
          .then(() => b.query('commit'));
        await new Promise((r) => setTimeout(r, 200));
        await a.query('commit');
        await druhy;
      } finally {
        await a.end();
        await b.end();
      }
      expect(await stavKampane(k)).toBe('done');
    }
  });
});
