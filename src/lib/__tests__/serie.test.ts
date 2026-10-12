import { describe, expect, it } from "vitest";
import { ukonciSerii } from "../data/serie";
import { falesnyKlient } from "./falesny-klient";
import {
  chybyPredOpakovanim,
  jeSablonouSerie,
  lzeNaplanovat,
  lzeZalozitOpakovani,
} from "../opakovani";

describe("Ukončit opakování", () => {
  it("vypne sérii a smaže VŠECHNY naplánované výskyty bez ohledu na čas", async () => {
    const { klient, volani } = falesnyKlient();
    expect(await ukonciSerii("s1", klient)).toBe(2);
    const serie = volani.find((v) => v.tabulka === "post_series");
    expect(serie?.kroky).toContainEqual(["update", [{ is_active: false }]]);
    const mazani = volani.find((v) => v.tabulka === "posts");
    expect(mazani?.kroky.map((k) => k[0])).toContain("delete");
    expect(mazani?.kroky).toContainEqual(["eq", ["series_id", "s1"]]);
    expect(mazani?.kroky).toContainEqual(["eq", ["status", "scheduled"]]);
    // žádné omezení časem — výskyt čekající na další pokus (minulý čas) se musí smazat taky
    expect(mazani?.kroky.filter((k) => ["gt", "gte", "lt", "lte"].includes(k[0]))).toEqual([]);
  });
});

describe("šablona série", () => {
  const serie = [{ template_post_id: "t1", is_active: true }];
  it("šablona nejde naplánovat, jiný příspěvek ano", () => {
    expect(jeSablonouSerie("t1", serie)).toBe(true);
    expect(lzeNaplanovat("t1", serie)).toBe(false);
    expect(lzeNaplanovat("t1", [{ template_post_id: "t1" }])).toBe(false);
    expect(lzeNaplanovat("p2", serie)).toBe(true);
    expect(lzeNaplanovat(null, serie)).toBe(true);
  });
  it("Opakovat: u šablony aktivní série ne, u ukončené ano", () => {
    const v = { id: "t1", status: "draft" as const, series_id: null };
    expect(lzeZalozitOpakovani(v, { template_post_id: "t1", is_active: true })).toBe(false);
    expect(lzeZalozitOpakovani(v, { template_post_id: "t1", is_active: false })).toBe(true);
    expect(lzeZalozitOpakovani(v, null)).toBe(true);
  });
  it("Opakovat: ne u výskytu ani u zveřejněného", () => {
    expect(lzeZalozitOpakovani({ id: "o1", status: "scheduled", series_id: "s1" }, null)).toBe(false);
    expect(lzeZalozitOpakovani({ id: "p1", status: "published", series_id: null }, null)).toBe(false);
  });
});

describe("kontroly před založením opakování", () => {
  it("IG příspěvek bez média neprojde", () => {
    const chyby = chybyPredOpakovanim({ platform: "instagram", format: "feed", caption: "x", link_url: null, media: [] });
    expect(chyby.join()).toMatch(/potřebuje obrázek/);
  });
  it("čas se nekontroluje (určuje ho série)", () => {
    const chyby = chybyPredOpakovanim({ platform: "facebook", format: "feed", caption: "x", link_url: null, media: [] });
    expect(chyby).toEqual([]);
  });
});
