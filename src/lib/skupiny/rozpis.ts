// Rozpis dávek a variant — MUSÍ sedět s create_group_campaign v DB (SPEC-SKUPINY.md):
//   neaktivní skupiny se přeskočí, zbylé se očíslují v pořadí pole od 0,
//   batch_no = floor(pořadí / batch_size) + 1,
//   due_at = starts_at + (batch_no − 1) × interval (pevné minuty, ne místní čas),
//   variant_index = pořadí % počet variant.
// Ověřeno proti 0008_skupiny.sql: variant_index = (ord − 1) % cardinality, batch = (ord − 1) / size + 1.

export type UkolRozpisu = { groupId: string; variantIndex: number; poradi: number };
export type DavkaRozpisu = { batchNo: number; dueAt: Date; ukoly: UkolRozpisu[] };

export function rozpisDavek(
  skupiny: { id: string; is_active: boolean }[],
  pocetVariant: number,
  startsAt: Date,
  batchSize: number,
  intervalMinut: number,
): DavkaRozpisu[] {
  if (pocetVariant < 1 || pocetVariant > 3) throw new Error("Rozesílka potřebuje 1–3 varianty textu.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Velikost dávky musí být 1–100.");
  if (!Number.isInteger(intervalMinut) || intervalMinut < 15 || intervalMinut > 1440) {
    throw new Error("Odstup dávek musí být 15–1440 minut.");
  }
  // Jako DB: stejná skupina v poli víckrát → platí první výskyt; neaktivní se přeskočí.
  const videne = new Set<string>();
  const aktivni = skupiny.filter((s) => {
    if (!s.is_active || videne.has(s.id)) return false;
    videne.add(s.id);
    return true;
  });
  const davky: DavkaRozpisu[] = [];
  aktivni.forEach((s, poradi) => {
    const batchNo = Math.floor(poradi / batchSize) + 1;
    let d = davky[batchNo - 1];
    if (!d) {
      d = { batchNo, dueAt: new Date(startsAt.getTime() + (batchNo - 1) * intervalMinut * 60_000), ukoly: [] };
      davky.push(d);
    }
    d.ukoly.push({ groupId: s.id, variantIndex: poradi % pocetVariant, poradi });
  });
  return davky;
}

/** Pořadí skupin pro rozesílku: nejdřív ty, kam se nejdéle (nebo vůbec) neposílalo. */
export function seradProRozesilku<T extends { name: string; last_sent_at: string | null }>(skupiny: T[]): T[] {
  return [...skupiny].sort((a, b) => {
    if (a.last_sent_at === b.last_sent_at) return a.name.localeCompare(b.name, "cs");
    if (a.last_sent_at === null) return -1;
    if (b.last_sent_at === null) return 1;
    return a.last_sent_at.localeCompare(b.last_sent_at);
  });
}

/** Kontrola formuláře nové rozesílky (DB kontroluje totéž, tady jde o srozumitelné hlášky). */
export function zkontrolujRozesilku(f: {
  title: string;
  variants: string[];
  groupIds: string[];
  batchSize: number;
  intervalMinut: number;
  startsAt: Date | null;
  ted: Date;
}): string[] {
  const chyby: string[] = [];
  if (!f.title.trim()) chyby.push("Vyplňte název rozesílky.");
  if (f.variants.length < 1 || f.variants.length > 3) chyby.push("Rozesílka potřebuje 1–3 varianty textu.");
  if (f.variants.some((v) => !v.trim())) chyby.push("Žádná varianta textu nesmí být prázdná.");
  if (f.groupIds.length === 0) chyby.push("Vyberte aspoň jednu aktivní skupinu.");
  if (!Number.isInteger(f.batchSize) || f.batchSize < 1 || f.batchSize > 100) chyby.push("Velikost dávky musí být 1–100.");
  if (!Number.isInteger(f.intervalMinut) || f.intervalMinut < 15 || f.intervalMinut > 1440) {
    chyby.push("Odstup dávek musí být 15–1440 minut.");
  }
  if (!f.startsAt) chyby.push("Vyplňte začátek.");
  else if (f.startsAt.getTime() < f.ted.getTime() - 5 * 60_000) chyby.push("Začátek je v minulosti.");
  return chyby;
}
