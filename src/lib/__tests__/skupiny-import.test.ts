import { describe, expect, it } from "vitest";
import { klicJmena, normalizujUrlSkupiny, rozeberImport, souhrnOpakovanychJmen, ulozImport, vyberKVlozeni } from "../skupiny/import";

// Reálná ukázka zkopírované stránky facebook.com/groups/joins (zkrácená).
const UKAZKA = [
  "Skupiny",
  "Nové upozornění v nastaveních",
  "Skupiny, ve kterých jste",
  "Všechny skupiny, ve kterých jste (163)",
  "Nabídka práce v Německu",
  "Naposledy jste tu byl(a) před 3 týdny",
  "Práce v Rakousku 🇦🇹 – stavba",
  "Naposledy jste tu byl(a)",
  "před 3 týdny",
  "",
  "   Řemeslníci ČR & SK 👷‍♂️  ",
  "Naposledy jste tu byl(a) před 2 dny",
  "Nabídka práce v Německu",
  "před 5 měsíci",
  "Zedníci – Bayern\thttps://www.facebook.com/groups/123",
  "Lešenáři\thttps://web.facebook.com/groups/lesenari.cz/?ref=share",
  "Zobrazit skupinu",
].join("\n");

describe("import skupin ze zkopírované stránky", () => {
  const r = rozeberImport(UKAZKA);
  it("vezme jen jména skupin, šum vynechá", () => {
    expect(r.polozky.map((p) => p.name)).toEqual([
      "Nabídka práce v Německu",
      "Práce v Rakousku 🇦🇹 – stavba",
      "Řemeslníci ČR & SK 👷‍♂️",
      "Nabídka práce v Německu",
      "Zedníci – Bayern",
      "Lešenáři",
    ]);
    expect(r.ignorovano).toBe(10); // prázdné řádky se nepočítají
  });
  it("řádek název<TAB>url dá odkaz (normalizovaný)", () => {
    expect(r.polozky[4].url).toBe("https://www.facebook.com/groups/123");
    expect(r.polozky[5].url).toBe("https://www.facebook.com/groups/lesenari.cz");
    expect(r.polozky[0].url).toBeNull();
  });
  it("duplicitní jméno je označené (obě)", () => {
    expect(r.polozky.filter((p) => p.duplicitniJmeno).map((p) => p.name)).toEqual([
      "Nabídka práce v Německu",
      "Nabídka práce v Německu",
    ]);
    expect(r.polozky[1].duplicitniJmeno).toBe(false);
  });
  it("URL na samostatném řádku patří ke jménu nad ní", () => {
    const x = rozeberImport("Tesaři CZ\nhttps://www.facebook.com/groups/999/\nDalší skupina");
    expect(x.polozky).toEqual([
      { name: "Tesaři CZ", url: "https://www.facebook.com/groups/999", duplicitniJmeno: false },
      { name: "Další skupina", url: null, duplicitniJmeno: false },
    ]);
  });
  it("cizí odkazy nejsou skupiny", () => {
    expect(normalizujUrlSkupiny("https://evil.example/groups/1")).toBeNull();
    expect(normalizujUrlSkupiny("javascript:alert(1)")).toBeNull();
    expect(rozeberImport("https://www.seznam.cz").polozky).toEqual([]);
  });
});

describe("co vložit — stejná jména bez odkazu jsou různé skupiny", () => {
  // Reálný tvar stránky: jméno / Naposledy jste tu byl(a) / před …
  const blok = (jmeno: string, kdy: string) => `${jmeno}\nNaposledy jste tu byl(a)\n${kdy}`;
  const STRANKA = [
    "Všechny skupiny, ve kterých jste (163)",
    ...Array.from({ length: 6 }, (_, i) => blok("Práce v Německu", `před ${i + 1} týdny`)),
    ...Array.from({ length: 5 }, (_, i) => blok("Práca v Nemecku", `před ${i + 2} dny`)),
    blok("Před stavbou – práce", "před týdnem"),
    blok("Zedníci Bayern", "před několika sekundami"),
  ].join("\n");
  const r = rozeberImport(STRANKA);

  it("v importu zůstanou všechny výskyty", () => {
    expect(r.polozky.filter((p) => p.name === "Práce v Německu")).toHaveLength(6);
    expect(r.polozky.filter((p) => p.name === "Práca v Nemecku")).toHaveLength(5);
    expect(r.polozky).toHaveLength(13);
    expect(vyberKVlozeni(r.polozky, []).vlozit).toHaveLength(13);
  });
  it("náhled: „6× Práce v Německu — uloží se jako 6 samostatných skupin“", () => {
    const t = souhrnOpakovanychJmen(r.polozky, vyberKVlozeni(r.polozky, []).vlozit);
    expect(t).toEqual([
      "6× Práce v Německu — uloží se jako 6 samostatných skupin",
      "5× Práca v Nemecku — uloží se jako 5 samostatných skupin",
    ]);
  });
  it("proti DB se odečte tolik, kolik stejných jmen (i s odkazem) už v DB je", () => {
    const db = [
      { name: "Práce v Německu", url: null },
      { name: "práce v  německu", url: "https://www.facebook.com/groups/77" },
    ];
    const v = vyberKVlozeni(r.polozky, db);
    expect(v.vlozit.filter((p) => p.name === "Práce v Německu")).toHaveLength(4);
    expect(v.preskocit.map((x) => x.duvod)).toEqual(["uz-existuje-jmeno", "uz-existuje-jmeno"]);
    expect(souhrnOpakovanychJmen(r.polozky, v.vlozit)[0]).toBe("6× Práce v Německu — 2 už je uloženo, nově se uloží 4");
  });
  it("stejný import podruhé = 0 nových", () => {
    const prvni = vyberKVlozeni(r.polozky, []).vlozit;
    expect(vyberKVlozeni(r.polozky, prvni).vlozit).toEqual([]);
  });
  it("stejný odkaz se znovu nevloží (ani v importu podruhé)", () => {
    const x = rozeberImport("A\thttps://www.facebook.com/groups/1\nB\thttps://www.facebook.com/groups/1\nC\thttps://www.facebook.com/groups/2");
    const v = vyberKVlozeni(x.polozky, [{ name: "Jiné", url: "https://www.facebook.com/groups/2" }]);
    expect(v.vlozit.map((p) => p.name)).toEqual(["A"]);
    expect(v.preskocit.map((p) => p.duvod)).toEqual(["duplicita-v-importu", "uz-existuje-url"]);
  });
  it("klíč jména ignoruje velikost a mezery", () => {
    expect(klicJmena("  Nabídka   PRÁCE ")).toBe(klicJmena("nabídka práce"));
  });
});

describe("šum „před …“", () => {
  it("skupina začínající „Před “ zůstane, časové údaje ne", () => {
    const x = rozeberImport(
      ["Před stavbou – práce", "před 3 týdny", "před týdnem", "před několika sekundami", "před 4 min", "před 2 lety", "Před Vánoci brigády"].join("\n"),
    );
    expect(x.polozky.map((p) => p.name)).toEqual(["Před stavbou – práce", "Před Vánoci brigády"]);
  });
  it("hned po „Naposledy jste tu byl(a)“ je šum jakýkoli řádek „před …“", () => {
    const x = rozeberImport("Skupina A\nNaposledy jste tu byl(a)\npřed dlouhou dobou\nPřed dlouhou dobou – skupina");
    expect(x.polozky.map((p) => p.name)).toEqual(["Skupina A", "Před dlouhou dobou – skupina"]);
  });
});

describe("uložení importu po dávkách", () => {
  type Radek = { name: string; url: string | null };
  function falesnaDb(selzeNaDavce?: number) {
    const db: Radek[] = [];
    let davek = 0;
    return {
      db,
      op: {
        nactiExistujici: async () => [...db],
        vlozDavku: async (d: Radek[]) => {
          davek++;
          if (davek === selzeNaDavce) throw new Error("síť spadla");
          db.push(...d.map((p) => ({ name: p.name, url: p.url })));
          return d.length;
        },
      },
    };
  }
  const polozky = Array.from({ length: 250 }, (_, i) => ({ name: `Skupina ${i % 120}`, url: null, duplicitniJmeno: false }));

  it("chyba ve 2. dávce → vrátí stav DB; další Uložit vloží jen zbytek, nic dvakrát", async () => {
    const { db, op } = falesnaDb(2);
    const prvni = await ulozImport(polozky, op, 100);
    expect(prvni.vlozeno).toBe(100);
    expect(prvni.chyba).toBeInstanceOf(Error);
    expect(prvni.existujici).toHaveLength(100);
    expect(vyberKVlozeni(polozky, prvni.existujici).vlozit).toHaveLength(150);
    const druhe = await ulozImport(polozky, op, 100);
    expect(druhe.chyba).toBeNull();
    expect(druhe.vlozeno).toBe(150);
    expect(db).toHaveLength(250);
    expect((await ulozImport(polozky, op, 100)).vlozeno).toBe(0);
  });
  it("výběr se počítá z čerstvé DB, ne ze zastaralého seznamu ve stránce", async () => {
    const { op, db } = falesnaDb();
    db.push(...polozky.slice(0, 40).map((p) => ({ name: p.name, url: p.url })));
    expect((await ulozImport(polozky, op, 100)).vlozeno).toBe(210);
  });
});
