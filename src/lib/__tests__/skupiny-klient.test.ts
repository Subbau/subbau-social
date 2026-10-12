import { describe, expect, it } from "vitest";
import { sestavFrontu, type UkolProFrontu } from "../skupiny/fronta";
import { KLIC_PREDVYPLNENI, rozbalPredvyplneni, zabalPredvyplneni } from "../skupiny/predvyplneni";
import { jeIos, klicOdberu, klicZBase64Url, potrebujePridatNaPlochu } from "../skupiny/push-klient";

const TED = new Date("2026-10-13T12:00:00Z");
let n = 0;
const u = (x: Partial<UkolProFrontu> & { batch_id: string; due: string; name: string }): UkolProFrontu => ({
  id: `t${++n}`,
  campaign_id: "c1",
  status: "pending",
  variant_index: 0,
  skupina: { name: x.name, url: null, note: null },
  davka: { batch_no: Number(x.batch_id.slice(1)), due_at: x.due },
  kampan: { title: "Nábor", variants: ["A", "B", "C"] },
  ...x,
});

describe("fronta Skupiny dnes", () => {
  const ukoly = [
    u({ batch_id: "b1", due: "2026-10-13T10:00:00Z", name: "Zeta", status: "sent" }),
    u({ batch_id: "b1", due: "2026-10-13T10:00:00Z", name: "Beta", variant_index: 1 }),
    u({ batch_id: "b1", due: "2026-10-13T10:00:00Z", name: "Alfa", variant_index: 2 }),
    u({ batch_id: "b2", due: "2026-10-13T11:00:00Z", name: "Gama", status: "skipped" }),
    u({ batch_id: "b2", due: "2026-10-13T11:00:00Z", name: "Delta" }),
    u({ batch_id: "b3", due: "2026-10-13T14:00:00Z", name: "Omega" }),
    u({ batch_id: "b3", due: "2026-10-13T14:00:00Z", name: "Psí" }),
  ];
  const { fronta, budouci } = sestavFrontu(ukoly, TED);
  it("jen splatné čekající, podle dávky a jména", () => {
    expect(fronta.map((f) => f.skupina.name)).toEqual(["Alfa", "Beta", "Delta"]);
  });
  it("počítadla „x / y v dávce · x / y celkem“", () => {
    expect(fronta.map((f) => `${f.vDavce.poradi}/${f.vDavce.celkem} · ${f.celkem.poradi}/${f.celkem.celkem}`)).toEqual([
      "2/3 · 3/7",
      "3/3 · 4/7",
      "2/2 · 5/7",
    ]);
  });
  it("text podle varianty", () => {
    expect(fronta.map((f) => f.text)).toEqual(["C", "B", "A"]);
  });
  it("budoucí dávky jako seznam s časy", () => {
    expect(budouci).toEqual([{ campaign_id: "c1", title: "Nábor", batch_no: 3, due_at: "2026-10-13T14:00:00Z", cekajicich: 2 }]);
  });
});

describe("upozornění v telefonu", () => {
  it("VAPID klíč z base64url na bajty", () => {
    expect([...klicZBase64Url("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
  it("iPhone v Safari potřebuje přidat na plochu, z plochy ne, Android ne", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0 Mobile Safari/537.36";
    expect(potrebujePridatNaPlochu(iphone, false)).toBe(true);
    expect(potrebujePridatNaPlochu(iphone, true)).toBe(false);
    expect(potrebujePridatNaPlochu(android, false)).toBe(false);
    expect(jeIos(ipad, 5)).toBe(true);
    expect(jeIos(ipad, 0)).toBe(false);
  });
  it("klíče odběru", () => {
    expect(klicOdberu({ endpoint: "e", keys: { p256dh: "p", auth: "a" } })).toEqual({ endpoint: "e", p256dh: "p", auth: "a" });
    expect(klicOdberu({ endpoint: "e", keys: {} })).toBeNull();
  });
});

describe("Poslat i do skupin — předání z editoru", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  it("tam a zpět", () => {
    expect(rozbalPredvyplneni(zabalPredvyplneni({ text: "Ahoj 👷", assetIds: [id], zdroj: null }))).toEqual({
      text: "Ahoj 👷",
      assetIds: [id],
      zdroj: null,
    });
    expect(KLIC_PREDVYPLNENI).toMatch(/skupiny/);
  });
  it("rozbitá nebo cizí data se ignorují, podezřelá id vypadnou", () => {
    expect(rozbalPredvyplneni("{")).toBeNull();
    expect(rozbalPredvyplneni(JSON.stringify({ v: 2, text: "x", assetIds: [] }))).toBeNull();
    expect(rozbalPredvyplneni(JSON.stringify({ v: 1, text: "x", assetIds: [id, "x'); drop", 5] }))?.assetIds).toEqual([id]);
  });
});
