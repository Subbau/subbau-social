// Adaptér Instagramu (Content Publishing API přes systémový klíč, ig user id = external_id).
// Kontejner → čekat na FINISHED → media_publish. Po každém kroku se ukládá remote_state:
// opakování navazuje na uložený kontejner a NIKDY nevytváří nový, když už jeden existuje.
import { fatal } from './chyby.ts';
import { potvrzeneId } from './graph.ts';
import type { KontextAdapteru, VysledekAdapteru } from './kontext.ts';
import { jeJpeg, normalizujText } from './pravidla.ts';
import type { PodepsaneMedium } from './typy.ts';

type StavKontejneru = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
const ZPRACOVAVA: VysledekAdapteru = { typ: 'zpracovava' };

export async function stavKontejneru(k: KontextAdapteru, id: string): Promise<StavKontejneru> {
  const r = await k.graph.get<{ status_code?: string }>(`/${id}`, { fields: 'status_code' }, k.token);
  return (r.status_code ?? 'IN_PROGRESS') as StavKontejneru;
}

function chybaKontejneru(stav: StavKontejneru): never {
  if (stav === 'EXPIRED') {
    throw fatal('container_expired', 'Instagram: připravené médium vypršelo (platí 24 hodin). Naplánujte příspěvek znovu.');
  }
  throw fatal('container_error', 'Instagram médium nezpracoval (vadný nebo nepodporovaný soubor — zkontrolujte formát, délku a rozměr).');
}

/**
 * Čeká na zpracování kontejnerů v rámci rozpočtu běhu (k.cekani.celkemMs).
 * Vrací 'FINISHED', 'PUBLISHED' (jen pro jeden kontejner) nebo 'IN_PROGRESS' (běh se odloží).
 */
async function pockej(k: KontextAdapteru, ids: string[], konec: number): Promise<StavKontejneru> {
  for (let kolo = 0; kolo < 100; kolo++) {
    let vse = true;
    for (const id of ids) {
      const s = await stavKontejneru(k, id);
      if (s === 'ERROR' || s === 'EXPIRED') chybaKontejneru(s);
      if (s === 'PUBLISHED' && ids.length === 1) return 'PUBLISHED';
      if (s === 'IN_PROGRESS') vse = false;
    }
    if (vse) return 'FINISHED';
    if (k.ted().getTime() + k.cekani.intervalMs > konec) return 'IN_PROGRESS';
    await k.spanek(k.cekani.intervalMs);
  }
  return 'IN_PROGRESS';
}

function vyprselo(k: KontextAdapteru, od: string | undefined): boolean {
  return od !== undefined && k.ted().getTime() - new Date(od).getTime() > k.cekani.vzdatPoMs;
}

async function odloz(k: KontextAdapteru, od: string | undefined): Promise<VysledekAdapteru> {
  if (vyprselo(k, od)) {
    throw fatal('container_timeout', 'Instagram médium nezpracoval ani za hodinu. Zkuste kratší nebo menší video.');
  }
  await k.krok('container_processing');
  return ZPRACOVAVA;
}

function mediumParams(m: PodepsaneMedium, videoTyp: 'VIDEO' | 'REELS' | 'STORIES'): Record<string, string> {
  if (m.kind === 'video') return { media_type: videoTyp, video_url: m.url };
  if (!jeJpeg(m)) throw fatal('image_not_jpeg', 'Instagram přijímá jen obrázky JPEG. Nahrajte obrázek znovu (aplikace ho převede).');
  return { image_url: m.url };
}

/** Ověří složení médií a vrátí, jaký kontejner se má vytvořit. */
function plan(k: KontextAdapteru): { druh: 'single'; params: Record<string, string> } | { druh: 'carousel' } {
  const { format, caption } = k.post;
  const media = k.media;
  if (media.length === 0) throw fatal('media_required', 'Příspěvek na Instagram musí mít aspoň jednu fotku nebo video.');
  if (format === 'story') {
    if (media.length !== 1) throw fatal('media_combination', 'Příběh (story) na Instagram má právě jedno médium.');
    const m = media[0];
    return { druh: 'single', params: m.kind === 'video' ? { media_type: 'STORIES', video_url: m.url } : { media_type: 'STORIES', ...mediumParams(m, 'STORIES') } };
  }
  if (format === 'reel') {
    if (media.length !== 1 || media[0].kind !== 'video') throw fatal('media_combination', 'Reel musí mít právě jedno video.');
    return { druh: 'single', params: { media_type: 'REELS', video_url: media[0].url, caption, share_to_feed: 'true' } };
  }
  if (format === 'carousel' || media.length > 1) {
    if (media.length < 2 || media.length > 10) throw fatal('carousel_count', 'Karusel na Instagramu musí mít 2 až 10 položek.');
    media.forEach((m) => m.kind === 'image' && mediumParams(m, 'VIDEO'));
    return { druh: 'carousel' };
  }
  const m = media[0];
  // Samostatné video ve feedu Instagram publikuje jako reel (sdílený do feedu).
  if (m.kind === 'video') return { druh: 'single', params: { media_type: 'REELS', video_url: m.url, caption, share_to_feed: 'true' } };
  return { druh: 'single', params: { ...mediumParams(m, 'VIDEO'), caption } };
}

/** Vytvoří kontejner (u karuselu nejdřív děti). Vrací ZPRACOVAVA, když děti nejsou hotové. */
async function vytvorKontejner(k: KontextAdapteru, ig: string, konec: number): Promise<VysledekAdapteru | null> {
  const p = plan(k);
  if (p.druh === 'single') {
    const r = await k.graph.post(`/${ig}/media`, p.params, k.token);
    await k.krok('container_created', { container_id: potvrzeneId(r, 'id', false), container_created_at: k.ted().toISOString() });
    return null;
  }

  const deti = [...(k.stav.children ?? [])];
  if (!k.stav.carousel_started_at) await k.krok('carousel_items', { carousel_started_at: k.ted().toISOString() });
  for (let i = deti.length; i < k.media.length; i++) {
    const r = await k.graph.post<{ id: string }>(`/${ig}/media`, {
      ...mediumParams(k.media[i], 'VIDEO'),
      is_carousel_item: 'true',
    }, k.token);
    deti.push(potvrzeneId(r, 'id', false));
    await k.krok('carousel_items', { children: [...deti] });
  }
  const videoDeti = deti.filter((_, i) => k.media[i].kind === 'video');
  if (videoDeti.length > 0 && (await pockej(k, videoDeti, konec)) === 'IN_PROGRESS') {
    return odloz(k, k.stav.carousel_started_at);
  }
  const r = await k.graph.post<{ id: string }>(`/${ig}/media`, {
    media_type: 'CAROUSEL',
    children: deti.join(','),
    caption: k.post.caption,
  }, k.token);
  await k.krok('container_created', { container_id: potvrzeneId(r, 'id', false), container_created_at: k.ted().toISOString() });
  return null;
}

/** Čas z Instagramu („2026-10-12T10:00:00+0000“) → ms; neplatný → NaN. */
export function casInstagramu(t: string | undefined): number {
  return t ? Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN;
}

/**
 * Kontejner je PUBLISHED, ale nevíme id příspěvku → dohledat podle popisku A času:
 * příspěvek nesmí být starší než minutu před odesláním media_publish (jinak by se
 * našel minulý výskyt téže série se stejným textem). Nic nepublikuje.
 */
async function dohledej(k: KontextAdapteru, ig: string): Promise<VysledekAdapteru> {
  let nalezeny: { id: string; permalink?: string } | undefined;
  if (k.post.format !== 'story') {
    try {
      const r = await k.graph.get<{ data?: { id: string; caption?: string; permalink?: string; timestamp?: string }[] }>(
        `/${ig}/media`, { fields: 'id,caption,permalink,timestamp', limit: '10' }, k.token);
      const hledany = normalizujText(k.post.caption);
      const odkdy = k.stav.publish_sent_at ?? k.stav.container_created_at;
      const nejdrive = odkdy ? Date.parse(odkdy) - 60_000 : -Infinity;
      nalezeny = (r.data ?? []).find((m) => normalizujText(m.caption) === hledany
        && (nejdrive === -Infinity || casInstagramu(m.timestamp) >= nejdrive));
    } catch {
      nalezeny = undefined; // příspěvek vyšel; chybějící odkaz není důvod k chybě
    }
  }
  await k.krok('published_remote', { media_id: nalezeny?.id, permalink: nalezeny?.permalink ?? null });
  return { typ: 'publikovano', externalId: nalezeny?.id ?? null, externalUrl: nalezeny?.permalink ?? null };
}

export async function publikujInstagram(k: KontextAdapteru): Promise<VysledekAdapteru> {
  const ig = k.ucet.external_id;
  const konec = Math.min(k.ted().getTime() + k.cekani.celkemMs, k.ted().getTime() + k.zbyvaMs());

  // Předchozí běh zveřejnil, jen se nestihl zapsat výsledek.
  if (k.stav.media_id) {
    return { typ: 'publikovano', externalId: k.stav.media_id, externalUrl: k.stav.permalink ?? null };
  }

  if (!k.stav.container_id) {
    const odlozeno = await vytvorKontejner(k, ig, konec);
    if (odlozeno) return odlozeno;
  }
  const containerId = k.stav.container_id as string;

  // Stav kontejneru se zjišťuje VŽDY před media_publish. Když předchozí media_publish
  // skončil nejistě (publish_sent_at), rozhodne právě tohle: PUBLISHED = vyšel → jen
  // dohledat, FINISHED = nevyšel → smí se publikovat, ERROR/EXPIRED = fatal.
  const s = await pockej(k, [containerId], konec);
  if (s === 'PUBLISHED') return dohledej(k, ig);
  if (s === 'IN_PROGRESS') return odloz(k, k.stav.container_created_at);

  await k.krok('publishing', { publish_sent_at: k.ted().toISOString() });
  // overitelne: před každým opakováním se čte stav kontejneru, takže 5xx smí jít znovu.
  const mediaId = potvrzeneId(
    await k.publikuj(`/${ig}/media_publish`, { creation_id: containerId }, k.token, { overitelne: true }), 'id', true);
  await k.krok('published_remote', { media_id: mediaId, permalink: null });

  let permalink: string | null = null;
  try {
    const p = await k.graph.get<{ permalink?: string }>(`/${mediaId}`, { fields: 'permalink' }, k.token);
    permalink = p.permalink ?? null;
  } catch {
    permalink = null; // vyšlo; odkaz doplní UI z external_id, není to chyba publikace
  }
  if (permalink) await k.krok('published_remote', { permalink });
  return { typ: 'publikovano', externalId: mediaId, externalUrl: permalink };
}
