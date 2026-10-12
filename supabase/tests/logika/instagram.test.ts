// Instagram: formáty, zpracování kontejneru napříč běhy, nejistý výsledek publikace.
import { describe, expect, it } from 'vitest';
import { zpracujPost } from '../../functions/_shared/publikace';
import { chybaGraph, foto, hodiny, mockMeta, pametovaDb, post, prostredi, ucet, vezmi, video } from '../pomocnik/meta';

function priprav(media = [] as ReturnType<typeof foto>[], pole: Parameters<typeof post>[0] = {}) {
  const meta = mockMeta();
  const { db, stav } = pametovaDb(ucet('instagram'), media);
  stav.post = post(pole);
  const h = hodiny();
  return { meta, db, stav, h, beh: () => zpracujPost(vezmi(stav), prostredi(meta, db, h)) };
}

/** Kontejner hotový, publikace projde, permalink se najde. */
function hladkyPrubeh(meta: ReturnType<typeof mockMeta>, kontejner = 'C1') {
  meta.na('GET', `/${kontejner}`, { telo: { status_code: 'FINISHED' } });
  meta.na('POST', '/IG1/media_publish', { telo: { id: 'M1' } });
  meta.na('GET', '/M1', { telo: { permalink: 'https://www.instagram.com/p/ABC/' } });
}

describe('Instagram formáty', () => {
  it('foto → /media image_url + caption, čekání na FINISHED, media_publish, permalink', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    hladkyPrubeh(meta);
    expect(await beh()).toMatchObject({ vysledek: 'published', externalId: 'M1' });
    const c = meta.volani.find((v) => v.cesta === '/IG1/media')!.params;
    expect(c).toEqual({ image_url: expect.stringContaining('foto0.jpg'), caption: 'Dnes betonujeme strop.' });
    expect(meta.volani.every((v) => v.token === 'SYSTEMOVY_KLIC' && !v.url.includes('SYSTEMOVY_KLIC'))).toBe(true);
    expect(meta.volani.find((v) => v.cesta === '/IG1/media_publish')!.params.creation_id).toBe('C1');
    expect(stav.post).toMatchObject({ status: 'published', external_id: 'M1', external_url: 'https://www.instagram.com/p/ABC/' });
    expect(stav.kroky.map((k) => k.step)).toEqual(['container_created', 'publishing', 'published_remote', 'published_remote']);
  });

  it('karusel → děti s is_carousel_item (foto i video), počká na video, pak CAROUSEL s children', async () => {
    const { meta, stav, beh } = priprav([foto(0), video(1), foto(2)], { format: 'carousel' });
    meta.na('POST', '/IG1/media', { telo: { id: 'D0' } }, { telo: { id: 'D1' } }, { telo: { id: 'D2' } }, { telo: { id: 'C1' } });
    meta.na('GET', '/D1', { telo: { status_code: 'IN_PROGRESS' } }, { telo: { status_code: 'FINISHED' } });
    hladkyPrubeh(meta);
    await beh();
    const vytvoreni = meta.volani.filter((v) => v.cesta === '/IG1/media').map((v) => v.params);
    expect(vytvoreni[0]).toMatchObject({ image_url: expect.stringContaining('foto0'), is_carousel_item: 'true' });
    expect(vytvoreni[1]).toMatchObject({ media_type: 'VIDEO', video_url: expect.stringContaining('video1'), is_carousel_item: 'true' });
    expect(vytvoreni[2]).toMatchObject({ image_url: expect.stringContaining('foto2'), is_carousel_item: 'true' });
    expect(vytvoreni[3]).toMatchObject({ media_type: 'CAROUSEL', children: 'D0,D1,D2', caption: 'Dnes betonujeme strop.' });
    expect(vytvoreni[3].is_carousel_item).toBeUndefined();
    expect(meta.kolik('GET', '/D1')).toBe(2);
    expect(stav.post!.status).toBe('published');
  });

  it('karusel mimo 2–10 položek → fatal carousel_count', async () => {
    const jedna = priprav([foto(0)], { format: 'carousel' });
    expect(await jedna.beh()).toMatchObject({ vysledek: 'failed', kod: 'carousel_count' });
    const jedenact = priprav(Array.from({ length: 11 }, (_, i) => foto(i)));
    expect(await jedenact.beh()).toMatchObject({ vysledek: 'failed', kod: 'carousel_count' });
    expect(jedna.meta.volani.length + jedenact.meta.volani.length).toBe(0);
  });

  it('reel → REELS, video_url, caption, share_to_feed=true', async () => {
    const { meta, stav, beh } = priprav([video(0)], { format: 'reel' });
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    hladkyPrubeh(meta);
    await beh();
    expect(meta.volani.find((v) => v.cesta === '/IG1/media')!.params).toMatchObject({
      media_type: 'REELS', video_url: expect.stringContaining('video0.mp4'), caption: 'Dnes betonujeme strop.', share_to_feed: 'true',
    });
    expect(stav.post!.status).toBe('published');
  });

  it('story → STORIES s image_url (bez popisku) i s video_url', async () => {
    const a = priprav([foto(0)], { format: 'story' });
    a.meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    hladkyPrubeh(a.meta);
    await a.beh();
    const pa = a.meta.volani.find((v) => v.cesta === '/IG1/media')!.params;
    expect(pa).toMatchObject({ media_type: 'STORIES', image_url: expect.stringContaining('foto0') });
    expect(pa.caption).toBeUndefined();

    const b = priprav([video(0)], { format: 'story' });
    b.meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    hladkyPrubeh(b.meta);
    await b.beh();
    expect(b.meta.volani.find((v) => v.cesta === '/IG1/media')!.params).toMatchObject({ media_type: 'STORIES', video_url: expect.stringContaining('video0') });
  });

  it('obrázek, který není JPEG → fatal image_not_jpeg, nic se nevolá', async () => {
    const { meta, beh, stav } = priprav([foto(0, 'image/png')]);
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'image_not_jpeg' });
    expect(meta.volani).toHaveLength(0);
    expect(stav.post!.last_error_message).toMatch(/JPEG/);
  });
});

describe('Instagram: kontejner se zpracovává napříč běhy', () => {
  it('IN_PROGRESS po ~20 s → uloží container_id + container_processing; další běh naváže bez nového kontejneru', async () => {
    const { meta, stav, h, db } = priprav([video(0)], { format: 'reel' });
    meta.na('POST', '/IG1/media', { telo: { id: 'C7' } }, { telo: { id: 'C_NOVY_SPATNE' } });
    meta.na('GET', '/C7', { telo: { status_code: 'IN_PROGRESS' } });

    const prvni = await zpracujPost(vezmi(stav), prostredi(meta, db, h));
    expect(prvni).toEqual({ postId: 'post-1', vysledek: 'processing' });
    expect(stav.post).toMatchObject({ status: 'publishing', step: 'container_processing' });
    expect(stav.post!.remote_state).toMatchObject({ container_id: 'C7' });
    expect(stav.kroky.at(-1)).toMatchObject({ step: 'container_processing', remote: { container_id: 'C7' } });
    expect(meta.kolik('GET', '/C7')).toBeGreaterThanOrEqual(6); // dotazy po 3 s v rámci 20 s
    expect(stav.pokusy).toHaveLength(0);
    expect(stav.post!.attempt_count).toBe(1);

    // claim (b) po 45 s: stejný příspěvek, attempt_count se nezvyšuje
    h.posun(60_000);
    meta.vymaz();
    meta.na('GET', '/C7', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', { telo: { id: 'M7' } });
    meta.na('GET', '/M7', { telo: { permalink: 'https://www.instagram.com/reel/X/' } });
    const druhy = await zpracujPost(vezmi(stav), prostredi(meta, db, h));
    expect(druhy).toMatchObject({ vysledek: 'published', externalId: 'M7' });
    expect(meta.kolik('POST', '/IG1/media')).toBe(0);
    expect(meta.volani.find((v) => v.cesta === '/IG1/media_publish')!.params.creation_id).toBe('C7');
    expect(stav.post!.attempt_count).toBe(1);
  });

  it('po hodině pořád IN_PROGRESS → fatal container_timeout', async () => {
    const { meta, stav, h, beh } = priprav([video(0)], { format: 'reel' });
    meta.na('POST', '/IG1/media', { telo: { id: 'C8' } });
    meta.na('GET', '/C8', { telo: { status_code: 'IN_PROGRESS' } });
    expect(await beh()).toMatchObject({ vysledek: 'processing' });
    h.posun(30 * 60_000);
    expect(await beh()).toMatchObject({ vysledek: 'processing' });
    h.posun(31 * 60_000);
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'container_timeout', druh: 'fatal' });
    expect(meta.kolik('POST', '/IG1/media')).toBe(1);
  });

  it('ERROR → fatal container_error, EXPIRED → fatal container_expired', async () => {
    const a = priprav([foto(0)]);
    a.meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    a.meta.na('GET', '/C1', { telo: { status_code: 'ERROR' } });
    expect(await a.beh()).toMatchObject({ vysledek: 'failed', kod: 'container_error', druh: 'fatal' });
    expect(a.stav.post!.remote_state).toEqual({});
    expect(a.stav.pokusy[0].remote_ids).toMatchObject({ container_id: 'C1' });

    const b = priprav([foto(0)]);
    b.meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    b.meta.na('GET', '/C1', { telo: { status_code: 'EXPIRED' } });
    expect(await b.beh()).toMatchObject({ vysledek: 'failed', kod: 'container_expired' });
    expect(b.stav.post!.last_error_message).toMatch(/24 hodin/);
  });
});

describe('Instagram: nejistý výsledek media_publish', () => {
  it('výpadek po odeslání → unknown, zpět do fronty; další běh najde PUBLISHED a dohledá podle popisku', async () => {
    const { meta, stav, h, db } = priprav([foto(0)], { caption: '  Dnes   betonujeme strop. ' });
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', 'sit');
    const prvni = await zpracujPost(vezmi(stav), prostredi(meta, db, h));
    expect(prvni).toMatchObject({ vysledek: 'scheduled', kod: 'unknown_outcome', druh: 'unknown' });
    expect(stav.post!.remote_state).toMatchObject({ container_id: 'C1', publish_sent_at: expect.any(String) });
    expect(stav.pokusy[0].outcome).toBe('unknown');
    expect(new Date(stav.post!.next_attempt_at as string).getTime() - h.ted().getTime()).toBe(2 * 60_000);

    h.posun(3 * 60_000);
    meta.vymaz();
    meta.na('GET', '/C1', { telo: { status_code: 'PUBLISHED' } });
    meta.na('GET', '/IG1/media', { telo: { data: [
      { id: 'JINY', caption: 'Něco jiného', permalink: 'https://www.instagram.com/p/J/', timestamp: '2026-10-12T10:00:30+0000' },
      { id: 'MINULY', caption: 'Dnes betonujeme strop.', permalink: 'https://www.instagram.com/p/OLD/', timestamp: '2026-10-05T10:00:00+0000' },
      { id: 'M9', caption: 'Dnes betonujeme strop.', permalink: 'https://www.instagram.com/p/M9/', timestamp: '2026-10-12T10:00:05+0000' },
    ] } });
    const druhy = await zpracujPost(vezmi(stav), prostredi(meta, db, h));
    expect(druhy).toMatchObject({ vysledek: 'published', externalId: 'M9' });
    expect(meta.kolik('POST', /.*/)).toBe(0);
    expect(meta.volani.find((v) => v.cesta === '/IG1/media')!.params).toMatchObject({ fields: 'id,caption,permalink,timestamp', limit: '10' });
    expect(stav.post).toMatchObject({ status: 'published', external_url: 'https://www.instagram.com/p/M9/' });
  });

  it('další běh najde kontejner FINISHED (nevyšel) → publikuje jednou, bez nového kontejneru', async () => {
    const { meta, stav, h, db } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', 'sit', { telo: { id: 'M2' } });
    meta.na('GET', '/M2', { telo: { permalink: 'https://www.instagram.com/p/M2/' } });
    await zpracujPost(vezmi(stav), prostredi(meta, db, h));
    h.posun(3 * 60_000);
    await zpracujPost(vezmi(stav), prostredi(meta, db, h));
    expect(meta.kolik('POST', '/IG1/media')).toBe(1);
    expect(meta.kolik('POST', '/IG1/media_publish')).toBe(2);
    expect(stav.post).toMatchObject({ status: 'published', external_id: 'M2' });
  });

  it('limit 100 za 24 h (9 / 2207042) → fatal s českým vysvětlením', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', chybaGraph(9, 2207042, 400, 'Application request limit reached'));
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'ig_daily_limit', druh: 'fatal' });
    expect(stav.post!.last_error_message).toMatch(/limit 100 příspěvků za 24 hodin/);
  });

  it('nepodařený permalink není chyba — příspěvek je zveřejněný bez odkazu', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', { telo: { id: 'M3' } });
    meta.na('GET', '/M3', 'sit');
    expect(await beh()).toMatchObject({ vysledek: 'published', externalId: 'M3' });
    expect(stav.post).toMatchObject({ status: 'published', external_url: null });
  });

  it('dohledání nevezme minulý výskyt série se stejným textem (starší než minuta před odesláním)', async () => {
    const { meta, stav, h, db } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', 'sit');
    await zpracujPost(vezmi(stav), prostredi(meta, db, h)); // publish_sent_at = 10:00:00
    h.posun(3 * 60_000);
    meta.vymaz();
    meta.na('GET', '/C1', { telo: { status_code: 'PUBLISHED' } });
    meta.na('GET', '/IG1/media', { telo: { data: [
      { id: 'MINULY', caption: 'Dnes betonujeme strop.', permalink: 'https://www.instagram.com/p/OLD/', timestamp: '2026-10-12T09:58:59+0000' },
    ] } });
    expect(await zpracujPost(vezmi(stav), prostredi(meta, db, h))).toMatchObject({ vysledek: 'published', externalId: null });
    expect(stav.post).toMatchObject({ status: 'published', external_id: null, external_url: null });
  });

  it('media_publish s HTTP 503 → retryable (stav kontejneru se před opakováním ověří)', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', { status: 503, text: 'x' });
    expect(await beh()).toMatchObject({ vysledek: 'scheduled', kod: 'meta_unavailable', druh: 'retryable' });
    expect(stav.post!.remote_state).toMatchObject({ container_id: 'C1' });
  });

  it('čekání na kontejner skončí v termínu běhu (ne až po 20 s)', async () => {
    const { meta, stav, db } = priprav([video(0)], { format: 'reel' });
    meta.na('POST', '/IG1/media', { telo: { id: 'C5' } });
    meta.na('GET', '/C5', { telo: { status_code: 'IN_PROGRESS' } });
    const h = hodiny();
    const start = h.ted().getTime();
    expect(await zpracujPost(vezmi(stav), prostredi(meta, db, h, 7_000))).toMatchObject({ vysledek: 'processing' });
    expect(h.ted().getTime() - start).toBeLessThanOrEqual(7_000);
    expect(meta.kolik('GET', '/C5')).toBeLessThanOrEqual(3);
  });

  it('media_publish vrátí 200 s prázdným tělem → unknown, zpět do fronty s kontejnerem', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', { status: 200, text: '' });
    expect(await beh()).toMatchObject({ vysledek: 'scheduled', kod: 'unknown_outcome', druh: 'unknown' });
    expect(stav.post!.remote_state).toMatchObject({ container_id: 'C1', publish_sent_at: expect.any(String) });
  });

  it('trvalá chyba po odeslání media_publish nesmaže remote_state (kontejner je důkaz)', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', chybaGraph(100, undefined, 400, 'Invalid parameter'));
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'invalid_parameter', druh: 'fatal' });
    expect(stav.post!.remote_state).toMatchObject({ container_id: 'C1', publish_sent_at: expect.any(String) });
  });

  it('trvalá chyba před zveřejněním remote_state smaže', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'ERROR' } });
    expect(await beh()).toMatchObject({ vysledek: 'failed', kod: 'container_error' });
    expect(stav.post!.remote_state).toEqual({});
  });

  it('media_publish vrátí přesně {} → unknown (zpět do fronty), ne published bez id', async () => {
    const { meta, stav, beh } = priprav([foto(0)]);
    meta.na('POST', '/IG1/media', { telo: { id: 'C1' } });
    meta.na('GET', '/C1', { telo: { status_code: 'FINISHED' } });
    meta.na('POST', '/IG1/media_publish', { status: 200, telo: {} });
    expect(await beh()).toMatchObject({ vysledek: 'scheduled', kod: 'unknown_outcome', druh: 'unknown' });
    expect(stav.post!.status).toBe('scheduled');
    expect(stav.post!.remote_state).toMatchObject({ container_id: 'C1', publish_sent_at: expect.any(String) });
    expect(stav.post!.remote_state.media_id).toBeUndefined();
  });
});
