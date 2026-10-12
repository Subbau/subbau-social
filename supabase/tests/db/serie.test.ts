// Opakování: výpočet výskytů (letní/zimní čas, měsíce bez 31.) a generování z šablony.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chyba, jako, novaDatabaze, zalozMedium, zalozPost, zalozUcet, zalozUzivatele } from '../pomocnik/db';

let root: pg.Client;
let uzivatel: string;
let cizi: string;
let ucet: string;

type Rozvrh = { freq: string; interval?: number; weekdays?: number[] | null; monthDay?: number | null; cas?: string; od: string; do: string; start?: string };
async function vyskyty(r: Rozvrh): Promise<string[]> {
  const v = await root.query(
    `select o from public.series_occurrences($1, $2, $3::smallint[], $4::smallint, $5::time, 'Europe/Prague', $6::date, $7::date, $8::date) o`,
    [r.freq, r.interval ?? 1, r.weekdays ?? null, r.monthDay ?? null, r.cas ?? '18:00', r.start ?? r.od, r.od, r.do]);
  return v.rows.map((x) => (x.o as Date).toISOString());
}
const praha = (iso: string) =>
  new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const KAZDY_DEN = [1, 2, 3, 4, 5, 6, 7];

beforeAll(async () => {
  ({ root } = await novaDatabaze('serie'));
  uzivatel = await zalozUzivatele(root, true);
  cizi = await zalozUzivatele(root, false);
  ucet = await zalozUcet(root);
});
afterAll(() => root.end());

describe('series_occurrences — místní čas', () => {
  it('jarní přechod 29. 3. 2026: 18:00 místního zůstane 18:00', async () => {
    const v = await vyskyty({ freq: 'weekly', weekdays: KAZDY_DEN, od: '2026-03-27', do: '2026-03-31' });
    expect(v).toEqual([
      '2026-03-27T17:00:00.000Z',
      '2026-03-28T17:00:00.000Z',
      '2026-03-29T16:00:00.000Z',
      '2026-03-30T16:00:00.000Z',
      '2026-03-31T16:00:00.000Z',
    ]);
    expect(v.map(praha)).toEqual(Array(5).fill('18:00'));
  });

  it('podzimní přechod 25. 10. 2026: 18:00 místního zůstane 18:00', async () => {
    const v = await vyskyty({ freq: 'weekly', weekdays: KAZDY_DEN, od: '2026-10-23', do: '2026-10-27' });
    expect(v).toEqual([
      '2026-10-23T16:00:00.000Z',
      '2026-10-24T16:00:00.000Z',
      '2026-10-25T17:00:00.000Z',
      '2026-10-26T17:00:00.000Z',
      '2026-10-27T17:00:00.000Z',
    ]);
    expect(v.map(praha)).toEqual(Array(5).fill('18:00'));
  });

  it('týdenní série přes přechod (každou neděli) drží čas', async () => {
    const v = await vyskyty({ freq: 'weekly', weekdays: [7], cas: '09:30', od: '2026-03-01', do: '2026-04-30' });
    expect(v.length).toBe(9);
    expect(new Set(v.map(praha))).toEqual(new Set(['09:30']));
  });
});

describe('series_occurrences — pravidla', () => {
  it('měsíční 31.: měsíc bez 31. → poslední den', async () => {
    const v = await vyskyty({ freq: 'monthly', monthDay: 31, cas: '12:00', od: '2026-01-01', do: '2026-12-31' });
    const dny = v.map((iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date(iso)));
    expect(dny).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
    ]);
    expect(new Set(v.map(praha))).toEqual(new Set(['12:00']));
  });

  it('měsíční 30. v přestupném únoru → 29.; 15. zůstane 15.', async () => {
    const unor = await vyskyty({ freq: 'monthly', monthDay: 30, od: '2028-02-01', do: '2028-03-31' });
    const den = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date(iso));
    expect(unor.map(den)).toEqual(['2028-02-29', '2028-03-30']);
    const patnact = await vyskyty({ freq: 'monthly', monthDay: 15, od: '2026-01-01', do: '2026-03-31' });
    expect(patnact.map(den)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('interval: každý druhý týden, každý třetí měsíc', async () => {
    const den = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date(iso));
    // 2026-10-12 je pondělí
    const tydny = await vyskyty({ freq: 'weekly', interval: 2, weekdays: [1, 3], start: '2026-10-14', od: '2026-10-12', do: '2026-11-15' });
    expect(tydny.map(den)).toEqual(['2026-10-14', '2026-10-26', '2026-10-28', '2026-11-09', '2026-11-11']);
    const mesice = await vyskyty({ freq: 'monthly', interval: 3, monthDay: 1, start: '2026-01-01', od: '2026-01-01', do: '2026-12-31' });
    expect(mesice.map(den)).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
  });

  it('nezačne před starts_on', async () => {
    const v = await vyskyty({ freq: 'weekly', weekdays: KAZDY_DEN, start: '2026-05-10', od: '2026-05-01', do: '2026-05-12' });
    expect(v.length).toBe(3);
  });
});

describe('generate_series_occurrences', () => {
  async function serie(pole: Record<string, unknown> = {}) {
    const sablona = await zalozPost(root, ucet, { caption: 'Týdenní tip', format: 'feed', link_url: 'https://subbau.cz', platform_options: '{"allow_duplicate":false}', content_hash: 'h1' });
    const m1 = await zalozMedium(root);
    const m2 = await zalozMedium(root);
    await root.query(`insert into public.post_media (post_id, asset_id, position) values ($1, $2, 0), ($1, $3, 1)`, [sablona, m1, m2]);
    const r = await root.query(
      `insert into public.post_series (account_id, template_post_id, freq, weekdays, time_of_day, starts_on, horizon_weeks, until_on, is_active)
       values ($1, $2, 'weekly', $3, $4, $5, $6, $7, $8) returning id`,
      [ucet, sablona, pole.weekdays ?? KAZDY_DEN, pole.cas ?? '18:00', pole.starts_on ?? new Date().toISOString().slice(0, 10),
       pole.horizon ?? 2, pole.until_on ?? null, pole.is_active ?? true]);
    return { id: r.rows[0].id as string, sablona };
  }
  const generuj = (id: string, uid = uzivatel) =>
    jako(root, { role: 'authenticated', uid }, async () => (await root.query(`select public.generate_series_occurrences($1) n`, [id])).rows[0].n as number);

  it('app_user vytvoří kopie šablony v 18:00 místního, i s médii; podruhé nic', async () => {
    const { id, sablona } = await serie();
    const n = await generuj(id);
    expect(n).toBeGreaterThanOrEqual(14);
    expect(n).toBeLessThanOrEqual(15);
    const posty = (await root.query(`select * from public.posts where series_id = $1 order by scheduled_at`, [id])).rows;
    expect(posty.length).toBe(n);
    for (const p of posty) {
      expect(p.status).toBe('scheduled');
      expect(p.caption).toBe('Týdenní tip');
      expect(p.link_url).toBe('https://subbau.cz');
      expect(p.platform_options).toEqual({ allow_duplicate: false });
      expect(p.copied_from_id).toBe(sablona);
      expect(p.content_hash).toBe('h1');
      expect(p.created_by).toBe(uzivatel);
      expect(praha(p.scheduled_at.toISOString())).toBe('18:00');
      expect(p.scheduled_at.getTime()).toBeGreaterThan(Date.now());
    }
    const media = await root.query(
      `select count(*)::int n from public.post_media pm join public.posts p on p.id = pm.post_id where p.series_id = $1`, [id]);
    expect(media.rows[0].n).toBe(2 * n);
    expect(await generuj(id)).toBe(0);
  });

  it('idempotence i bez generated_until: unique(series_id, scheduled_at) nedovolí zdvojení', async () => {
    const { id } = await serie({ horizon: 1 });
    const n = await generuj(id);
    expect(n).toBeGreaterThan(0);
    await root.query(`update public.post_series set generated_until = null where id = $1`, [id]);
    expect(await generuj(id)).toBe(0);
    const r = await root.query(`select count(*)::int n from public.posts where series_id = $1`, [id]);
    expect(r.rows[0].n).toBe(n);
  });

  it('smazaný výskyt se znovu nevytvoří; změna času vygeneruje nové', async () => {
    const { id } = await serie({ horizon: 1 });
    const n = await generuj(id);
    await root.query(`delete from public.posts where id = (select id from public.posts where series_id = $1 order by scheduled_at desc limit 1)`, [id]);
    expect(await generuj(id)).toBe(0);
    await jako(root, { role: 'authenticated', uid: uzivatel }, () =>
      root.query(`update public.post_series set time_of_day = '07:15' where id = $1`, [id]));
    const novych = await generuj(id);
    expect(novych).toBeGreaterThanOrEqual(n - 1);
    const casy = await root.query(
      `select distinct to_char(scheduled_at at time zone 'Europe/Prague', 'HH24:MI') t from public.posts where series_id = $1 order by 1`, [id]);
    expect(casy.rows.map((r) => r.t)).toEqual(['07:15', '18:00']);
  });

  it('until_on omezí rozsah, neaktivní nic', async () => {
    const zitra = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { id } = await serie({ until_on: zitra, horizon: 8 });
    expect(await generuj(id)).toBeLessThanOrEqual(2);
    const vypnuta = await serie({ is_active: false });
    expect(await generuj(vypnuta.id)).toBe(0);
  });

  it('nezapsaný přihlášený sérii nevidí', async () => {
    const { id } = await serie();
    expect(await chyba(generuj(id, cizi))).toMatch(/neexistuje/);
  });

  it('extend_all_series (service_role) prodlouží všechny aktivní a nespadne na série bez šablony', async () => {
    await root.query(`delete from public.posts where series_id is not null`);
    await root.query(`update public.post_series set generated_until = null`);
    await root.query(`insert into public.post_series (account_id, freq, weekdays, time_of_day, starts_on) values ($1, 'weekly', '{1}', '10:00', current_date)`, [ucet]);
    const n = await jako(root, { role: 'service_role' }, async () => (await root.query(`select public.extend_all_series() n`)).rows[0].n);
    expect(n).toBeGreaterThan(0);
    const znovu = await jako(root, { role: 'service_role' }, async () => (await root.query(`select public.extend_all_series() n`)).rows[0].n);
    expect(znovu).toBe(0);
  });
});

describe('šablona série není naplánovaná', () => {
  const klient = () => ({ role: 'authenticated' as const, uid: uzivatel });
  const zitra = () => new Date(Date.now() + 86_400_000).toISOString();

  it('sérii nad naplánovaným příspěvkem nejde založit ani na něj přepnout', async () => {
    const naplanovany = await zalozPost(root, ucet, { status: 'scheduled', scheduled_at: zitra() });
    expect(await chyba(jako(root, klient(), () => root.query(
      `insert into public.post_series (account_id, template_post_id, freq, weekdays, time_of_day, starts_on)
       values ($1, $2, 'weekly', '{1}', '18:00', current_date)`, [ucet, naplanovany])))).toMatch(/Šablona opakování/);
    const koncept = await zalozPost(root, ucet);
    const s = await jako(root, klient(), () => root.query(
      `insert into public.post_series (account_id, template_post_id, freq, weekdays, time_of_day, starts_on)
       values ($1, $2, 'weekly', '{1}', '18:00', current_date) returning id`, [ucet, koncept]));
    expect(await chyba(jako(root, klient(), () => root.query(
      `update public.post_series set template_post_id = $2 where id = $1`, [s.rows[0].id, naplanovany])))).toMatch(/Šablona opakování/);
  });

  it('šablonu nejde naplánovat (klient ani service_role); ostatní příspěvky ano', async () => {
    const sablona = await zalozPost(root, ucet);
    await root.query(`insert into public.post_series (account_id, template_post_id, freq, weekdays, time_of_day, starts_on)
                      values ($1, $2, 'weekly', '{1}', '18:00', current_date)`, [ucet, sablona]);
    expect(await chyba(jako(root, klient(), () => root.query(
      `update public.posts set status = 'scheduled', scheduled_at = $2 where id = $1`, [sablona, zitra()])))).toMatch(/šablona opakování/);
    expect(await chyba(jako(root, { role: 'service_role' }, () => root.query(
      `update public.posts set status = 'scheduled', scheduled_at = $2 where id = $1`, [sablona, zitra()])))).toMatch(/šablona opakování/);
    // jiné úpravy šablony jdou
    await jako(root, klient(), () => root.query(`update public.posts set caption = 'nový text' where id = $1`, [sablona]));
    const jiny = await zalozPost(root, ucet);
    await jako(root, klient(), () => root.query(`update public.posts set status = 'scheduled', scheduled_at = $2 where id = $1`, [jiny, zitra()]));
  });
});
