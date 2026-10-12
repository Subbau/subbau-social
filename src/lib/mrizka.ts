// Mřížka kalendáře (týden / měsíc) a zařazení příspěvků do buněk.
// Vše počítá s kalendářními daty "YYYY-MM-DD" v pásmu kalendáře.

import {
  APP_TZ,
  denVTydnu,
  mistniNaUtc,
  pocetDnuVMesici,
  pondeli,
  pridejDny,
  rozlozDatum,
  slozDatum,
  utcNaMistni,
  zkratCas,
} from "./cas";

export const PRVNI_HODINA = 6;
export const POSLEDNI_HODINA = 23;
export const HODINY: number[] = Array.from(
  { length: POSLEDNI_HODINA - PRVNI_HODINA + 1 },
  (_, i) => PRVNI_HODINA + i,
);

export type DenMrizky = { datum: string; den: number; denVTydnu: number; vMesici: boolean };

/** 7 dní od pondělí týdne, do kterého patří `datum`. */
export function dnyTydne(datum: string): DenMrizky[] {
  const po = pondeli(datum);
  const { mesic } = rozlozDatum(datum);
  return Array.from({ length: 7 }, (_, i) => {
    const d = pridejDny(po, i);
    const r = rozlozDatum(d);
    return { datum: d, den: r.den, denVTydnu: i + 1, vMesici: r.mesic === mesic };
  });
}

/** Týdny (řádky po 7 dnech od pondělí) pokrývající celý měsíc. */
export function tydnyMesice(rok: number, mesic: number): DenMrizky[][] {
  const prvni = slozDatum(rok, mesic, 1);
  const posledni = slozDatum(rok, mesic, pocetDnuVMesici(rok, mesic));
  const tydny: DenMrizky[][] = [];
  let po = pondeli(prvni);
  while (po <= posledni) {
    tydny.push(
      Array.from({ length: 7 }, (_, i) => {
        const d = pridejDny(po, i);
        const r = rozlozDatum(d);
        return { datum: d, den: r.den, denVTydnu: i + 1, vMesici: r.mesic === mesic };
      }),
    );
    po = pridejDny(po, 7);
  }
  return tydny;
}

/** Okamžiky [od, do) pro dotaz do DB — půlnoci v pásmu, ne UTC. */
export function rozsahTydne(datum: string, timezone: string = APP_TZ): { od: Date; do: Date } {
  const po = pondeli(datum);
  return { od: mistniNaUtc(po, "00:00", timezone), do: mistniNaUtc(pridejDny(po, 7), "00:00", timezone) };
}

export function rozsahMesice(rok: number, mesic: number, timezone: string = APP_TZ): { od: Date; do: Date } {
  const tydny = tydnyMesice(rok, mesic);
  const prvni = tydny[0][0].datum;
  const za = pridejDny(tydny[tydny.length - 1][6].datum, 1);
  return { od: mistniNaUtc(prvni, "00:00", timezone), do: mistniNaUtc(za, "00:00", timezone) };
}

/**
 * Do které buňky týdne příspěvek patří. Příspěvky před 6:00 jdou do řádku 6
 * (kartička ukazuje přesný čas), mřížka se tak nemusí natahovat přes noc.
 */
export function bunkaTydne(okamzik: string, timezone: string = APP_TZ): { datum: string; hodina: number } {
  const m = utcNaMistni(okamzik, timezone);
  return { datum: m.datum, hodina: Math.max(m.hodina, PRVNI_HODINA) };
}

export function klicBunky(datum: string, hodina?: number): string {
  return hodina == null ? datum : `${datum}|${hodina}`;
}

/** Seskupí položky podle klíče buňky. */
export function seskup<T>(polozky: T[], klic: (p: T) => string | null): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const p of polozky) {
    const k = klic(p);
    if (k == null) continue;
    const seznam = mapa.get(k);
    if (seznam) seznam.push(p);
    else mapa.set(k, [p]);
  }
  return mapa;
}

/**
 * Nový čas po přetažení.
 * - Týden (cílová hodina zadaná): den + hodina z buňky, minuty z původního času.
 * - Měsíc (bez hodiny): den z buňky, hodina i minuty z původního času.
 * Příspěvek bez času dostane minuty 00 (týden) nebo 9:00 (měsíc).
 */
export function casPoPretazeni(
  puvodni: string | null,
  cilDatum: string,
  cilHodina: number | null,
  timezone: string = APP_TZ,
): Date {
  const m = puvodni ? utcNaMistni(puvodni, timezone) : null;
  if (cilHodina != null) {
    const minuta = m ? m.minuta : 0;
    return mistniNaUtc(cilDatum, `${cilHodina}:${String(minuta).padStart(2, "0")}`, timezone);
  }
  return mistniNaUtc(cilDatum, m ? m.cas : "09:00", timezone);
}

/** Výchozí čas nového příspěvku po kliknutí do prázdné buňky. */
export function casNovehoPrispevku(datum: string, hodina: number | null, timezone: string = APP_TZ): Date {
  return mistniNaUtc(datum, hodina == null ? "09:00" : `${hodina}:00`, timezone);
}

/** Název dne v týdnu (1 = pondělí). */
export const NAZVY_DNU = ["po", "út", "st", "čt", "pá", "so", "ne"];
export const NAZVY_DNU_DLOUHE = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"];
export const NAZVY_MESICU = [
  "leden", "únor", "březen", "duben", "květen", "červen",
  "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];

export function nazevDne(datum: string): string {
  return NAZVY_DNU[denVTydnu(datum) - 1];
}

/** Výchozí časy účtu pro daný den: sloty seřazené "HH:MM". */
export function slotyProDen(
  sloty: { weekday: number; time_of_day: string }[],
  datum: string,
): string[] {
  const den = denVTydnu(datum);
  return sloty
    .filter((s) => s.weekday === den)
    .map((s) => zkratCas(s.time_of_day))
    .sort();
}
