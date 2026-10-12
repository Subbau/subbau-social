import { describe, expect, it } from "vitest";
import {
  HLASKA_KONCEPT_BEZ_MEDII,
  HLASKA_NENAPLANOVANO_BEZ_MEDII,
  HLASKA_ZUSTAL_KONCEPT,
  UlozeniNedokonceno,
  naplanujUlozeni,
  provedPoVlozeni,
  provedUlozeni,
  vysledekZChyby,
  type ObsahPrispevku,
  type OperaceUlozeni,
  type StavVDb,
} from "../ukladani";
import type { PostStatus } from "../db-types";

const obsah: ObsahPrispevku = {
  account_id: "acc",
  group_id: null,
  format: "feed",
  caption: "Text",
  link_url: null,
  scheduled_at: "2026-10-20T07:00:00.000Z",
  platform_options: { a: 1, b: 2 },
  content_hash: "h1",
};

const vDb = (x: Partial<StavVDb> = {}): StavVDb => ({
  status: "scheduled",
  // DB vrací čas s +00:00 a klíče v jiném pořadí — pořád je to totéž
  obsah: { ...obsah, scheduled_at: "2026-10-20T07:00:00+00:00", platform_options: { b: 2, a: 1 } },
  assetIds: ["m1", "m2"],
  ...x,
});

type Volani = [string, ...unknown[]];
function falesneOperace(selzeNa?: "zmenObsah" | "nastavMedia" | "zmenStav2"): { op: OperaceUlozeni; volani: Volani[] } {
  const volani: Volani[] = [];
  let stavu = 0;
  const op: OperaceUlozeni = {
    zmenStav: async (id, z, na) => {
      stavu++;
      volani.push(["zmenStav", z, na]);
      if (selzeNa === "zmenStav2" && stavu === 2) throw new Error("síť spadla");
    },
    zmenObsah: async (id, z) => {
      volani.push(["zmenObsah", z]);
      if (selzeNa === "zmenObsah") throw new Error("síť spadla");
    },
    nastavMedia: async (id, ids) => {
      volani.push(["nastavMedia", ids]);
      if (selzeNa === "nastavMedia") throw new Error("síť spadla");
    },
  };
  return { op, volani };
}

describe("plán uložení — média jen když se liší (jinak DB smaže remote_state)", () => {
  it("beze změny a stejný stav = nic se nedělá", () => {
    const p = naplanujUlozeni(vDb(), { obsah, assetIds: ["m1", "m2"] }, "scheduled");
    expect(p).toEqual({ vychoziStav: "scheduled", doKonceptu: false, obsah: null, media: null, cilovyStav: null });
  });
  it("změna textu u naplánovaného: přes koncept, obsah ano, média NE", () => {
    const p = naplanujUlozeni(vDb(), { obsah: { ...obsah, caption: "Jiný" }, assetIds: ["m1", "m2"] }, "scheduled");
    expect(p.doKonceptu).toBe(true);
    expect(p.obsah?.caption).toBe("Jiný");
    expect(p.media).toBeNull();
    expect(p.cilovyStav).toBe("scheduled");
  });
  it("jiné pořadí médií = přepsat média", () => {
    const p = naplanujUlozeni(vDb(), { obsah, assetIds: ["m2", "m1"] }, "scheduled");
    expect(p.media).toEqual(["m2", "m1"]);
    expect(p.obsah).toBeNull();
  });
  it("chyba bez úprav → jen změna stavu", () => {
    const p = naplanujUlozeni(vDb({ status: "failed" }), { obsah, assetIds: ["m1", "m2"] }, "scheduled");
    expect(p).toEqual({ vychoziStav: "failed", doKonceptu: false, obsah: null, media: null, cilovyStav: "scheduled" });
  });
  it("provedení beze změny nevolá nastavMedia ani zmenObsah", async () => {
    const { op, volani } = falesneOperace();
    await provedUlozeni("p1", naplanujUlozeni(vDb({ status: "failed" }), { obsah, assetIds: ["m1", "m2"] }, "scheduled"), op);
    expect(volani).toEqual([["zmenStav", "failed", "scheduled"]]);
  });
  it("nový koncept bez médií nevolá nastavMedia", async () => {
    const { op, volani } = falesneOperace();
    await provedPoVlozeni("p1", [], "draft", op);
    expect(volani).toEqual([]);
  });
});

describe("nedokončené uložení naplánovaného → jasná hláška, je to koncept", () => {
  const zmenaTextu = () => naplanujUlozeni(vDb(), { obsah: { ...obsah, caption: "Jiný" }, assetIds: ["m3"] }, "scheduled");

  it.each(["zmenObsah", "nastavMedia", "zmenStav2"] as const)("selže %s", async (kde) => {
    const { op } = falesneOperace(kde);
    const chyba = await provedUlozeni("p1", zmenaTextu(), op).catch((e: unknown) => e);
    expect(chyba).toBeInstanceOf(UlozeniNedokonceno);
    expect((chyba as UlozeniNedokonceno).message).toContain(HLASKA_ZUSTAL_KONCEPT);
    expect((chyba as UlozeniNedokonceno).postId).toBe("p1");
    expect((chyba as UlozeniNedokonceno).stav).toBe("draft");
  });
  it("přesné znění hlášky", () => {
    expect(HLASKA_ZUSTAL_KONCEPT).toBe(
      "Příspěvek se nepodařilo uložit a je teď koncept — nevyjde, dokud ho znovu nenaplánujete.",
    );
  });
  it("nový příspěvek, který se měl naplánovat a selžou média → koncept bez médií, s id", async () => {
    const { op } = falesneOperace("nastavMedia");
    const chyba = await provedPoVlozeni("p9", ["m1"], "scheduled", op).catch((e: unknown) => e);
    expect(vysledekZChyby(chyba)).toEqual({ id: "p9", status: "draft" });
    expect((chyba as Error).message).toContain(HLASKA_NENAPLANOVANO_BEZ_MEDII);
  });
  it("existující koncept, který se měl naplánovat, a selže obsah → hláška, že je koncept", async () => {
    const { op } = falesneOperace("zmenObsah");
    const plan = naplanujUlozeni(vDb({ status: "draft" }), { obsah: { ...obsah, caption: "X" }, assetIds: ["m1", "m2"] }, "scheduled");
    expect(plan.doKonceptu).toBe(false);
    const chyba = await provedUlozeni("p3", plan, op).catch((e: unknown) => e);
    expect(vysledekZChyby(chyba)).toEqual({ id: "p3", status: "draft" });
    expect((chyba as Error).message).toContain(HLASKA_ZUSTAL_KONCEPT);
  });
  it("chyba u příspěvku ve stavu chyba zůstane obyčejnou chybou (není koncept)", async () => {
    const { op } = falesneOperace("zmenObsah");
    const plan = naplanujUlozeni(vDb({ status: "failed" as PostStatus }), { obsah: { ...obsah, caption: "X" }, assetIds: ["m1", "m2"] }, "scheduled");
    const chyba = await provedUlozeni("p1", plan, op).catch((e: unknown) => e);
    expect(chyba).not.toBeInstanceOf(UlozeniNedokonceno);
  });
});

describe("nově vložený řádek: id se vrací při JAKÉKOLI chybě po insertu", () => {
  it("koncept (i z „Opakovat“), selžou média → id + hláška o konceptu bez médií", async () => {
    const { op } = falesneOperace("nastavMedia");
    const chyba = await provedPoVlozeni("n1", ["m1", "m2"], "draft", op).catch((e: unknown) => e);
    expect(chyba).toBeInstanceOf(UlozeniNedokonceno);
    expect(vysledekZChyby(chyba)).toEqual({ id: "n1", status: "draft" });
    expect((chyba as Error).message).toContain(HLASKA_KONCEPT_BEZ_MEDII);
    expect((chyba as Error).message).not.toContain("nenaplánujete");
  });
  it("naplánování selže až na změně stavu → id + hláška, že je to koncept", async () => {
    const op: OperaceUlozeni = {
      zmenStav: async () => {
        throw new Error("síť");
      },
      zmenObsah: async () => undefined,
      nastavMedia: async () => undefined,
    };
    const chyba = await provedPoVlozeni("n2", ["m1"], "scheduled", op).catch((e: unknown) => e);
    expect(vysledekZChyby(chyba)).toEqual({ id: "n2", status: "draft" });
    expect((chyba as Error).message).toContain(HLASKA_ZUSTAL_KONCEPT);
  });
  it("vše projde → stav podle cíle, média i naplánování zavolané", async () => {
    const { op, volani } = falesneOperace();
    expect(await provedPoVlozeni("n3", ["m1"], "scheduled", op)).toBe("scheduled");
    expect(volani).toEqual([["nastavMedia", ["m1"]], ["zmenStav", "draft", "scheduled"]]);
  });
  it("obyčejná chyba (bez řádku v DB) → žádné id", () => {
    expect(vysledekZChyby({ message: "duplicate key", code: "23505" })).toBeNull();
    expect(vysledekZChyby(new Error("x"))).toBeNull();
  });
});
