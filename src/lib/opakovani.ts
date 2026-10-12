// Formulář „Opakovat“ → řádek post_series.

import type { PostSeries, PostStatus } from "./db-types";
import { zkontrolujVariantu, type VariantaProKontrolu } from "./validace";
import { rozlozCas } from "./cas";

export type FormularOpakovani = {
  freq: "weekly" | "monthly";
  interval_n: number;
  weekdays: number[];
  month_day: number;
  /** "HH:MM" */
  cas: string;
  starts_on: string;
  until_on: string;
};

export type NovaSerie = Pick<
  PostSeries,
  | "account_id"
  | "template_post_id"
  | "freq"
  | "interval_n"
  | "weekdays"
  | "month_day"
  | "time_of_day"
  | "timezone"
  | "starts_on"
  | "until_on"
>;

export function zkontrolujOpakovani(f: FormularOpakovani): string[] {
  const chyby: string[] = [];
  if (!Number.isInteger(f.interval_n) || f.interval_n < 1) chyby.push("Interval musí být celé číslo od 1.");
  if (f.freq === "weekly" && f.weekdays.length === 0) chyby.push("Vyberte aspoň jeden den v týdnu.");
  if (f.freq === "weekly" && f.weekdays.some((d) => d < 1 || d > 7)) chyby.push("Neplatný den v týdnu.");
  if (f.freq === "monthly" && (!Number.isInteger(f.month_day) || f.month_day < 1 || f.month_day > 31)) {
    chyby.push("Den v měsíci musí být 1–31.");
  }
  try {
    rozlozCas(f.cas);
  } catch {
    chyby.push("Neplatný čas.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.starts_on)) chyby.push("Chybí datum začátku.");
  if (f.until_on && f.until_on < f.starts_on) chyby.push("Konec je dřív než začátek.");
  return chyby;
}

export function radekSerie(
  f: FormularOpakovani,
  accountId: string,
  templatePostId: string,
  timezone: string,
): NovaSerie {
  const { hodina, minuta } = rozlozCas(f.cas);
  return {
    account_id: accountId,
    template_post_id: templatePostId,
    freq: f.freq,
    interval_n: f.interval_n,
    weekdays: f.freq === "weekly" ? [...new Set(f.weekdays)].sort((a, b) => a - b) : null,
    month_day: f.freq === "monthly" ? f.month_day : null,
    time_of_day: `${String(hodina).padStart(2, "0")}:${String(minuta).padStart(2, "0")}:00`,
    timezone,
    starts_on: f.starts_on,
    until_on: f.until_on || null,
  };
}

export function popisOpakovani(s: Pick<PostSeries, "freq" | "interval_n" | "weekdays" | "month_day" | "time_of_day">): string {
  const dny = ["po", "út", "st", "čt", "pá", "so", "ne"];
  const cas = s.time_of_day.slice(0, 5);
  if (s.freq === "weekly") {
    const kazdy = s.interval_n === 1 ? "každý týden" : `každý ${s.interval_n}. týden`;
    return `${kazdy}: ${(s.weekdays ?? []).map((d) => dny[d - 1]).join(", ")} v ${cas}`;
  }
  const kazdy = s.interval_n === 1 ? "každý měsíc" : `každý ${s.interval_n}. měsíc`;
  return `${kazdy} ${s.month_day}. den v ${cas}`;
}

/** Je příspěvek šablonou nějaké série (aktivní i ukončené)? */
export function jeSablonouSerie(postId: string | null, serie: Pick<PostSeries, "template_post_id">[]): boolean {
  return postId !== null && serie.some((s) => s.template_post_id === postId);
}

/** Šablona série se sama nenaplánuje — výskyty vytváří opakování. */
export function lzeNaplanovat(postId: string | null, serie: Pick<PostSeries, "template_post_id">[]): boolean {
  return !jeSablonouSerie(postId, serie);
}

/**
 * Smí se k příspěvku založit opakování?
 * Ne u výskytu série a ne u šablony AKTIVNÍ série. U šablony ukončené série ano —
 * jinak by nešlo změnit čas opakování (ukončit + založit nové).
 */
export function lzeZalozitOpakovani(
  v: { id: string | null; status: PostStatus; series_id: string | null },
  serie: Pick<PostSeries, "template_post_id" | "is_active"> | null,
): boolean {
  if (v.series_id) return false;
  if (v.status !== "draft" && v.status !== "scheduled" && v.status !== "failed") return false;
  if (serie && v.id && serie.template_post_id === v.id && serie.is_active) return false;
  return true;
}

/** Blokující chyby obsahu před založením opakování (bez kontroly času). */
export function chybyPredOpakovanim(v: Omit<VariantaProKontrolu, "scheduledAt">): string[] {
  return zkontrolujVariantu({ ...v, scheduledAt: null }, "opakovani").blokujici;
}
