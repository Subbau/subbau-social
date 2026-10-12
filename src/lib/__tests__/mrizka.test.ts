import { describe, expect, it } from "vitest";
import { utcNaMistni } from "../cas";
import {
  bunkaTydne,
  casPoPretazeni,
  dnyTydne,
  rozsahMesice,
  rozsahTydne,
  slotyProDen,
  tydnyMesice,
} from "../mrizka";

const P = "Europe/Prague";

describe("týden", () => {
  it("začíná pondělím, 7 dní", () => {
    const dny = dnyTydne("2026-10-15");
    expect(dny.map((d) => d.datum)).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
    ]);
    expect(dny[0].denVTydnu).toBe(1);
  });
  it("neděle patří do týdne od předchozího pondělí", () => {
    expect(dnyTydne("2026-10-25")[0].datum).toBe("2026-10-19");
  });
  it("rozsah týdne s podzimním posunem má 169 hodin", () => {
    const r = rozsahTydne("2026-10-21", P);
    expect(r.od.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(r.do.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((r.do.getTime() - r.od.getTime()) / 3600_000).toBe(169);
  });
  it("rozsah týdne s jarním posunem má 167 hodin", () => {
    const r = rozsahTydne("2026-03-25", P);
    expect((r.do.getTime() - r.od.getTime()) / 3600_000).toBe(167);
  });
});

describe("měsíc", () => {
  it("říjen 2026 (1. je čtvrtek) = 5 týdnů od 28. 9.", () => {
    const t = tydnyMesice(2026, 10);
    expect(t.length).toBe(5);
    expect(t[0][0].datum).toBe("2026-09-28");
    expect(t[0][0].vMesici).toBe(false);
    expect(t[0][3].datum).toBe("2026-10-01");
    expect(t[0][3].vMesici).toBe(true);
    expect(t[4][6].datum).toBe("2026-11-01");
  });
  it("únor 2027 začíná pondělím a má přesně 4 týdny", () => {
    const t = tydnyMesice(2027, 2);
    expect(t.length).toBe(4);
    expect(t[0][0].datum).toBe("2027-02-01");
    expect(t[3][6].datum).toBe("2027-02-28");
  });
  it("březen 2026 potřebuje 6 řádků", () => {
    expect(tydnyMesice(2026, 3).length).toBe(6);
  });
  it("rozsah měsíce pokrývá celou mřížku v místním čase", () => {
    const r = rozsahMesice(2026, 10, P);
    expect(r.od.toISOString()).toBe("2026-09-27T22:00:00.000Z");
    expect(r.do.toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
});

describe("zařazení a přetažení", () => {
  it("buňka podle místního času", () => {
    expect(bunkaTydne("2026-10-12T07:45:00Z", P)).toEqual({ datum: "2026-10-12", hodina: 9 });
  });
  it("noční příspěvek spadne do prvního řádku", () => {
    expect(bunkaTydne("2026-10-12T01:00:00Z", P)).toEqual({ datum: "2026-10-12", hodina: 6 });
  });
  it("týden: nový den a hodina, minuty zůstanou", () => {
    const n = casPoPretazeni("2026-10-12T07:45:00Z", "2026-10-14", 15, P);
    expect(utcNaMistni(n, P)).toMatchObject({ datum: "2026-10-14", cas: "15:45" });
  });
  it("měsíc: nový den, čas dne zůstane i přes změnu času", () => {
    const n = casPoPretazeni("2026-10-20T07:45:00Z", "2026-10-27", null, P);
    expect(utcNaMistni(n, P)).toMatchObject({ datum: "2026-10-27", cas: "09:45" });
    expect(n.toISOString()).toBe("2026-10-27T08:45:00.000Z");
  });
  it("příspěvek bez času dostane v měsíci 9:00", () => {
    expect(utcNaMistni(casPoPretazeni(null, "2026-10-27", null, P), P).cas).toBe("09:00");
  });
  it("výchozí časy účtu pro den, seřazené", () => {
    const sloty = [
      { weekday: 1, time_of_day: "18:00:00" },
      { weekday: 1, time_of_day: "09:30:00" },
      { weekday: 2, time_of_day: "12:00:00" },
    ];
    expect(slotyProDen(sloty, "2026-10-12")).toEqual(["09:30", "18:00"]);
  });
});
