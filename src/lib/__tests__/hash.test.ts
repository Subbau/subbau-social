import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentHash, contentHashVstup, normalizeCaption, sha256Hex } from "../hash";

const nodeSha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

describe("normalizeCaption", () => {
  it("ořízne okraje, sjednotí bílé znaky a převede na malá", () => {
    expect(normalizeCaption("  Ahoj \n\t  SVĚTE  ")).toBe("ahoj světe");
  });
  it("sjednotí i nezlomitelnou mezeru a víc řádků", () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(normalizeCaption(`A${nbsp}${nbsp}B\r\n\r\nC`)).toBe("a b c");
  });
  it("česká velká písmena", () => {
    expect(normalizeCaption("ŽLUŤOUČKÝ KŮŇ ÚPĚL ĎÁBELSKÉ ÓDY")).toBe("žluťoučký kůň úpěl ďábelské ódy");
  });
  it("prázdný text", () => {
    expect(normalizeCaption("   \n ")).toBe("");
  });
});

describe("sha256Hex", () => {
  it("známý vektor 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("UTF-8 text se shoduje s node:crypto", async () => {
    expect(await sha256Hex("příliš žluťoučký kůň 🐎")).toBe(nodeSha("příliš žluťoučký kůň 🐎"));
  });
  it("Uint8Array s posunem bere jen svůj výřez", async () => {
    const velky = new TextEncoder().encode("xxabcxx");
    expect(await sha256Hex(velky.subarray(2, 5))).toBe(nodeSha("abc"));
  });
});

describe("content_hash", () => {
  const acc = "11111111-2222-3333-4444-555555555555";
  it("vstup přesně podle SPEC", () => {
    expect(contentHashVstup(acc, "feed", "  Nová   AKCE ", ["f1", "f2"])).toBe(
      `${acc}|feed|nová akce|f1,f2`,
    );
  });
  it("bez médií končí svislítkem", () => {
    expect(contentHashVstup(acc, "reel", "x", [])).toBe(`${acc}|reel|x|`);
  });
  it("hash = sha256 vstupu", async () => {
    expect(await contentHash(acc, "feed", "Ahoj  světe", ["aa", "bb"])).toBe(
      nodeSha(`${acc}|feed|ahoj světe|aa,bb`),
    );
  });
  it("záleží na pořadí médií i formátu, ne na bílých znacích a velikosti", async () => {
    const a = await contentHash(acc, "feed", "Text", ["aa", "bb"]);
    expect(await contentHash(acc, "feed", "Text", ["bb", "aa"])).not.toBe(a);
    expect(await contentHash(acc, "carousel", "Text", ["aa", "bb"])).not.toBe(a);
    expect(await contentHash(acc, "feed", "  TEXT\n", ["aa", "bb"])).toBe(a);
  });
});
