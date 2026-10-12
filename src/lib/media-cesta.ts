// Cesty v privátním bucketu `media`: {account_id|shared}/{yyyy}/{mm}/{uuid}.{ext}
// Náhled: thumbs/{account_id|shared}/{yyyy}/{mm}/{uuid}.jpg

import { utcNaMistni, APP_TZ } from "./cas";

export const BUCKET = "media";

const PRIPONY: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function priponaProMime(mime: string, nazevSouboru = ""): string {
  if (PRIPONY[mime]) return PRIPONY[mime];
  const z = /\.([a-z0-9]{1,5})$/i.exec(nazevSouboru);
  return z ? z[1].toLowerCase() : "bin";
}

export function cestaMedia(
  accountId: string | null,
  kdy: Date,
  uuid: string,
  pripona: string,
): string {
  const m = utcNaMistni(kdy, APP_TZ);
  const mm = String(m.mesic).padStart(2, "0");
  return `${accountId ?? "shared"}/${m.rok}/${mm}/${uuid}.${pripona}`;
}

export function cestaNahledu(cesta: string): string {
  return `thumbs/${cesta.replace(/\.[^./]+$/, "")}.jpg`;
}
