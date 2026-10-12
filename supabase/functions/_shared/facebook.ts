// Adaptér Facebook stránky. Každý krok na platformě se hned uloží (remote_state),
// aby opakování navázalo a nevytvořilo druhý příspěvek / znovu nenahrávalo fotky.
import { ChybaPublikace, fatal } from './chyby.ts';
import { potvrzeneId } from './graph.ts';
import { DLOUHY_KROK_MS, type KontextAdapteru, MaloCasu, type VysledekAdapteru } from './kontext.ts';
import type { PodepsaneMedium } from './typy.ts';

const FB = 'https://www.facebook.com';

export async function ziskejPageToken(k: KontextAdapteru, pageId: string): Promise<string> {
  const ulozeny = k.pageTokeny.get(pageId);
  if (ulozeny) return ulozeny;
  const r = await k.graph.get<{ access_token?: string }>(`/${pageId}`, { fields: 'access_token' }, k.token);
  if (!r.access_token) {
    throw new ChybaPublikace('token', 'page_access_missing',
      'Klíč Meta nemá přístup ke stránce (systémový uživatel ji nemá přiřazenou). Propojte účet znovu.');
  }
  k.pageTokeny.set(pageId, r.access_token);
  return r.access_token;
}

/** Text příspěvku; odkaz se u fotek a videí připojí na konec (feed ho bere zvlášť). */
function popisek(k: KontextAdapteru, sOdkazem: boolean): string {
  const text = k.post.caption ?? '';
  if (!sOdkazem || !k.post.link_url) return text;
  return text.trim() ? `${text}\n\n${k.post.link_url}` : k.post.link_url;
}

async function hotovo(k: KontextAdapteru, externalId: string, externalUrl: string): Promise<VysledekAdapteru> {
  await k.krok('published_remote', { post_id: externalId, post_url: externalUrl });
  return { typ: 'publikovano', externalId, externalUrl };
}

export async function publikujFacebook(k: KontextAdapteru): Promise<VysledekAdapteru> {
  // Předchozí běh už zveřejnil, jen se nestihl zapsat výsledek.
  if (k.stav.post_id) {
    return { typ: 'publikovano', externalId: k.stav.post_id, externalUrl: k.stav.post_url ?? null };
  }
  if (k.post.format === 'story') {
    throw fatal('format_not_supported', 'Příběhy (story) na Facebook zatím publikovat neumíme.');
  }
  const page = k.ucet.external_id;
  const fotky = k.media.filter((m) => m.kind === 'image');
  const videa = k.media.filter((m) => m.kind === 'video');
  const pageToken = await ziskejPageToken(k, page);

  if (k.post.format === 'reel') {
    if (videa.length !== 1 || fotky.length > 0) {
      throw fatal('media_combination', 'Reel musí mít právě jedno video a nic dalšího.');
    }
    return reel(k, page, pageToken, videa[0]);
  }

  // feed a carousel
  if (videa.length > 0 && (videa.length > 1 || fotky.length > 0 || k.post.format === 'carousel')) {
    throw fatal('media_combination', 'Na Facebook jde jedno video samostatně, nebo jen fotky. Video s fotkami ani víc videí v jednom příspěvku nejde.');
  }
  if (videa.length === 1) return video(k, page, pageToken, videa[0]);
  if (fotky.length === 1) return jednaFotka(k, page, pageToken, fotky[0]);
  if (fotky.length > 1) return viceFotek(k, page, pageToken, fotky);
  return textNeboOdkaz(k, page, pageToken);
}

async function textNeboOdkaz(k: KontextAdapteru, page: string, pageToken: string): Promise<VysledekAdapteru> {
  if (!k.post.caption.trim() && !k.post.link_url) {
    throw fatal('empty_post', 'Příspěvek nemá text, odkaz ani média.');
  }
  const params: Record<string, string> = { message: k.post.caption };
  if (k.post.link_url) params.link = k.post.link_url;
  await k.krok('publishing');
  const id = potvrzeneId(await k.publikuj(`/${page}/feed`, params, pageToken), 'id', true);
  return hotovo(k, id, `${FB}/${id}`);
}

async function jednaFotka(k: KontextAdapteru, page: string, pageToken: string, f: PodepsaneMedium): Promise<VysledekAdapteru> {
  await k.krok('publishing');
  const r = await k.publikuj<{ id: string; post_id?: string }>(`/${page}/photos`, {
    url: f.url,
    caption: popisek(k, true),
    published: 'true',
  }, pageToken);
  const id = potvrzeneId(r.post_id ? r : { post_id: r.id }, 'post_id', true);
  return hotovo(k, id, `${FB}/${id}`);
}

async function viceFotek(k: KontextAdapteru, page: string, pageToken: string, fotky: PodepsaneMedium[]): Promise<VysledekAdapteru> {
  const ids = [...(k.stav.photo_ids ?? [])];
  for (let i = ids.length; i < fotky.length; i++) {
    const r = await k.graph.post(`/${page}/photos`, {
      url: fotky[i].url,
      published: 'false',
    }, pageToken);
    ids.push(potvrzeneId(r, 'id', false));
    await k.krok('photos_uploading', { photo_ids: [...ids] });
  }
  await k.krok('publishing');
  const r = await k.publikuj(`/${page}/feed`, {
    message: popisek(k, true),
    attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
  }, pageToken);
  const id = potvrzeneId(r, 'id', true);
  return hotovo(k, id, `${FB}/${id}`);
}

async function video(k: KontextAdapteru, page: string, pageToken: string, v: PodepsaneMedium): Promise<VysledekAdapteru> {
  if (k.zbyvaMs() < DLOUHY_KROK_MS) throw new MaloCasu('video');
  await k.krok('publishing');
  const r = await k.publikuj(`/${page}/videos`, {
    file_url: v.url,
    description: popisek(k, true),
  }, pageToken, { limitMs: DLOUHY_KROK_MS });
  const id = potvrzeneId(r, 'id', true);
  return hotovo(k, id, `${FB}/${page}/videos/${id}`);
}

async function reel(k: KontextAdapteru, page: string, pageToken: string, v: PodepsaneMedium): Promise<VysledekAdapteru> {
  if (!k.stav.video_id || !k.stav.upload_url) {
    const start = await k.graph.post<{ video_id: string; upload_url?: string }>(`/${page}/video_reels`, {
      upload_phase: 'start',
    }, pageToken);
    const startId = potvrzeneId(start, 'video_id', false);
    const uploadUrl = start.upload_url ?? `https://rupload.facebook.com/video-upload/${k.graph.verze}/${startId}`;
    await k.krok('reel_started', { video_id: startId, upload_url: uploadUrl, uploaded: false });
  }
  const videoId = k.stav.video_id as string;
  if (!k.stav.uploaded) {
    if (k.zbyvaMs() < DLOUHY_KROK_MS) throw new MaloCasu('reel_upload');
    await k.graph.postNaUrl<{ success?: boolean }>(k.stav.upload_url as string, {
      Authorization: `OAuth ${pageToken}`,
      file_url: v.url,
    }, { limitMs: DLOUHY_KROK_MS });
    await k.krok('reel_uploaded', { uploaded: true });
  }
  await k.krok('publishing');
  const konec = await k.publikuj<{ success?: boolean }>(`/${page}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: popisek(k, true),
  }, pageToken);
  if (konec?.success !== true) potvrzeneId({}, 'success', true); // 2xx bez potvrzení = nejisté
  return hotovo(k, videoId, `${FB}/reel/${videoId}`);
}
