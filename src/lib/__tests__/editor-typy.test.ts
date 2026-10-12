import { describe, expect, it } from "vitest";
import { variantaSeZmenila, zpusobZkusitZnovu, type Varianta } from "@/components/editor/typy";
import type { MediaAsset } from "../db-types";

const medium = (id: string) => ({ id, fingerprint: id, kind: "image" }) as MediaAsset;

const v = (x: Partial<Varianta> = {}): Varianta => ({
  klic: "p1",
  id: "p1",
  status: "failed",
  account_id: "acc",
  group_id: null,
  series_id: null,
  copied_from_id: null,
  format: "feed",
  caption: "Text",
  link_url: "",
  media: [medium("m1"), medium("m2")],
  datum: "2026-10-20",
  cas: "09:00",
  platform_options: { a: 1, b: 2 },
  puvodniCas: "2026-10-20T07:00:00Z",
  external_url: null,
  published_at: null,
  last_error_code: "x",
  last_error_message: "y",
  error_resolved_at: null,
  ...x,
});

describe("Zkusit znovu v editoru", () => {
  it("bez úprav jen změna stavu (žádné ukládání médií)", () => {
    expect(zpusobZkusitZnovu(v(), v({ platform_options: { b: 2, a: 1 } }))).toBe("jen-stav");
  });
  it("s úpravou textu, pořadí médií nebo času se ukládá", () => {
    expect(zpusobZkusitZnovu(v(), v({ caption: "Jiný" }))).toBe("ulozit");
    expect(zpusobZkusitZnovu(v(), v({ media: [medium("m2"), medium("m1")] }))).toBe("ulozit");
    expect(zpusobZkusitZnovu(v(), v({ cas: "10:00" }))).toBe("ulozit");
  });
  it("bez načteného stavu raději uložit", () => {
    expect(zpusobZkusitZnovu(undefined, v())).toBe("ulozit");
  });
  it("variantaSeZmenila: povolení duplicity je změna", () => {
    expect(variantaSeZmenila(v(), v({ platform_options: { a: 1, b: 2, allow_duplicate: true } }))).toBe(true);
  });
});
