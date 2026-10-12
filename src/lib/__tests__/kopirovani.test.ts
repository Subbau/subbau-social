import { describe, expect, it } from "vitest";
import { utcNaMistni } from "../cas";
import { naplanujKopiiTydne, type ZdrojKopie } from "../kopirovani";
import { rozsahTydne } from "../mrizka";

const P = "Europe/Prague";
const tyden = rozsahTydne("2026-10-21", P); // 19.–25. 10. 2026, v neděli se mění čas

let citac = 0;
const uuid = () => `nove-${++citac}`;

const p = (x: Partial<ZdrojKopie>): ZdrojKopie => ({
  id: "p1",
  account_id: "acc",
  group_id: null,
  series_id: null,
  format: "feed",
  caption: "Text",
  link_url: null,
  scheduled_at: "2026-10-20T07:00:00Z", // út 9:00 letního
  status: "scheduled",
  platform_options: {},
  content_hash: "h1",
  assetIds: ["a1", "a2"],
  ...x,
});

describe("kopírování týdne", () => {
  it("koncept o týden později ve stejný místní čas i přes změnu času", () => {
    const { kopie } = naplanujKopiiTydne([p({})], tyden.od, tyden.do, new Set(), [], uuid, P);
    expect(kopie).toHaveLength(1);
    const r = kopie[0].radek;
    expect(r.status).toBe("draft");
    expect(r.copied_from_id).toBe("p1");
    expect(utcNaMistni(r.scheduled_at, P)).toMatchObject({ datum: "2026-10-27", cas: "09:00" });
    expect(r.scheduled_at).toBe("2026-10-27T08:00:00.000Z");
    expect(kopie[0].assetIds).toEqual(["a1", "a2"]);
  });

  it("kopíruje jen draft a scheduled z daného týdne", () => {
    const vstup = [
      p({ id: "a", status: "draft" }),
      p({ id: "b", status: "published" }),
      p({ id: "c", status: "failed" }),
      p({ id: "d", status: "publishing" }),
      p({ id: "e", scheduled_at: "2026-10-26T07:00:00Z" }), // další týden
      p({ id: "f", scheduled_at: null, status: "draft" }),
      p({ id: "g" }),
    ];
    const { kopie } = naplanujKopiiTydne(vstup, tyden.od, tyden.do, new Set(), [], uuid, P);
    expect(kopie.map((k) => k.zdrojId).sort()).toEqual(["a", "g"]);
  });

  it("vynechá šablony a výskyty opakování", () => {
    const { kopie, preskocene } = naplanujKopiiTydne(
      [p({ id: "s" }), p({ id: "v", series_id: "ser" }), p({ id: "x" })],
      tyden.od, tyden.do, new Set(["s"]), [], uuid, P,
    );
    expect(kopie.map((k) => k.zdrojId)).toEqual(["x"]);
    expect(preskocene.map((k) => k.zdrojId).sort()).toEqual(["s", "v"]);
  });

  it("druhé kliknutí nic nezdvojí", () => {
    const { kopie } = naplanujKopiiTydne(
      [p({})], tyden.od, tyden.do, new Set(),
      [{ copied_from_id: "p1", scheduled_at: "2026-10-27T08:00:00+00:00" }], uuid, P,
    );
    expect(kopie).toEqual([]);
  });

  it("skupina dostane novou společnou group_id", () => {
    const { kopie } = naplanujKopiiTydne(
      [p({ id: "a", group_id: "g1" }), p({ id: "b", group_id: "g1", account_id: "acc2" }), p({ id: "c", group_id: "g2" })],
      tyden.od, tyden.do, new Set(), [], uuid, P,
    );
    const g = Object.fromEntries(kopie.map((k) => [k.zdrojId, k.radek.group_id]));
    expect(g.a).toBe(g.b);
    expect(g.a).not.toBe("g1");
    expect(g.c).not.toBe(g.a);
  });

  it("povolení duplicity se nekopíruje, ostatní volby ano", () => {
    const { kopie } = naplanujKopiiTydne(
      [p({ platform_options: { allow_duplicate: true, jine: 1 } })],
      tyden.od, tyden.do, new Set(), [], uuid, P,
    );
    expect(kopie[0].radek.platform_options).toEqual({ jine: 1 });
  });

  it("hranice týdne: pondělí 0:00 dovnitř, další pondělí 0:00 ven", () => {
    const { kopie } = naplanujKopiiTydne(
      [p({ id: "zac", scheduled_at: tyden.od.toISOString() }), p({ id: "kon", scheduled_at: tyden.do.toISOString() })],
      tyden.od, tyden.do, new Set(), [], uuid, P,
    );
    expect(kopie.map((k) => k.zdrojId)).toEqual(["zac"]);
  });
});
