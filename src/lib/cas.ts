// Převody času mezi okamžikem (UTC, jak ho drží DB) a místním časem pásma účtu.
// Kalendářní data se drží jako text "YYYY-MM-DD" — aritmetika dnů se tak
// nikdy nesplete s posunem letního/zimního času.

import { TZDate, tz as tzIn } from "@date-fns/tz";
import { format } from "date-fns";
import { cs } from "date-fns/locale";

export const APP_TZ = "Europe/Prague";

export type MistniCas = {
  /** "YYYY-MM-DD" */
  datum: string;
  /** "HH:mm" */
  cas: string;
  rok: number;
  /** 1–12 */
  mesic: number;
  den: number;
  hodina: number;
  minuta: number;
  /** ISO: 1 = pondělí … 7 = neděle */
  denVTydnu: number;
};

const dvojmistne = (n: number) => String(n).padStart(2, "0");

export function rozlozDatum(datum: string): { rok: number; mesic: number; den: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) throw new Error(`Neplatné datum: ${datum}`);
  return { rok: Number(m[1]), mesic: Number(m[2]), den: Number(m[3]) };
}

export function rozlozCas(cas: string): { hodina: number; minuta: number } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(cas);
  if (!m) throw new Error(`Neplatný čas: ${cas}`);
  const hodina = Number(m[1]);
  const minuta = Number(m[2]);
  if (hodina > 23 || minuta > 59) throw new Error(`Neplatný čas: ${cas}`);
  return { hodina, minuta };
}

export function slozDatum(rok: number, mesic: number, den: number): string {
  return `${rok}-${dvojmistne(mesic)}-${dvojmistne(den)}`;
}

/**
 * Místní datum + čas v pásmu → okamžik.
 * Neexistující čas (jarní posun, např. 29. 3. 2026 2:30 v Praze) se posune
 * dopředu o mezeru (→ 3:30 letního času). Dvojznačný čas (podzimní posun,
 * 25. 10. 2026 2:30) se vezme v prvním výskytu (ještě letní čas).
 */
export function mistniNaUtc(datum: string, cas: string, timezone: string = APP_TZ): Date {
  const { rok, mesic, den } = rozlozDatum(datum);
  const { hodina, minuta } = rozlozCas(cas);
  const t = new TZDate(rok, mesic - 1, den, hodina, minuta, 0, 0, timezone);
  return new Date(t.getTime());
}

/** Okamžik → místní datum a čas v pásmu. */
export function utcNaMistni(okamzik: Date | string, timezone: string = APP_TZ): MistniCas {
  const d = typeof okamzik === "string" ? new Date(okamzik) : okamzik;
  const t = new TZDate(d.getTime(), timezone);
  const rok = t.getFullYear();
  const mesic = t.getMonth() + 1;
  const den = t.getDate();
  const hodina = t.getHours();
  const minuta = t.getMinutes();
  const jsDen = t.getDay();
  return {
    datum: slozDatum(rok, mesic, den),
    cas: `${dvojmistne(hodina)}:${dvojmistne(minuta)}`,
    rok,
    mesic,
    den,
    hodina,
    minuta,
    denVTydnu: jsDen === 0 ? 7 : jsDen,
  };
}

/** Formátování okamžiku v pásmu (vzory date-fns, česká lokalizace). */
export function formatVPasmu(okamzik: Date | string, vzor: string, timezone: string = APP_TZ): string {
  const d = typeof okamzik === "string" ? new Date(okamzik) : okamzik;
  return format(d, vzor, { in: tzIn(timezone), locale: cs });
}

/** Čitelný český zápis „po 12. 10. 2026 9:30“. */
export function hezkyCas(okamzik: Date | string | null, timezone: string = APP_TZ): string {
  if (!okamzik) return "bez času";
  return formatVPasmu(okamzik, "EEEEEE d. M. yyyy H:mm", timezone);
}

// ---------- aritmetika kalendářních dnů (bez pásma) ----------

function datumNaUtcPulnoc(datum: string): number {
  const { rok, mesic, den } = rozlozDatum(datum);
  return Date.UTC(rok, mesic - 1, den);
}

function utcPulnocNaDatum(ms: number): string {
  const d = new Date(ms);
  return slozDatum(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function pridejDny(datum: string, dny: number): string {
  return utcPulnocNaDatum(datumNaUtcPulnoc(datum) + dny * 86_400_000);
}

/** ISO den v týdnu pro kalendářní datum (1 = pondělí). */
export function denVTydnu(datum: string): number {
  const d = new Date(datumNaUtcPulnoc(datum)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Pondělí týdne, do kterého datum patří. */
export function pondeli(datum: string): string {
  return pridejDny(datum, 1 - denVTydnu(datum));
}

export function pocetDnuVMesici(rok: number, mesic: number): number {
  return new Date(Date.UTC(rok, mesic, 0)).getUTCDate();
}

export function pridejMesice(datum: string, mesice: number): string {
  const { rok, mesic } = rozlozDatum(datum);
  const index = rok * 12 + (mesic - 1) + mesice;
  const novyRok = Math.floor(index / 12);
  const novyMesic = (index % 12) + 1;
  return slozDatum(novyRok, novyMesic, 1);
}

/** Rozdíl kalendářních dnů b − a. */
export function rozdilDnu(a: string, b: string): number {
  return Math.round((datumNaUtcPulnoc(b) - datumNaUtcPulnoc(a)) / 86_400_000);
}

/** Dnešní datum v pásmu. */
export function dnes(timezone: string = APP_TZ, ted: Date = new Date()): string {
  return utcNaMistni(ted, timezone).datum;
}

/**
 * Posun o celé dny se zachováním místního času (9:00 zůstane 9:00 i přes
 * přechod letní/zimní čas — pevných 24 h by ho posunulo o hodinu).
 */
export function posunOMistniDny(okamzik: Date | string, dny: number, timezone: string = APP_TZ): Date {
  const m = utcNaMistni(okamzik, timezone);
  return mistniNaUtc(pridejDny(m.datum, dny), m.cas, timezone);
}

/** "HH:MM:SS" nebo "HH:MM" → "HH:MM". */
export function zkratCas(cas: string): string {
  const { hodina, minuta } = rozlozCas(cas);
  return `${dvojmistne(hodina)}:${dvojmistne(minuta)}`;
}
