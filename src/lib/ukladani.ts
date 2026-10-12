// Plán a provedení uložení příspěvku — čistá logika, DB operace se předávají zvenku.
//
// Proč tak opatrně:
// - Smazání a nové vložení post_media spustí v DB trigger, který vynuluje
//   posts.remote_state (container_id, video_id …). Publikační smyčka by pak příspěvek,
//   který už na síti napůl nebo celý je, poslala znovu → dvojí publikace.
//   Média se proto přepisují JEN když se seřazený seznam asset_id opravdu liší.
// - Naplánovaný příspěvek se během úprav vrací do konceptu (aby ho smyčka nechytla
//   napůl uložený). Když další krok selže, zůstane konceptem — a to se musí říct nahlas.

import type { PlatformOptions, PostFormat, PostStatus } from "./db-types";

export type ObsahPrispevku = {
  account_id: string;
  group_id: string | null;
  format: PostFormat;
  caption: string;
  link_url: string | null;
  scheduled_at: string | null;
  platform_options: PlatformOptions;
  content_hash: string;
};

export type StavVDb = {
  status: PostStatus;
  obsah: Omit<ObsahPrispevku, "content_hash"> & { content_hash: string | null };
  /** asset_id seřazené podle position */
  assetIds: string[];
};

export type PlanUlozeni = {
  vychoziStav: PostStatus;
  /** scheduled → draft před úpravami */
  doKonceptu: boolean;
  obsah: ObsahPrispevku | null;
  media: string[] | null;
  cilovyStav: PostStatus | null;
};

export const HLASKA_ZUSTAL_KONCEPT =
  "Příspěvek se nepodařilo uložit a je teď koncept — nevyjde, dokud ho znovu nenaplánujete.";
/** Nový koncept je v DB, ale média se k němu nepřipojila. */
export const HLASKA_KONCEPT_BEZ_MEDII =
  "Koncept se uložil, ale bez médií — přidejte je znovu a uložte.";
/** Nový příspěvek se měl naplánovat, ale zůstal konceptem bez médií. */
export const HLASKA_NENAPLANOVANO_BEZ_MEDII =
  "Příspěvek se uložil jen jako koncept bez médií — nevyjde, dokud média nepřidáte a znovu ho nenaplánujete.";

/** Uložení se nedokončilo a příspěvek zůstal v DB jako koncept. */
export class UlozeniNedokonceno extends Error {
  readonly postId: string;
  readonly stav = "draft" as const;
  constructor(postId: string, pricina: unknown, hlaska: string = HLASKA_ZUSTAL_KONCEPT) {
    const detail = pricina instanceof Error ? pricina.message : typeof pricina === "object" && pricina && "message" in pricina ? String((pricina as { message: unknown }).message) : String(pricina);
    super(`${hlaska} (${detail})`);
    this.name = "UlozeniNedokonceno";
    this.postId = postId;
  }
}

/** JSON se seřazenými klíči — {a,b} a {b,a} jsou totéž. */
function stabilniJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stabilniJson).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabilniJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

function stejnyCas(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

export function stejnaMedia(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function stejnyObsah(db: StavVDb["obsah"], novy: ObsahPrispevku): boolean {
  return (
    db.account_id === novy.account_id &&
    db.group_id === novy.group_id &&
    db.format === novy.format &&
    db.caption === novy.caption &&
    (db.link_url ?? null) === (novy.link_url ?? null) &&
    stejnyCas(db.scheduled_at, novy.scheduled_at) &&
    stabilniJson(db.platform_options ?? {}) === stabilniJson(novy.platform_options ?? {}) &&
    db.content_hash === novy.content_hash
  );
}

export function naplanujUlozeni(
  db: StavVDb,
  novy: { obsah: ObsahPrispevku; assetIds: string[] },
  cil: "draft" | "scheduled",
): PlanUlozeni {
  const zmenaObsahu = !stejnyObsah(db.obsah, novy.obsah);
  const zmenaMedii = !stejnaMedia(db.assetIds, novy.assetIds);
  const neco = zmenaObsahu || zmenaMedii;
  const doKonceptu = neco && db.status === "scheduled";
  const stavPoPrvnimKroku: PostStatus = doKonceptu ? "draft" : db.status;
  return {
    vychoziStav: db.status,
    doKonceptu,
    obsah: zmenaObsahu ? novy.obsah : null,
    media: zmenaMedii ? [...novy.assetIds] : null,
    cilovyStav: stavPoPrvnimKroku === cil ? null : cil,
  };
}

export type OperaceUlozeni = {
  zmenStav: (id: string, ocekavany: PostStatus, novy: PostStatus) => Promise<void>;
  zmenObsah: (id: string, ocekavany: PostStatus, obsah: ObsahPrispevku) => Promise<void>;
  nastavMedia: (id: string, assetIds: string[]) => Promise<void>;
};

/**
 * Provede plán. Když po přepnutí do konceptu (nebo u konceptu, který se měl
 * naplánovat) některý krok selže, vyhodí UlozeniNedokonceno s jasnou hláškou.
 */
export async function provedUlozeni(id: string, plan: PlanUlozeni, op: OperaceUlozeni): Promise<PostStatus> {
  let stav = plan.vychoziStav;
  if (plan.doKonceptu) {
    await op.zmenStav(id, stav, "draft");
    stav = "draft";
  }
  try {
    if (plan.obsah) await op.zmenObsah(id, stav, plan.obsah);
    if (plan.media) await op.nastavMedia(id, plan.media);
    if (plan.cilovyStav && plan.cilovyStav !== stav) {
      await op.zmenStav(id, stav, plan.cilovyStav);
      stav = plan.cilovyStav;
    }
  } catch (e) {
    if (stav === "draft" && (plan.doKonceptu || plan.cilovyStav === "scheduled")) {
      throw new UlozeniNedokonceno(id, e);
    }
    throw e;
  }
  return stav;
}

/**
 * Dokončí právě vložený řádek (je v DB jako koncept): připojí média a případně
 * naplánuje. Při JAKÉKOLI chybě vyhodí UlozeniNedokonceno s id řádku, aby si ho
 * editor zapamatoval a další uložení nezaložilo druhý řádek. Hláška odpovídá stavu.
 */
export async function provedPoVlozeni(
  id: string,
  assetIds: string[],
  cil: "draft" | "scheduled",
  op: OperaceUlozeni,
): Promise<PostStatus> {
  if (assetIds.length > 0) {
    try {
      await op.nastavMedia(id, assetIds);
    } catch (e) {
      throw new UlozeniNedokonceno(id, e, cil === "scheduled" ? HLASKA_NENAPLANOVANO_BEZ_MEDII : HLASKA_KONCEPT_BEZ_MEDII);
    }
  }
  if (cil === "scheduled") {
    try {
      await op.zmenStav(id, "draft", "scheduled");
    } catch (e) {
      throw new UlozeniNedokonceno(id, e);
    }
  }
  return cil;
}

/** Z chyby uložení vytáhne id a stav řádku, který v DB už je (jinak null). */
export function vysledekZChyby(e: unknown): { id: string; status: "draft" } | null {
  return e instanceof UlozeniNedokonceno ? { id: e.postId, status: e.stav } : null;
}
