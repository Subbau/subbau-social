// Zmeškané příspěvky (uspaný projekt, výpadek cronu) se samy pozdě nezveřejní.
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jako, novaDatabaze, zalozPost, zalozUcet, zalozUzivatele } from '../pomocnik/db';

let root: pg.Client;
let ucet: string;
let uzivatel: string;
const pred = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const claim = async () =>
  jako(root, { role: 'service_role' }, async () => (await root.query(`select * from public.claim_due_posts(10)`)).rows.map((p) => p.id));
const radek = async (id: string) => (await root.query(`select * from public.posts where id = $1`, [id])).rows[0];
/** Naplánovaný příspěvek, naposledy upravený dávno (jako by ho uživatel naplánoval předem). */
const naplanovany = (minutPozde: number, pole: Record<string, unknown> = {}, u = ucet) =>
  zalozPost(root, u, { status: 'scheduled', scheduled_at: pred(minutPozde), updated_at: pred(3 * 24 * 60), ...pole });

function mistni(iso: string, timeZone: string): string {
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${d.day}. ${d.month}. ${d.hour}:${d.minute}`;
}

beforeAll(async () => {
  ({ root } = await novaDatabaze('zmeskane'));
  ucet = await zalozUcet(root);
  uzivatel = await zalozUzivatele(root, true);
});
afterAll(() => root.end());
beforeEach(async () => {
  await root.query(`delete from public.publish_attempts`);
  await root.query(`update public.post_series set template_post_id = null`);
  await root.query(`delete from public.posts`);
});

describe('claim_due_posts — zmeškané příspěvky', () => {
  it('2 h 1 min pozdě → failed / missed s českou zprávou a časem v pásmu účtu; pokus zapsaný', async () => {
    const id = await naplanovany(121);
    expect(await claim()).toEqual([]);
    const r = await radek(id);
    expect(r).toMatchObject({ status: 'failed', last_error_code: 'missed', attempt_count: 0, error_resolved_at: null });
    expect(r.last_error_message).toBe(
      `Příspěvek nevyšel včas (plánovaný čas ${mistni(r.scheduled_at.toISOString(), 'Europe/Prague')}) — server v tu dobu neběžel. Pokud ho chcete zveřejnit, naplánujte ho znovu.`);
    const pokus = (await root.query(`select outcome, error_code, error_message_cs from public.publish_attempts where post_id = $1`, [id])).rows;
    expect(pokus).toEqual([{ outcome: 'fatal_error', error_code: 'missed', error_message_cs: r.last_error_message }]);
  });

  it('čas ve zprávě je v časovém pásmu účtu', async () => {
    const newYork = await zalozUcet(root);
    await root.query(`update public.social_accounts set timezone = 'America/New_York' where id = $1`, [newYork]);
    const id = await naplanovany(180, {}, newYork);
    await claim();
    const r = await radek(id);
    expect(r.last_error_message).toContain(`(plánovaný čas ${mistni(r.scheduled_at.toISOString(), 'America/New_York')})`);
  });

  it('1 h 59 min pozdě → normálně se vezme', async () => {
    const id = await naplanovany(119);
    expect(await claim()).toEqual([id]);
  });

  it('v backoffu 5 h pozdě → normálně se vezme', async () => {
    const id = await naplanovany(300, { attempt_count: 1, next_attempt_at: pred(1) });
    expect(await claim()).toEqual([id]);
  });

  it('rozpracovaný (remote_state) i pokračování kontejneru 5 h pozdě → normálně', async () => {
    const a = await naplanovany(300, { remote_state: '{"container_id":"C1"}' });
    const b = await naplanovany(300, { status: 'publishing', step: 'container_processing', locked_at: pred(1), attempt_count: 1 });
    expect((await claim()).sort()).toEqual([a, b].sort());
  });

  it('zmeškaný výskyt série → missed', async () => {
    const serie = (await root.query(`insert into public.post_series (account_id, freq, weekdays, time_of_day, starts_on)
                                     values ($1, 'weekly', '{1}', '18:00', current_date - 7) returning id`, [ucet])).rows[0].id;
    const id = await naplanovany(24 * 60, { series_id: serie });
    expect(await claim()).toEqual([]);
    expect((await radek(id)).last_error_code).toBe('missed');
  });

  it('ruční „zkusit znovu“ starého příspěvku (čas v minulosti) se vezme hned, ne missed', async () => {
    const id = await zalozPost(root, ucet, {
      status: 'failed', scheduled_at: pred(5 * 60), updated_at: pred(3 * 24 * 60), last_error_code: 'missed', attempt_count: 0,
    });
    await jako(root, { role: 'authenticated', uid: uzivatel }, () =>
      root.query(`update public.posts set status = 'scheduled' where id = $1`, [id]));
    expect(await claim()).toEqual([id]);
  });
});
