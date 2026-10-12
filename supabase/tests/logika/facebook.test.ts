// Facebook: všechny formáty, navázání po chybě bez zdvojení.
import { describe, expect, it } from 'vitest';
import { zpracujPost } from '../../functions/_shared/publikace';
import { chybaGraph, foto, hodiny, mockMeta, pametovaDb, post, prostredi, ucet, vezmi, video } from '../pomocnik/meta';

function priprav(media = [] as ReturnType<typeof foto>[], pole: Parameters<typeof post>[0] = {}) {
  const meta = mockMeta().na('GET', '/PAGE1', { telo: { access_token: 'PAGE_TOKEN', id: 'PAGE1' } });
  const { db, stav } = pametovaDb(ucet('facebook'), media);
  stav.post = post(pole);
  return { meta, db, stav, beh: () => zpracujPost(vezmi(stav), prostredi(meta, db)) };
}

describe('Facebook formáty', () => {
  it('text s odkazem → /feed message + link, page token z klíče', async () => {
    const { meta, stav, beh } = priprav([], { link_url: 'https://subbau.cz/nabor' });
    meta.na('POST', '/PAGE1/feed', { telo: { id: 'PAGE1_999' } });
    const r = await beh();
    expect(r).toMatchObject({ vysledek: 'published', externalId: 'PAGE1_999' });
    const tokenVolani = meta.volani.find((v) => v.cesta === '/PAGE1' && v.metoda === 'GET')!;
    expect(tokenVolani.params).toEqual({ fields: 'access_token' });
    expect(tokenVolani.token).toBe('SYSTEMOVY_KLIC');
    const feed = meta.volani.find((v) => v.cesta === '/PAGE1/feed')!;
    expect(feed.params).toEqual({ message: 'Dnes betonujeme strop.', link: 'https://subbau.cz/nabor' });
    expect(feed.token).toBe('PAGE_TOKEN');
    expect(meta.volani.every((v) => !v.url.includes('TOKEN') && !v.url.includes('KLIC'))).toBe(true);
    expect(meta.volani[0].url).toContain('/v26.0/');
    expect(stav.post).toMatchObject({ status: 'published', external_id: 'PAGE1_999', external_url: 'https://www.facebook.com/PAGE1_999' });
    expect(stav.pokusy).toHaveLength(1);
    expect(stav.pokusy[0]).toMatchObject({ outcome: 'success', error_code: null });
  });

  it('jedna fotka → /photos url, caption, published=true; id příspěvku z post_id', async () => {
    const { meta, stav, beh } = priprav([foto(0)], { link_url: 'https://subbau.cz' });
    meta.na('POST', '/PAGE1/photos', { telo: { id: 'FOTO1', post_id: 'PAGE1_777' } });
    await beh();
    const p = meta.volani.find((v) => v.cesta === '/PAGE1/photos')!.params;
    expect(p.published).toBe('true');
    expect(p.url).toMatch(/^https:\/\/ref\.supabase\.co\/storage\/v1\/object\/sign\/media\/m\/foto0\.jpg\?.*exp=3600/);
    expect(p.caption).toBe('Dnes betonujeme strop.\n\nhttps://subbau.cz');
    expect(stav.post).toMatchObject({ status: 'published', external_id: 'PAGE1_777', external_url: 'https://www.facebook.com/PAGE1_777' });
  });

  it('víc fotek → každá published=false, pak /feed s attached_media (JSON)', async () => {
    const { meta, stav, beh } = priprav([foto(2), foto(0), foto(1)]);
    meta.na('POST', '/PAGE1/photos', { telo: { id: 'F0' } }, { telo: { id: 'F1' } }, { telo: { id: 'F2' } });
    meta.na('POST', '/PAGE1/feed', { telo: { id: 'PAGE1_555' } });
    await beh();
    const nahrane = meta.volani.filter((v) => v.cesta === '/PAGE1/photos');
    expect(nahrane.map((v) => v.params.published)).toEqual(['false', 'false', 'false']);
    expect(nahrane.map((v) => v.params.url.match(/foto\d/)![0])).toEqual(['foto0', 'foto1', 'foto2']);
    const feed = meta.volani.find((v) => v.cesta === '/PAGE1/feed')!.params;
    expect(JSON.parse(feed.attached_media)).toEqual([{ media_fbid: 'F0' }, { media_fbid: 'F1' }, { media_fbid: 'F2' }]);
    expect(feed.message).toBe('Dnes betonujeme strop.');
    expect(stav.kroky.filter((k) => k.step === 'photos_uploading').map((k) => k.remote.photo_ids)).toEqual([['F0'], ['F0', 'F1'], ['F0', 'F1', 'F2']]);
    expect(stav.post!.external_id).toBe('PAGE1_555');
  });

  it('víc fotek: po výpadku u třetí fotky další běh nahraje jen ji', async () => {
    const { meta, stav, beh } = priprav([foto(0), foto(1), foto(2)]);
    meta.na('POST', '/PAGE1/photos', { telo: { id: 'F0' } }, { telo: { id: 'F1' } }, { status: 503, text: 'Service Unavailable' });
    const prvni = await beh();
    expect(prvni).toMatchObject({ vysledek: 'scheduled', kod: 'meta_unavailable' });
    expect(stav.post!.remote_state).toEqual({ photo_ids: ['F0', 'F1'] });

    meta.vymaz();
    meta.na('POST', '/PAGE1/photos', { telo: { id: 'F2' } });
    meta.na('POST', '/PAGE1/feed', { telo: { id: 'PAGE1_556' } });
    stav.post!.status = 'scheduled';
    await beh();
    expect(meta.kolik('POST', '/PAGE1/photos')).toBe(1);
    expect(JSON.parse(meta.volani.find((v) => v.cesta === '/PAGE1/feed')!.params.attached_media))
      .toEqual([{ media_fbid: 'F0' }, { media_fbid: 'F1' }, { media_fbid: 'F2' }]);
    expect(stav.post!.status).toBe('published');
  });

  it('video ve feedu → /videos file_url + description; odkaz na video', async () => {
    const { meta, stav, beh } = priprav([video(0)]);
    meta.na('POST', '/PAGE1/videos', { telo: { id: 'V1' } });
    await beh();
    const p = meta.volani.find((v) => v.cesta === '/PAGE1/videos')!.params;
    expect(p.file_url).toContain('video0.mp4');
    expect(p.description).toBe('Dnes betonujeme strop.');
    expect(stav.post).toMatchObject({ external_id: 'V1', external_url: 'https://www.facebook.com/PAGE1/videos/V1' });
  });

  it('reel → start, nahrání (OAuth + file_url), finish PUBLISHED; external_id = video_id', async () => {
    const { meta, stav, beh } = priprav([video(0)], { format: 'reel' });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start',
      { telo: { video_id: 'R1', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/R1' } });
    meta.na('POST', '/video-upload/v26.0/R1', { telo: { success: true } });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'finish', { telo: { success: true } });
    await beh();
    const upload = meta.volani.find((v) => v.cesta === '/video-upload/v26.0/R1')!;
    expect(upload.hlavicky.Authorization).toBe('OAuth PAGE_TOKEN');
    expect(upload.hlavicky.file_url).toContain('video0.mp4');
    const fin = meta.volani.find((v) => v.params.upload_phase === 'finish')!.params;
    expect(fin).toMatchObject({ video_id: 'R1', video_state: 'PUBLISHED', description: 'Dnes betonujeme strop.' });
    expect(stav.post).toMatchObject({ status: 'published', external_id: 'R1', external_url: 'https://www.facebook.com/reel/R1' });
  });

  it('reel: po výpadku nahrávání další běh nezačíná nový upload (start jen jednou)', async () => {
    const { meta, stav, beh } = priprav([video(0)], { format: 'reel' });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start',
      { telo: { video_id: 'R2', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/R2' } });
    meta.na('POST', '/video-upload/v26.0/R2', 'sit', { telo: { success: true } });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'finish', { telo: { success: true } });
    expect(await beh()).toMatchObject({ vysledek: 'scheduled', kod: 'network' });
    expect(stav.post!.remote_state).toMatchObject({ video_id: 'R2', uploaded: false });
    stav.post!.status = 'scheduled';
    await beh();
    expect(meta.kolik('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start')).toBe(1);
    expect(stav.post).toMatchObject({ status: 'published', external_id: 'R2' });
  });

  it('story na Facebook → fatal format_not_supported, nic se nevolá', async () => {
    const { meta, stav, beh } = priprav([foto(0)], { format: 'story' });
    const r = await beh();
    expect(r).toMatchObject({ vysledek: 'failed', kod: 'format_not_supported', druh: 'fatal' });
    expect(meta.volani).toHaveLength(0);
    expect(stav.post!.last_error_message).toMatch(/Příběhy/);
  });

  it('page token se v jednom běhu stahuje jen jednou', async () => {
    const { meta, db, stav } = priprav();
    meta.na('POST', '/PAGE1/feed', { telo: { id: 'PAGE1_1' } });
    const prost = prostredi(meta, db);
    await zpracujPost(vezmi(stav), prost);
    stav.post = post({ id: 'post-2' });
    await zpracujPost(vezmi(stav), prost);
    expect(meta.kolik('GET', '/PAGE1')).toBe(1);
    expect(meta.kolik('POST', '/PAGE1/feed')).toBe(2);
  });

  it('výpadek spojení u zveřejnění textu → failed unknown_outcome, žádné opakování', async () => {
    const { meta, stav, beh } = priprav();
    meta.na('POST', '/PAGE1/feed', 'sit');
    const r = await beh();
    expect(r).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome', druh: 'unknown' });
    expect(stav.post!.next_attempt_at).toBeNull();
    expect(stav.post!.last_error_message).toBe('Nevíme, jestli příspěvek vyšel — zkontrolujte stránku, než ho pustíte znovu.');
    expect(stav.pokusy[0].outcome).toBe('unknown');
  });

  it('chyba 190 → účet needs_reconnect, příspěvek failed, fbtrace_id v pokusu', async () => {
    const { meta, stav, beh } = priprav();
    meta.na('POST', '/PAGE1/feed', chybaGraph(190, 463, 400, 'Error validating access token'));
    const r = await beh();
    expect(r).toMatchObject({ vysledek: 'failed', kod: 'token_invalid', druh: 'token' });
    expect(stav.ucet.connection_status).toBe('needs_reconnect');
    expect(stav.pokusy[0]).toMatchObject({ outcome: 'fatal_error', http_status: 400, error_code: 'token_invalid', error_message: 'Error validating access token' });
    expect(stav.pokusy[0].remote_ids.fbtrace_id).toBe('TRACE123');
  });

  it('video s fotkou ve feedu → fatal media_combination', async () => {
    const { stav, beh } = priprav([foto(0), video(1)]);
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'media_combination' });
    expect(stav.post!.remote_state).toEqual({});
  });

  it.each([
    ['HTTP 503', { status: 503, text: 'Service Unavailable' }],
    ['kód 2', { status: 500, telo: { error: { message: 'Service temporarily unavailable', code: 2, fbtrace_id: 'T2' } } }],
    ['kód 1', { status: 400, telo: { error: { message: 'An unknown error occurred', code: 1 } } }],
    ['is_transient', { status: 400, telo: { error: { message: 'x', code: 999, is_transient: true } } }],
  ] as const)('zveřejnění: %s → failed / unknown_outcome, bez opakování', async (_n, odpoved) => {
    const { meta, stav, beh } = priprav();
    meta.na('POST', '/PAGE1/feed', odpoved as never);
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome', druh: 'unknown' });
    expect(stav.post).toMatchObject({ status: 'failed', next_attempt_at: null, last_error_code: 'unknown_outcome' });
    expect(stav.pokusy[0].outcome).toBe('unknown');
  });

  it('zveřejnění reelu (finish) s 503 → unknown; přípravné kroky (start) s 503 → retryable', async () => {
    const a = priprav([video(0)], { format: 'reel' });
    a.meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start', { status: 503, text: 'x' });
    expect(await a.beh()).toMatchObject({ vysledek: 'scheduled', druh: 'retryable' });

    const b = priprav([video(0)], { format: 'reel' });
    b.meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start',
      { telo: { video_id: 'R3', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/R3' } });
    b.meta.na('POST', '/video-upload/v26.0/R3', { telo: { success: true } });
    b.meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'finish', { status: 503, text: 'x' });
    expect(await b.beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome' });
  });

  it('zveřejnění s rate limitem (4) zůstává retryable — požadavek Meta odmítla', async () => {
    const { meta, beh } = priprav();
    meta.na('POST', '/PAGE1/feed', chybaGraph(4));
    expect(await beh()).toMatchObject({ vysledek: 'scheduled', kod: 'rate_limited' });
  });
});

describe('Facebook: termín běhu', () => {
  it('reel: na nahrání nezbývá 90 s → upload se nezačne, příspěvek zpět do fronty bez pokusu; další běh naváže', async () => {
    const { meta, db, stav } = priprav([video(0)], { format: 'reel' });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start',
      { telo: { video_id: 'R4', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/R4' } });
    meta.na('POST', '/video-upload/v26.0/R4', { telo: { success: true } });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'finish', { telo: { success: true } });
    const h = hodiny();
    expect(await zpracujPost(vezmi(stav), prostredi(meta, db, h, 60_000))).toMatchObject({ vysledek: 'deferred' });
    expect(meta.kolik('POST', '/video-upload/v26.0/R4')).toBe(0);
    expect(stav.post).toMatchObject({ status: 'scheduled', attempt_count: 0 });
    expect(stav.post!.remote_state).toMatchObject({ video_id: 'R4', uploaded: false });
    expect(await zpracujPost(vezmi(stav), prostredi(meta, db, h))).toMatchObject({ vysledek: 'published', externalId: 'R4' });
    expect(meta.kolik('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start')).toBe(1);
    expect(stav.post!.attempt_count).toBe(1);
  });

  it('video ve feedu: málo času → nezačne se, nic se nezveřejní', async () => {
    const { meta, db, stav } = priprav([video(0)]);
    meta.na('POST', '/PAGE1/videos', { telo: { id: 'V9' } });
    expect(await zpracujPost(vezmi(stav), prostredi(meta, db, hodiny(), 89_000))).toMatchObject({ vysledek: 'deferred' });
    expect(meta.kolik('POST', '/PAGE1/videos')).toBe(0);
  });

  it('MaloCasu: odklady se počítají, po 10 odkladech failed s českou zprávou', async () => {
    const { meta, db, stav } = priprav([video(0)], { format: 'reel' });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start',
      { telo: { video_id: 'R5', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/R5' } });
    const h = hodiny();
    const vysledky: string[] = [];
    for (let i = 0; i < 11; i++) {
      vysledky.push((await zpracujPost(vezmi(stav), prostredi(meta, db, h, 30_000))).vysledek);
    }
    expect(vysledky).toEqual([...Array(10).fill('deferred'), 'failed']);
    expect(stav.post).toMatchObject({ status: 'failed', last_error_code: 'no_time' });
    expect(stav.post!.last_error_message).toMatch(/Video se nepodařilo začít nahrávat/);
    expect(stav.kroky.filter((k) => k.remote.odklady_casu !== undefined).map((k) => k.remote.odklady_casu)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(meta.kolik('POST', '/video-upload/v26.0/R5')).toBe(0);
  });
});

describe('Facebook: nejasná odpověď 200', () => {
  it.each([
    ['bez id', { status: 200, telo: { success: true } }],
    ['prázdné tělo', { status: 200, text: '' }],
    ['ne-JSON', { status: 200, text: '<html>OK</html>' }],
  ] as const)('zveřejnění /feed: %s → failed / unknown_outcome', async (_n, odpoved) => {
    const { meta, stav, beh } = priprav();
    meta.na('POST', '/PAGE1/feed', odpoved as never);
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome', druh: 'unknown' });
    expect(stav.post!.next_attempt_at).toBeNull();
  });

  it('jedna fotka bez id i post_id → unknown', async () => {
    const { meta, beh } = priprav([foto(0)]);
    meta.na('POST', '/PAGE1/photos', { telo: {} });
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome' });
  });

  it('reel finish bez success → unknown; nepublikovaná fotka bez id → retryable', async () => {
    const a = priprav([video(0)], { format: 'reel' });
    a.meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start',
      { telo: { video_id: 'R6', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/R6' } });
    a.meta.na('POST', '/video-upload/v26.0/R6', { telo: { success: true } });
    a.meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'finish', { telo: { success: false } });
    expect(await a.beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome' });

    const b = priprav([foto(0), foto(1)]);
    b.meta.na('POST', '/PAGE1/photos', { telo: {} });
    expect(await b.beh()).toMatchObject({ vysledek: 'scheduled', druh: 'retryable' });
  });

  it.each([
    ['text /feed', [] as ReturnType<typeof foto>[], 'feed', 'POST', '/PAGE1/feed'],
    ['jedna fotka /photos', [foto(0)], 'feed', 'POST', '/PAGE1/photos'],
    ['video /videos', [video(0)], 'feed', 'POST', '/PAGE1/videos'],
  ] as const)('zveřejnění vrátí přesně {} (%s) → unknown, žádný odkaz …/undefined', async (_n, media, format, metoda, cesta) => {
    const { meta, stav, beh } = priprav([...media], { format });
    meta.na(metoda, cesta, { status: 200, telo: {} });
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome', druh: 'unknown' });
    expect(stav.post!.status).toBe('failed');
    expect(stav.post!.external_id ?? null).toBeNull();
    expect(stav.post!.external_url ?? null).toBeNull();
    expect(stav.zapisy.some((z) => z.status === 'published')).toBe(false);
  });

  it('víc fotek: /feed s attached_media vrátí {} → unknown', async () => {
    const { meta, stav, beh } = priprav([foto(0), foto(1)]);
    meta.na('POST', '/PAGE1/photos', { telo: { id: 'F0' } }, { telo: { id: 'F1' } });
    meta.na('POST', '/PAGE1/feed', { status: 200, telo: {} });
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome' });
    expect(stav.post!.status).toBe('failed');
  });

  it('reel finish vrátí {} → unknown', async () => {
    const { meta, stav, beh } = priprav([video(0)], { format: 'reel' });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'start',
      { telo: { video_id: 'R7', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/R7' } });
    meta.na('POST', '/video-upload/v26.0/R7', { telo: { success: true } });
    meta.naKdyz('POST', '/PAGE1/video_reels', (v) => v.params.upload_phase === 'finish', { status: 200, telo: {} });
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'unknown_outcome' });
    expect(stav.post!.status).toBe('failed');
  });
});
