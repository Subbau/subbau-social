import { describe, expect, it } from "vitest";
import {
  VETA_ORIGINAL_CEKA,
  VETA_ZASTAVI,
  blokujeDuplicita,
  rozdelDuplicity,
  vetyUpozorneni,
  type KandidatDuplicity,
} from "../duplicity";
import { VETA_KOPIE_UPRAVIT, textPotvrzeniKopie } from "../kopirovani";

const TED = new Date("2026-10-12T10:00:00Z");
const DAVNO = "2026-08-01T10:00:00Z"; // víc než 30 dní
const NEDAVNO = "2026-10-05T10:00:00Z";

const k = (x: Partial<KandidatDuplicity>): KandidatDuplicity => ({
  id: "o1",
  status: "scheduled",
  scheduled_at: "2026-10-20T07:00:00Z",
  published_at: null,
  updated_at: NEDAVNO,
  created_at: NEDAVNO,
  caption: "Text",
  external_url: null,
  last_error_code: null,
  series_id: null,
  ...x,
});
const ja = { id: "ja", series_id: null };
const druhy = (xs: KandidatDuplicity[], j: { id: string | null; series_id: string | null } = ja) =>
  rozdelDuplicity(xs, j, TED).map((d) => `${d.id}:${d.druh}`);

describe("duplicity = stejné pravidlo jako claim_due_posts", () => {
  it("publishing zastaví (i když je starý)", () => {
    expect(druhy([k({ status: "publishing", created_at: DAVNO, updated_at: DAVNO, scheduled_at: DAVNO })])).toEqual(["o1:zastavi"]);
  });
  it("published ≤ 30 dní zastaví, starší ne", () => {
    expect(druhy([k({ status: "published", published_at: NEDAVNO })])).toEqual(["o1:zastavi"]);
    expect(druhy([k({ status: "published", published_at: DAVNO })])).toEqual([]);
  });
  it("unknown_outcome ve stavu scheduled/failed změněný ≤ 30 dní zastaví", () => {
    expect(druhy([k({ status: "failed", last_error_code: "unknown_outcome" })])).toEqual(["o1:zastavi"]);
    expect(druhy([k({ id: "o2", status: "scheduled", last_error_code: "unknown_outcome" })])).toEqual(["o2:zastavi"]);
    expect(druhy([k({ status: "failed", last_error_code: "unknown_outcome", updated_at: DAVNO })])).toEqual([]);
  });
  it("obyčejná chyba nezastaví a nečeká", () => {
    expect(druhy([k({ status: "failed", last_error_code: "graph_400" })])).toEqual([]);
  });
  it("naplánovaný originál = čeká", () => {
    expect(druhy([k({ status: "scheduled" })])).toEqual(["o1:ceka"]);
  });
  it("výskyty téže série a sebe sama nepočítá", () => {
    expect(druhy([k({ status: "publishing", series_id: "s1" })], { id: "ja", series_id: "s1" })).toEqual([]);
    expect(druhy([k({ id: "ja", status: "publishing" })])).toEqual([]);
  });
  it("blokuje jen to, co zastaví, a jen bez povolení", () => {
    const zastavi = rozdelDuplicity([k({ status: "publishing" })], ja, TED);
    const ceka = rozdelDuplicity([k({ status: "scheduled" })], ja, TED);
    expect(blokujeDuplicita(zastavi, false)).toBe(true);
    expect(blokujeDuplicita(zastavi, true)).toBe(false);
    expect(blokujeDuplicita(ceka, false)).toBe(false);
  });
});

describe("texty upozornění", () => {
  it("originál ještě nevyšel (scheduled) → věta o tom, že kopie bez úprav nevyjde", () => {
    const n = rozdelDuplicity([k({ status: "scheduled" })], ja, TED);
    expect(vetyUpozorneni(n, false)).toEqual([VETA_ORIGINAL_CEKA]);
    expect(VETA_ORIGINAL_CEKA).toBe(
      "Jakmile originál vyjde, tato kopie bez úprav nevyjde — upravte text nebo grafiku, nebo zaškrtněte ‚Opravdu zveřejnit znovu‘.",
    );
  });
  it("u konceptu ani po povolení věta není", () => {
    expect(vetyUpozorneni(rozdelDuplicity([k({ status: "draft" })], ja, TED), false)).toEqual([]);
    expect(vetyUpozorneni(rozdelDuplicity([k({ status: "scheduled" })], ja, TED), true)).toEqual([]);
  });
  it("zastavující duplicita → červená věta", () => {
    expect(vetyUpozorneni(rozdelDuplicity([k({ status: "publishing" })], ja, TED), false)).toEqual([VETA_ZASTAVI]);
  });
  it("potvrzení Zkopírovat týden obsahuje větu o úpravách", () => {
    const t = textPotvrzeniKopie(3);
    expect(t).toContain("Zkopírovat 3 příspěvků");
    expect(t).toContain(VETA_KOPIE_UPRAVIT);
    expect(VETA_KOPIE_UPRAVIT).toBe(
      "Kopie jsou koncepty. Když kopii před naplánováním neupravíte (text nebo grafiku), v den zveřejnění ji appka zastaví jako duplicitu, protože stejný obsah na stejném účtu už vyšel.",
    );
  });
});
