import type { MediaAsset, PlatformOptions, PostFormat, PostStatus, PostWithMedia, SocialAccount } from "@/lib/db-types";
import { mistniNaUtc, utcNaMistni } from "@/lib/cas";
import { serazenaMedia, type UkladanaVarianta } from "@/lib/data/prispevky";
import { povoleneFormaty } from "@/lib/stavy";

/** Jedna záložka editoru = jeden řádek posts (jeden účet, jeden čas). */
export type Varianta = {
  klic: string;
  id: string | null;
  status: PostStatus;
  account_id: string;
  group_id: string | null;
  series_id: string | null;
  copied_from_id: string | null;
  format: PostFormat;
  caption: string;
  link_url: string;
  media: MediaAsset[];
  /** místní datum v pásmu účtu, "" = bez času */
  datum: string;
  cas: string;
  platform_options: PlatformOptions;
  /** scheduled_at tak, jak přišel z DB (u nové varianty null) */
  puvodniCas: string | null;
  external_url: string | null;
  published_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  error_resolved_at: string | null;
};

export function zPrispevku(p: PostWithMedia, timezone: string): Varianta {
  const m = p.scheduled_at ? utcNaMistni(p.scheduled_at, timezone) : null;
  return {
    klic: p.id,
    id: p.id,
    status: p.status,
    account_id: p.account_id,
    group_id: p.group_id,
    series_id: p.series_id,
    copied_from_id: p.copied_from_id,
    format: p.format,
    caption: p.caption,
    link_url: p.link_url ?? "",
    media: serazenaMedia(p),
    datum: m?.datum ?? "",
    cas: m?.cas ?? "",
    platform_options: p.platform_options ?? {},
    puvodniCas: p.scheduled_at,
    external_url: p.external_url,
    published_at: p.published_at,
    last_error_code: p.last_error_code,
    last_error_message: p.last_error_message,
    error_resolved_at: p.error_resolved_at,
  };
}

export function novaVarianta(ucet: SocialAccount, kdy: Date | null, klic: string): Varianta {
  const m = kdy ? utcNaMistni(kdy, ucet.timezone) : null;
  return {
    klic,
    id: null,
    status: "draft",
    account_id: ucet.id,
    group_id: null,
    series_id: null,
    copied_from_id: null,
    format: povoleneFormaty(ucet.platform)[0] ?? "feed",
    caption: "",
    link_url: "",
    media: [],
    datum: m?.datum ?? "",
    cas: m?.cas ?? "",
    platform_options: {},
    puvodniCas: null,
    external_url: null,
    published_at: null,
    last_error_code: null,
    last_error_message: null,
    error_resolved_at: null,
  };
}

/** Okamžik varianty, nebo null (bez času / neúplné). */
export function okamzikVarianty(v: Pick<Varianta, "datum" | "cas">, timezone: string): Date | null {
  if (!v.datum || !v.cas) return null;
  try {
    return mistniNaUtc(v.datum, v.cas, timezone);
  } catch {
    return null;
  }
}

export function naUkladanou(v: Varianta, timezone: string): UkladanaVarianta {
  const kdy = okamzikVarianty(v, timezone);
  return {
    id: v.id,
    status: v.status,
    account_id: v.account_id,
    group_id: v.group_id,
    copied_from_id: v.copied_from_id,
    format: v.format,
    caption: v.caption,
    link_url: v.link_url.trim() || null,
    scheduled_at: kdy ? kdy.toISOString() : null,
    platform_options: v.platform_options,
    media: v.media,
  };
}

function stabilniJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stabilniJson).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stabilniJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(x);
}

/** Liší se rozpracovaná varianta od toho, co se načetlo z DB? */
export function variantaSeZmenila(puvodni: Varianta, ted: Varianta): boolean {
  return (
    puvodni.account_id !== ted.account_id ||
    puvodni.format !== ted.format ||
    puvodni.caption !== ted.caption ||
    puvodni.link_url.trim() !== ted.link_url.trim() ||
    puvodni.datum !== ted.datum ||
    puvodni.cas !== ted.cas ||
    puvodni.media.map((m) => m.id).join(",") !== ted.media.map((m) => m.id).join(",") ||
    stabilniJson(puvodni.platform_options) !== stabilniJson(ted.platform_options)
  );
}

/**
 * „Zkusit znovu“ v editoru: bez úprav jen změna stavu (zkusitZnovu v DB) —
 * žádné ukládání obsahu ani médií, aby se nesmazal remote_state.
 */
export function zpusobZkusitZnovu(puvodni: Varianta | undefined, ted: Varianta): "jen-stav" | "ulozit" {
  if (!ted.id || !puvodni) return "ulozit";
  return variantaSeZmenila(puvodni, ted) ? "ulozit" : "jen-stav";
}
