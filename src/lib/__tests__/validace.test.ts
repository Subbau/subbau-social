import { describe, expect, it } from "vitest";
import {
  pocetHashtagu,
  pocetZnaku,
  zkontrolujVariantu,
  type MediumProKontrolu,
  type VariantaProKontrolu,
} from "../validace";

const TED = new Date("2026-10-12T10:00:00Z");
const ZITRA = new Date("2026-10-13T10:00:00Z");

const obr = (w: number, h: number, extra: Partial<MediumProKontrolu> = {}): MediumProKontrolu => ({
  kind: "image",
  mime_type: "image/jpeg",
  width: w,
  height: h,
  duration_seconds: null,
  size_bytes: 500_000,
  ...extra,
});
const video = (s: number | null): MediumProKontrolu => ({
  kind: "video",
  mime_type: "video/mp4",
  width: 1080,
  height: 1920,
  duration_seconds: s,
  size_bytes: 5_000_000,
});

const v = (x: Partial<VariantaProKontrolu>): VariantaProKontrolu => ({
  platform: "instagram",
  format: "feed",
  caption: "Ahoj",
  link_url: null,
  media: [obr(1080, 1080)],
  scheduledAt: ZITRA,
  ...x,
});

const kontrola = (x: Partial<VariantaProKontrolu>) => zkontrolujVariantu(v(x), "naplanovat", TED);

describe("počítadla", () => {
  it("emoji = 1 znak", () => {
    expect(pocetZnaku("a👍b")).toBe(3);
  });
  it("hashtagy včetně diakritiky", () => {
    expect(pocetHashtagu("#stavba #řemeslo text #2026 # nic")).toBe(3);
  });
});

describe("Instagram", () => {
  it("platný příspěvek projde bez výhrad", () => {
    expect(kontrola({})).toEqual({ blokujici: [], varovani: [] });
  });
  it("feed bez média blokuje", () => {
    expect(kontrola({ media: [] }).blokujici.join()).toMatch(/potřebuje obrázek/);
  });
  it("2200 znaků projde, 2201 blokuje", () => {
    expect(kontrola({ caption: "a".repeat(2200) }).blokujici).toEqual([]);
    expect(kontrola({ caption: "a".repeat(2201) }).blokujici.join()).toMatch(/moc dlouhý/);
  });
  it("30 hashtagů projde, 31 blokuje", () => {
    const tagy = (n: number) => Array.from({ length: n }, (_, i) => `#t${i}`).join(" ");
    expect(kontrola({ caption: tagy(30) }).blokujici).toEqual([]);
    expect(kontrola({ caption: tagy(31) }).blokujici.join()).toMatch(/30 hashtagů/);
  });
  it("poměr 4:5 a 1.91:1 jsou hranice, mimo = varování", () => {
    expect(kontrola({ media: [obr(1080, 1350)] }).varovani).toEqual([]);
    expect(kontrola({ media: [obr(1910, 1000)] }).varovani).toEqual([]);
    expect(kontrola({ media: [obr(1080, 1920)] }).varovani.join()).toMatch(/poměr/);
    expect(kontrola({ media: [obr(2000, 1000)] }).varovani.join()).toMatch(/poměr/);
    expect(kontrola({ media: [obr(1080, 1920)] }).blokujici).toEqual([]);
  });
  it("karusel 2–10", () => {
    const m = (n: number) => Array.from({ length: n }, () => obr(1080, 1080));
    expect(kontrola({ format: "carousel", media: m(1) }).blokujici.join()).toMatch(/Karusel/);
    expect(kontrola({ format: "carousel", media: m(2) }).blokujici).toEqual([]);
    expect(kontrola({ format: "carousel", media: m(10) }).blokujici).toEqual([]);
    expect(kontrola({ format: "carousel", media: m(11) }).blokujici.join()).toMatch(/Karusel/);
  });
  it("reel = jedno video", () => {
    expect(kontrola({ format: "reel", media: [video(20)] }).blokujici).toEqual([]);
    expect(kontrola({ format: "reel", media: [obr(1080, 1920)] }).blokujici.join()).toMatch(/Reel/);
    expect(kontrola({ format: "reel", media: [video(20), video(30)] }).blokujici.join()).toMatch(/Reel/);
  });
  it("médium s neznámým druhem (kind null) = varování", () => {
    expect(kontrola({ media: [obr(1080, 1080, { kind: null })] }).varovani.join()).toMatch(/neznáme, jestli/);
  });
  it("jiný obrázek než JPEG blokuje", () => {
    expect(kontrola({ media: [obr(1080, 1080, { mime_type: "image/png" })] }).blokujici.join()).toMatch(/JPEG/);
  });
});

describe("Facebook", () => {
  const fb = (x: Partial<VariantaProKontrolu>) => kontrola({ platform: "facebook", ...x });
  it("63 206 znaků projde, o jeden víc blokuje", () => {
    expect(fb({ caption: "a".repeat(63206), media: [] }).blokujici).toEqual([]);
    expect(fb({ caption: "a".repeat(63207), media: [] }).blokujici.join()).toMatch(/moc dlouhý/);
  });
  it("story na Facebooku nejde", () => {
    expect(fb({ format: "story" }).blokujici.join()).toMatch(/nejde/);
  });
  it("reel 3–90 s, mimo jen varování", () => {
    expect(fb({ format: "reel", media: [video(3)] }).varovani).toEqual([]);
    expect(fb({ format: "reel", media: [video(90)] }).varovani).toEqual([]);
    const kratky = fb({ format: "reel", media: [video(2)] });
    expect(kratky.varovani.join()).toMatch(/3–90/);
    expect(kratky.blokujici).toEqual([]);
    expect(fb({ format: "reel", media: [video(91)] }).varovani.join()).toMatch(/3–90/);
  });
  it("text bez média projde", () => {
    expect(fb({ media: [] }).blokujici).toEqual([]);
  });
});

describe("čas", () => {
  it("minulost blokuje jen naplánování", () => {
    const minule = new Date("2026-10-12T09:59:00Z");
    expect(kontrola({ scheduledAt: minule }).blokujici.join()).toMatch(/minulosti/);
    expect(zkontrolujVariantu(v({ scheduledAt: minule }), "koncept", TED).blokujici).toEqual([]);
  });
  it("bez času nejde naplánovat", () => {
    expect(kontrola({ scheduledAt: null }).blokujici.join()).toMatch(/Chybí datum/);
  });
});
