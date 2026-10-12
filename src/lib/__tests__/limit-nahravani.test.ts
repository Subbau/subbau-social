import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../db-types";
import {
  LIMIT_NAHRAVANI_B,
  chybaVelikosti,
  limitNahravaniMb,
  rozdelPodleLimitu,
} from "../limit-nahravani";
import { nahrajDoKnihovny, type PripravenySoubor, type ZavislostiNahrani } from "../nahravani";

const MB = 1024 * 1024;
const LIMIT = 52428800; // 50 MB podle zadání (Free plán)

/** Soubor dané velikosti bez skutečných dat (velikost je jen číslo). */
const soubor = (name: string, type: string, size: number) => ({ name, type, size });

describe("limit nahrávání", () => {
  it("výchozí 50 MB = 52 428 800 B", () => {
    expect(LIMIT_NAHRAVANI_B).toBe(LIMIT);
    expect(limitNahravaniMb(undefined)).toBe(50);
  });
  it("přepsatelné přes NEXT_PUBLIC_MAX_UPLOAD_MB, nesmysl = 50", () => {
    expect(limitNahravaniMb("500")).toBe(500);
    expect(limitNahravaniMb("")).toBe(50);
    expect(limitNahravaniMb("abc")).toBe(50);
    expect(limitNahravaniMb("-5")).toBe(50);
  });
  it("hláška přesně podle zadání, hranice včetně", () => {
    expect(chybaVelikosti(LIMIT, LIMIT)).toBeNull();
    expect(chybaVelikosti(LIMIT + 1, LIMIT)).not.toBeNull();
    expect(chybaVelikosti(Math.round(63.4 * MB), LIMIT)).toBe(
      "Soubor má 63,4 MB, limit je 50 MB. Zkraťte nebo zmenšete video (např. v telefonu při sdílení zvolte nižší kvalitu).",
    );
  });
  it("při výběru: video nad limit pryč, ostatní z dávky jdou, obrázky se nekontrolují (až po převodu)", () => {
    const { kNahrani, odmitnute } = rozdelPodleLimitu(
      [
        soubor("velke.mp4", "video/mp4", 80 * MB),
        soubor("male.mp4", "video/mp4", 10 * MB),
        soubor("velka.png", "image/png", 70 * MB),
        soubor("foto.heic", "", 60 * MB),
      ],
      LIMIT,
    );
    expect(kNahrani.map((s) => s.name)).toEqual(["male.mp4", "velka.png", "foto.heic"]);
    expect(odmitnute.map((o) => o.soubor.name)).toEqual(["velke.mp4"]);
    expect(odmitnute[0].hlaska).toMatch(/^Soubor má 80 MB, limit je 50 MB\./);
  });
});

describe("nahrání: obrázek se kontroluje až po převodu na JPEG", () => {
  function zavislosti(velikostPoPrevodu: number): { z: ZavislostiNahrani; nahrano: string[] } {
    const nahrano: string[] = [];
    const p: PripravenySoubor = {
      blob: { size: velikostPoPrevodu } as Blob,
      mime: "image/jpeg",
      pripona: "jpg",
      kind: "image",
      width: 4000,
      height: 3000,
      duration: null,
      nahled: null,
    };
    const z: ZavislostiNahrani = {
      priprav: vi.fn(async () => p),
      otisk: async () => "otisk",
      najdiStejny: async () => null,
      nahrajObjekt: async (cesta) => {
        nahrano.push(cesta);
      },
      vlozRadek: async (r) => ({ id: "a1", ...r }) as unknown as MediaAsset,
      odstran: async () => undefined,
      limitB: LIMIT,
    };
    return { z, nahrano };
  }
  const png = { name: "plakat.png", type: "image/png", size: 70 * MB } as File;

  it("PNG 70 MB, po převodu 8 MB → nahraje se", async () => {
    const { z, nahrano } = zavislosti(8 * MB);
    const v = await nahrajDoKnihovny(png, null, [], () => undefined, z);
    expect(v.uzExistoval).toBe(false);
    expect(nahrano).toHaveLength(1);
  });
  it("po převodu pořád nad limit → odmítne se před nahráním", async () => {
    const { z, nahrano } = zavislosti(55 * MB);
    await expect(nahrajDoKnihovny(png, null, [], () => undefined, z)).rejects.toThrow(/^Soubor má 55 MB, limit je 50 MB/);
    expect(nahrano).toEqual([]);
  });
  it("video nad limit se odmítne ještě před přípravou", async () => {
    const { z } = zavislosti(10 * MB);
    const video = { name: "film.mov", type: "video/quicktime", size: 120 * MB } as File;
    await expect(nahrajDoKnihovny(video, null, [], () => undefined, z)).rejects.toThrow(/limit je 50 MB/);
    expect(z.priprav).not.toHaveBeenCalled();
  });
});
