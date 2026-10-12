import { describe, expect, it } from "vitest";
import { odkazSkupiny } from "../skupiny/odkaz";
import { rozpisDavek, seradProRozesilku, zkontrolujRozesilku } from "../skupiny/rozpis";
import { textNotifikace } from "../skupiny/texty";

const START = new Date("2026-10-24T18:00:00Z"); // přes noc na 25. 10. se mění čas — dávky jdou po pevných minutách
const sk = (n: number, neaktivni: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i}`, is_active: !neaktivni.includes(i) }));

describe("rozpis dávek = pravidlo create_group_campaign", () => {
  it("45 skupin po 20 → dávky 20/20/5, časy start + (n−1)×odstup", () => {
    const d = rozpisDavek(sk(45), 3, START, 20, 120);
    expect(d.map((x) => x.ukoly.length)).toEqual([20, 20, 5]);
    expect(d.map((x) => x.batchNo)).toEqual([1, 2, 3]);
    expect(d.map((x) => x.dueAt.toISOString())).toEqual([
      "2026-10-24T18:00:00.000Z",
      "2026-10-24T20:00:00.000Z",
      "2026-10-24T22:00:00.000Z",
    ]);
  });
  it("varianty se střídají po skupinách přes celé pořadí (pořadí % počet, od 0)", () => {
    const d = rozpisDavek(sk(7), 3, START, 3, 60);
    expect(d.flatMap((x) => x.ukoly.map((u) => u.variantIndex))).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(rozpisDavek(sk(3), 1, START, 3, 60)[0].ukoly.map((u) => u.variantIndex)).toEqual([0, 0, 0]);
  });
  it("neaktivní skupiny se přeskočí a číslování je souvislé", () => {
    const d = rozpisDavek(sk(5, [1, 3]), 2, START, 2, 60);
    expect(d.map((x) => x.ukoly.map((u) => u.groupId))).toEqual([["g0", "g2"], ["g4"]]);
    expect(d.flatMap((x) => x.ukoly.map((u) => u.variantIndex))).toEqual([0, 1, 0]);
  });
  it("stejná skupina v poli víckrát → jen první výskyt (jako DB)", () => {
    const d = rozpisDavek([...sk(3), { id: "g0", is_active: true }, { id: "g1", is_active: true }], 2, START, 10, 60);
    expect(d[0].ukoly.map((u) => u.groupId)).toEqual(["g0", "g1", "g2"]);
  });
  it("odstup je v pevných minutách (24 h přes změnu času = 24 h)", () => {
    const d = rozpisDavek(sk(2), 1, START, 1, 1440);
    expect(d[1].dueAt.getTime() - d[0].dueAt.getTime()).toBe(24 * 3600_000);
  });
  it("meze jako v DB", () => {
    expect(() => rozpisDavek(sk(2), 4, START, 20, 120)).toThrow(/1–3/);
    expect(() => rozpisDavek(sk(2), 1, START, 101, 120)).toThrow(/1–100/);
    expect(() => rozpisDavek(sk(2), 1, START, 20, 14)).toThrow(/15–1440/);
  });
  it("pořadí: nikdy neodeslané první, pak nejdéle neodeslané", () => {
    const s = seradProRozesilku([
      { name: "B", last_sent_at: "2026-10-01T00:00:00Z" },
      { name: "C", last_sent_at: null },
      { name: "A", last_sent_at: "2026-09-01T00:00:00Z" },
      { name: "Á", last_sent_at: null },
    ]);
    expect(s.map((x) => x.name)).toEqual(["Á", "C", "A", "B"]);
  });
  it("kontrola formuláře", () => {
    const ok = { title: "N", variants: ["a"], groupIds: ["g"], batchSize: 20, intervalMinut: 120, startsAt: START, ted: START };
    expect(zkontrolujRozesilku(ok)).toEqual([]);
    expect(zkontrolujRozesilku({ ...ok, variants: ["a", " "] }).join()).toMatch(/prázdná/);
    expect(zkontrolujRozesilku({ ...ok, groupIds: [] }).join()).toMatch(/aspoň jednu/);
    expect(zkontrolujRozesilku({ ...ok, startsAt: new Date(START.getTime() - 10 * 60_000) }).join()).toMatch(/minulosti/);
  });
});

describe("Otevřít skupinu", () => {
  it("uložená URL facebooku", () => {
    expect(odkazSkupiny({ name: "X", url: "https://www.facebook.com/groups/123" })).toBe("https://www.facebook.com/groups/123");
  });
  it("bez URL vyhledávání s URL-encode (diakritika, &, emoji)", () => {
    expect(odkazSkupiny({ name: " Práce & bydlení 🇩🇪 ", url: null })).toBe(
      "https://www.facebook.com/search/groups/?q=Pr%C3%A1ce%20%26%20bydlen%C3%AD%20%F0%9F%87%A9%F0%9F%87%AA",
    );
  });
  it("cizí nebo nebezpečná URL → vyhledávání", () => {
    expect(odkazSkupiny({ name: "A", url: "javascript:alert(1)" })).toBe("https://www.facebook.com/search/groups/?q=A");
    expect(odkazSkupiny({ name: "A", url: "http://www.facebook.com/groups/1" })).toBe("https://www.facebook.com/search/groups/?q=A");
  });
});

describe("text notifikace", () => {
  it("dávka X z Y — N skupin čeká (česky skloňované)", () => {
    expect(textNotifikace(2, 8, 20).body).toBe("Skupiny: dávka 2 z 8 — 20 skupin čeká");
    expect(textNotifikace(1, 1, 1).body).toBe("Skupiny: dávka 1 z 1 — 1 skupina čeká");
    expect(textNotifikace(1, 3, 3).body).toBe("Skupiny: dávka 1 z 3 — 3 skupiny čekají");
  });
});
