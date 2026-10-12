// Import skupin ze zkopírované stránky facebook.com/groups/joins (nebo řádků „název<TAB>url“).
// Čistá logika — žádná DB.

export type ImportovanaSkupina = {
  name: string;
  url: string | null;
  /** stejné jméno je v importu víckrát (FB má víc skupin stejného jména) */
  duplicitniJmeno: boolean;
};

export type VysledekImportu = { polozky: ImportovanaSkupina[]; ignorovano: number };

/** Řádky, které na stránce skupin nejsou jména skupin. */
const SUM: RegExp[] = [
  /^naposledy jste tu byl/i, // „Naposledy jste tu byl(a)“ i „… před 3 týdny“
  /^naposledy aktivní/i,
  /^všechny skupiny, ve kterých jste/i, // „Všechny skupiny, ve kterých jste (163)“
  /^skupiny$/i,
  /^skupiny, ve kterých jste$/i,
  /^nové upozornění v nastaveních$/i,
  /^zobrazit skupinu$/i,
  /^zobrazit (víc|více|další)$/i,
  /^vaše skupiny$/i,
  /^váš kanál$/i,
  /^objevit$/i,
  /^vytvořit novou skupinu$/i,
  /^\+ ?vytvořit novou skupinu$/i,
  /^hledat ve skupinách$/i,
  /^spravovat$/i,
  /^seřadit$/i,
  /^další$/i,
  /^·$/,
];

/**
 * „před …“ je šum jen v přesném tvaru údaje o čase („před 3 týdny“, „před týdnem“,
 * „před několika sekundami“, „před 4 min“) — skupina „Před stavbou – práce“ zůstane.
 * Hned po řádku „Naposledy jste tu byl(a)“ je šum jakýkoli řádek „před …“.
 */
const CAS_PRED =
  /^před\s+(\d+\s+(sekund(ou|ami)?|s|minut(ou|ami)?|min\.?|hodin(ou|ami)?|h|dn(em|y|ech|ů)|týdn(em|y|ech|ů)|měsíc(em|i|ích|ů)|rok(em|y)?|let(y)?)|sekundou|minutou|hodinou|dnem|týdnem|měsícem|rokem|několika\s+(sekundami|minutami|hodinami|dny|týdny|měsíci|lety))$/i;
const NAPOSLEDY = /^naposledy jste tu byl\(a\)$/i;

const FB_SKUPINA = /^https?:\/\/(www\.|m\.|web\.)?facebook\.com\/groups\/[^\s]+$/i;

/** Normalizace URL skupiny: https://www.facebook.com/groups/<id>, bez parametrů a koncového lomítka. */
export function normalizujUrlSkupiny(url: string): string | null {
  const u = url.trim();
  if (!FB_SKUPINA.test(u)) return null;
  try {
    const p = new URL(u);
    const cast = p.pathname.split("/").filter(Boolean); // ["groups", "<id>", ...]
    if (cast[0] !== "groups" || !cast[1]) return null;
    return `https://www.facebook.com/groups/${cast[1]}`;
  } catch {
    return null;
  }
}

/** Klíč pro porovnání jmen: bez okrajových mezer, sjednocené mezery, malá písmena. */
export function klicJmena(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("cs-CZ");
}

function jeSum(radek: string): boolean {
  return SUM.some((r) => r.test(radek));
}

export function rozeberImport(text: string): VysledekImportu {
  const polozky: { name: string; url: string | null }[] = [];
  let ignorovano = 0;
  let predchozi = "";
  for (const surovy of text.split(/\r?\n/)) {
    const radek = surovy.trim();
    if (!radek) continue;
    const poNaposledy = NAPOSLEDY.test(predchozi);
    predchozi = radek;
    if (CAS_PRED.test(radek) || (poNaposledy && /^před\s/i.test(radek))) {
      ignorovano++;
      continue;
    }
    if (radek.includes("\t")) {
      const [jmeno, ...zbytek] = radek.split("\t");
      const name = jmeno.trim();
      const url = normalizujUrlSkupiny(zbytek.join("\t"));
      if (name && !jeSum(name)) polozky.push({ name, url });
      else ignorovano++;
      continue;
    }
    const samaUrl = normalizujUrlSkupiny(radek);
    if (samaUrl) {
      // URL na vlastním řádku patří ke jménu nad ní (když ještě žádnou nemá)
      const posledni = polozky[polozky.length - 1];
      if (posledni && !posledni.url) posledni.url = samaUrl;
      else ignorovano++;
      continue;
    }
    if (/^https?:\/\//i.test(radek) || jeSum(radek)) {
      ignorovano++;
      continue;
    }
    polozky.push({ name: radek.replace(/\s+/g, " "), url: null });
  }
  const pocty = new Map<string, number>();
  for (const p of polozky) pocty.set(klicJmena(p.name), (pocty.get(klicJmena(p.name)) ?? 0) + 1);
  return {
    polozky: polozky.map((p) => ({ ...p, duplicitniJmeno: (pocty.get(klicJmena(p.name)) ?? 0) > 1 })),
    ignorovano,
  };
}

export type DuvodPreskoceni = "uz-existuje-url" | "uz-existuje-jmeno" | "duplicita-v-importu";

/**
 * Co z importu opravdu vložit.
 * - S odkazem: přeskočit, když ten odkaz už v DB je (nebo je v importu podruhé).
 * - Bez odkazu: FB má víc RŮZNÝCH skupin stejného jména (6× „Práce v Německu“), takže
 *   v rámci importu se zachovají VŠECHNY výskyty. Proti DB se u každého jména odečte
 *   tolik výskytů, kolik řádků se stejným jménem (i s odkazem) už v DB je.
 *   Stejný import podruhé = 0 nových; po importu přerušeném v půlce se doplní jen zbytek.
 */
export function vyberKVlozeni(
  polozky: ImportovanaSkupina[],
  existujici: { name: string; url: string | null }[],
): { vlozit: ImportovanaSkupina[]; preskocit: { polozka: ImportovanaSkupina; duvod: DuvodPreskoceni }[] } {
  const url = new Set(existujici.map((e) => e.url).filter((u): u is string => Boolean(u)));
  const vDb = new Map<string, number>();
  for (const e of existujici) vDb.set(klicJmena(e.name), (vDb.get(klicJmena(e.name)) ?? 0) + 1);
  const vlozit: ImportovanaSkupina[] = [];
  const preskocit: { polozka: ImportovanaSkupina; duvod: DuvodPreskoceni }[] = [];
  const vImportuUrl = new Set<string>();
  const odecteno = new Map<string, number>();
  for (const p of polozky) {
    if (p.url) {
      if (url.has(p.url)) preskocit.push({ polozka: p, duvod: "uz-existuje-url" });
      else if (vImportuUrl.has(p.url)) preskocit.push({ polozka: p, duvod: "duplicita-v-importu" });
      else {
        vImportuUrl.add(p.url);
        vlozit.push(p);
      }
      continue;
    }
    const k = klicJmena(p.name);
    const uz = odecteno.get(k) ?? 0;
    if (uz < (vDb.get(k) ?? 0)) {
      odecteno.set(k, uz + 1);
      preskocit.push({ polozka: p, duvod: "uz-existuje-jmeno" });
    } else {
      vlozit.push(p);
    }
  }
  return { vlozit, preskocit };
}

/** Souhrn opakovaných jmen pro náhled: „6× Práce v Německu — uloží se jako 6 samostatných skupin“. */
export function souhrnOpakovanychJmen(
  polozky: ImportovanaSkupina[],
  vlozit: ImportovanaSkupina[],
): string[] {
  const vse = new Map<string, { name: string; pocet: number; noveho: number }>();
  for (const p of polozky) {
    const k = klicJmena(p.name);
    const z = vse.get(k) ?? { name: p.name, pocet: 0, noveho: 0 };
    z.pocet++;
    vse.set(k, z);
  }
  for (const p of vlozit) {
    const z = vse.get(klicJmena(p.name));
    if (z) z.noveho++;
  }
  return [...vse.values()]
    .filter((z) => z.pocet > 1)
    .map((z) =>
      z.noveho === z.pocet
        ? `${z.pocet}× ${z.name} — uloží se jako ${z.pocet} samostatných skupin`
        : `${z.pocet}× ${z.name} — ${z.pocet - z.noveho} už je uloženo, nově se uloží ${z.noveho}`,
    );
}

export type OperaceImportu<T extends { name: string; url: string | null }> = {
  nactiExistujici: () => Promise<T[]>;
  vlozDavku: (davka: ImportovanaSkupina[]) => Promise<number>;
};

/**
 * Uložení importu po dávkách. Výběr se vždy počítá z ČERSTVĚ načtené DB, takže opakované
 * „Uložit“ (i po chybě v půlce) nikdy nevloží nic dvakrát. Po chybě vrací znovu načtený
 * stav DB, aby náhled ukázal, co zbývá.
 */
export async function ulozImport<T extends { name: string; url: string | null }>(
  polozky: ImportovanaSkupina[],
  op: OperaceImportu<T>,
  velikostDavky = 100,
): Promise<{ vlozeno: number; chyba: unknown | null; existujici: T[] }> {
  let existujici = await op.nactiExistujici();
  const { vlozit } = vyberKVlozeni(polozky, existujici);
  let vlozeno = 0;
  try {
    for (let i = 0; i < vlozit.length; i += velikostDavky) {
      vlozeno += await op.vlozDavku(vlozit.slice(i, i + velikostDavky));
    }
  } catch (e) {
    existujici = await op.nactiExistujici().catch(() => existujici);
    return { vlozeno, chyba: e, existujici };
  }
  return { vlozeno, chyba: null, existujici: await op.nactiExistujici().catch(() => existujici) };
}
