// Příprava a nahrání médií v prohlížeči.
// - obrázky, které nejsou JPEG, převedeme na JPEG (Instagram bere jen JPEG)
// - video: délka a rozměry přes <video>, náhled = snímek
// - soubory nad 6 MB přes TUS (obnovitelné nahrávání), menší přímo

import * as tus from "tus-js-client";
import type { Database, MediaAsset } from "./db-types";
import { LIMIT_NAHRAVANI_B, chybaVelikosti, jeObrazek } from "./limit-nahravani";
import { fingerprintSouboru } from "./fingerprint";
import { BUCKET, cestaMedia, cestaNahledu, priponaProMime } from "./media-cesta";
import { supabase } from "./supabase/client";
import { CHYBI_NASTAVENI, supabaseEnv } from "./supabase/env";

export const TUS_PRAH = 6 * 1024 * 1024;
export const TUS_CHUNK = 6 * 1024 * 1024; // Supabase vyžaduje přesně 6 MB
export const JPEG_KVALITA = 0.9;
const NAHLED_STRANA = 480;
/** Stejné jako allowed_mime_types bucketu (supabase/setup/01_bucket_media.sql). */
const POVOLENA_VIDEA = ["video/mp4", "video/quicktime"];

export type PripravenySoubor = {
  blob: Blob;
  mime: string;
  pripona: string;
  kind: "image" | "video";
  width: number | null;
  height: number | null;
  duration: number | null;
  nahled: Blob | null;
};

type Obrazek = { zdroj: CanvasImageSource; w: number; h: number; uvolni: () => void };

async function nactiObrazek(soubor: Blob): Promise<Obrazek> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(soubor, { imageOrientation: "from-image" });
      return { zdroj: bmp, w: bmp.width, h: bmp.height, uvolni: () => bmp.close() };
    } catch {
      // zkusíme <img>
    }
  }
  const url = URL.createObjectURL(soubor);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { zdroj: img, w: img.naturalWidth, h: img.naturalHeight, uvolni: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Obrázek se nepodařilo načíst. Formát HEIC uložte v telefonu jako JPEG.");
  }
}

function naJpeg(zdroj: CanvasImageSource, w: number, h: number, kvalita: number, maxStrana?: number): Promise<Blob> {
  const meritko = maxStrana ? Math.min(1, maxStrana / Math.max(w, h)) : 1;
  const cw = Math.max(1, Math.round(w * meritko));
  const ch = Math.max(1, Math.round(h * meritko));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Prohlížeč neumí kreslit do canvasu.");
  ctx.fillStyle = "#ffffff"; // průhlednost z PNG → bílá
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(zdroj, 0, 0, cw, ch);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Převod na JPEG selhal."))), "image/jpeg", kvalita),
  );
}

function cekejNa(el: HTMLMediaElement, udalost: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      uklid();
      reject(new Error("Video se nepodařilo načíst (vypršel čas)."));
    }, ms);
    const ok = () => {
      uklid();
      resolve();
    };
    const chyba = () => {
      uklid();
      reject(new Error("Prohlížeč video neumí přečíst."));
    };
    const uklid = () => {
      clearTimeout(t);
      el.removeEventListener(udalost, ok);
      el.removeEventListener("error", chyba);
    };
    el.addEventListener(udalost, ok);
    el.addEventListener("error", chyba);
  });
}

async function pripravVideo(soubor: File): Promise<PripravenySoubor> {
  const url = URL.createObjectURL(soubor);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    video.src = url;
    await cekejNa(video, "loadedmetadata", 30_000);
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const width = video.videoWidth || null;
    const height = video.videoHeight || null;
    let nahled: Blob | null = null;
    try {
      video.currentTime = Math.min(1, (duration ?? 0) / 10);
      await cekejNa(video, "seeked", 15_000);
      if (width && height) nahled = await naJpeg(video, width, height, 0.8, NAHLED_STRANA);
    } catch {
      nahled = null; // bez náhledu se dá žít
    }
    const mime = soubor.type === "video/x-m4v" || !soubor.type ? "video/mp4" : soubor.type;
    if (!POVOLENA_VIDEA.includes(mime)) {
      throw new Error(`Video „${soubor.name}“ je ${mime} — bucket bere jen MP4 a MOV.`);
    }
    return { blob: soubor, mime, pripona: priponaProMime(mime, soubor.name), kind: "video", width, height, duration, nahled };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function pripravSoubor(soubor: File): Promise<PripravenySoubor> {
  const typ = soubor.type || "";
  if (typ.startsWith("video/")) return pripravVideo(soubor);
  if (typ.startsWith("image/") || /\.(heic|heif)$/i.test(soubor.name)) {
    const obr = await nactiObrazek(soubor);
    try {
      const jeJpeg = typ === "image/jpeg";
      const blob = jeJpeg ? soubor : await naJpeg(obr.zdroj, obr.w, obr.h, JPEG_KVALITA);
      const nahled = await naJpeg(obr.zdroj, obr.w, obr.h, 0.8, NAHLED_STRANA);
      return { blob, mime: "image/jpeg", pripona: "jpg", kind: "image", width: obr.w, height: obr.h, duration: null, nahled };
    } finally {
      obr.uvolni();
    }
  }
  throw new Error(`Soubor „${soubor.name}“ není obrázek ani video.`);
}

/** Nahraje objekt do bucketu media. Průběh 0–1. */
export async function nahrajObjekt(
  cesta: string,
  blob: Blob,
  mime: string,
  prubeh: (podil: number) => void,
): Promise<void> {
  const sb = supabase();
  if (blob.size <= TUS_PRAH) {
    const { error } = await sb.storage.from(BUCKET).upload(cesta, blob, { contentType: mime, upsert: false, cacheControl: "3600" });
    if (error) throw error;
    prubeh(1);
    return;
  }
  const env = supabaseEnv();
  if (!env) throw new Error(CHYBI_NASTAVENI);
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Nejste přihlášeni.");
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: `${env.url}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, apikey: env.anonKey, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: BUCKET, objectName: cesta, contentType: mime, cacheControl: "3600" },
      chunkSize: TUS_CHUNK,
      onError: (e) => reject(e),
      onProgress: (odeslano, celkem) => prubeh(celkem ? odeslano / celkem : 0),
      onSuccess: () => resolve(),
    });
    upload
      .findPreviousUploads()
      .then((predchozi) => {
        if (predchozi.length) upload.resumeFromPreviousUpload(predchozi[0]);
        upload.start();
      })
      .catch(reject);
  });
}

export type VysledekNahrani = { asset: MediaAsset; uzExistoval: boolean };

/** Co nahrání potřebuje zvenku — v testech se nahradí falešnými funkcemi. */
export type ZavislostiNahrani = {
  priprav: (soubor: File) => Promise<PripravenySoubor>;
  otisk: (blob: Blob) => Promise<string>;
  najdiStejny: (fingerprint: string) => Promise<MediaAsset | null>;
  nahrajObjekt: (cesta: string, blob: Blob, mime: string, prubeh: (podil: number) => void) => Promise<void>;
  vlozRadek: (radek: Database["public"]["Tables"]["media_assets"]["Insert"]) => Promise<MediaAsset>;
  odstran: (cesty: string[]) => Promise<void>;
  limitB: number;
};

function vychoziZavislosti(): ZavislostiNahrani {
  const sb = supabase();
  return {
    priprav: pripravSoubor,
    otisk: fingerprintSouboru,
    najdiStejny: async (fingerprint) => {
      const { data } = await sb.from("media_assets").select("*").eq("fingerprint", fingerprint).limit(1);
      return data && data.length ? data[0] : null;
    },
    nahrajObjekt,
    vlozRadek: async (radek) => {
      const { data, error } = await sb.from("media_assets").insert(radek).select("*").single();
      if (error) throw error;
      return data;
    },
    odstran: async (cesty) => {
      await sb.storage.from(BUCKET).remove(cesty);
    },
    limitB: LIMIT_NAHRAVANI_B,
  };
}

/**
 * Celé nahrání do knihovny: příprava (obrázek → JPEG) → kontrola limitu velikosti
 * (u obrázku až po převodu) → fingerprint → (stejný soubor už je?) → náhled → soubor
 * → řádek media_assets.
 */
export async function nahrajDoKnihovny(
  soubor: File,
  accountId: string | null,
  stitky: string[],
  prubeh: (podil: number, faze: string) => void,
  z: ZavislostiNahrani = vychoziZavislosti(),
): Promise<VysledekNahrani> {
  // Neobrázek nad limit nemá smysl ani připravovat (video by se zbytečně četlo).
  if (!jeObrazek(soubor)) {
    const chyba = chybaVelikosti(soubor.size, z.limitB);
    if (chyba) throw new Error(chyba);
  }
  prubeh(0, "připravuji");
  const p = await z.priprav(soubor);
  const chyba = chybaVelikosti(p.blob.size, z.limitB);
  if (chyba) throw new Error(chyba);

  prubeh(0, "počítám otisk");
  const fingerprint = await z.otisk(p.blob);
  const stejny = await z.najdiStejny(fingerprint);
  if (stejny) {
    prubeh(1, "už v knihovně");
    return { asset: stejny, uzExistoval: true };
  }

  const cesta = cestaMedia(accountId, new Date(), crypto.randomUUID(), p.pripona);
  const nahledCesta = p.nahled ? cestaNahledu(cesta) : null;
  const nahrane: string[] = [];
  try {
    if (p.nahled && nahledCesta) {
      await z.nahrajObjekt(nahledCesta, p.nahled, "image/jpeg", () => undefined);
      nahrane.push(nahledCesta);
    }
    await z.nahrajObjekt(cesta, p.blob, p.mime, (x) => prubeh(x, "nahrávám"));
    nahrane.push(cesta);
    const asset = await z.vlozRadek({
      account_id: accountId,
      storage_path: cesta,
      kind: p.kind,
      mime_type: p.mime,
      size_bytes: p.blob.size,
      width: p.width,
      height: p.height,
      duration_seconds: p.duration,
      fingerprint,
      thumbnail_path: nahledCesta,
      original_name: soubor.name,
      tags: stitky,
    });
    prubeh(1, "hotovo");
    return { asset, uzExistoval: false };
  } catch (e) {
    if (nahrane.length) await z.odstran(nahrane).catch(() => undefined);
    throw e;
  }
}

/** Smaže médium, jen když ho nepoužívá žádný příspěvek. */
export async function smazMedium(a: MediaAsset): Promise<void> {
  const sb = supabase();
  const { count, error } = await sb
    .from("post_media")
    .select("post_id", { count: "exact", head: true })
    .eq("asset_id", a.id);
  if (error) throw error;
  if ((count ?? 0) > 0) throw new Error(`Médium používá ${count} příspěvků — smazat nejde.`);
  const { error: e2 } = await sb.from("media_assets").delete().eq("id", a.id);
  if (e2) throw e2;
  const cesty = [a.storage_path, a.thumbnail_path].filter((c): c is string => Boolean(c));
  await sb.storage.from(BUCKET).remove(cesty);
}
