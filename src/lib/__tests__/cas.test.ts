import { describe, expect, it } from "vitest";
import {
  denVTydnu,
  formatVPasmu,
  mistniNaUtc,
  pondeli,
  posunOMistniDny,
  pridejDny,
  pridejMesice,
  utcNaMistni,
} from "../cas";

const P = "Europe/Prague";

describe("místní čas → UTC (Europe/Prague)", () => {
  it("zimní čas = UTC+1", () => {
    expect(mistniNaUtc("2026-01-15", "09:00", P).toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });
  it("letní čas = UTC+2", () => {
    expect(mistniNaUtc("2026-07-15", "09:00", P).toISOString()).toBe("2026-07-15T07:00:00.000Z");
  });
  it("29. 3. 2026: 1:30 je ještě zimní", () => {
    expect(mistniNaUtc("2026-03-29", "01:30", P).toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });
  it("29. 3. 2026: neexistující 2:30 se posune na 3:30 letního", () => {
    expect(mistniNaUtc("2026-03-29", "02:30", P).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
  it("29. 3. 2026: 3:00 je už letní", () => {
    expect(mistniNaUtc("2026-03-29", "03:00", P).toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });
  it("25. 10. 2026: dvojznačná 2:30 = první výskyt (letní)", () => {
    expect(mistniNaUtc("2026-10-25", "02:30", P).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("25. 10. 2026: 3:00 je už zimní", () => {
    expect(mistniNaUtc("2026-10-25", "03:00", P).toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });
  it("25. 10. 2026: 9:00 ráno = 8:00 UTC", () => {
    expect(mistniNaUtc("2026-10-25", "09:00", P).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });
});

describe("UTC → místní čas", () => {
  it("půlnoc UTC je v Praze 1:00 nebo 2:00", () => {
    expect(utcNaMistni("2026-01-01T00:00:00Z", P).cas).toBe("01:00");
    expect(utcNaMistni("2026-07-01T00:00:00Z", P).cas).toBe("02:00");
  });
  it("datum se přehoupne přes půlnoc", () => {
    const m = utcNaMistni("2026-10-24T22:30:00Z", P);
    expect(m.datum).toBe("2026-10-25");
    expect(m.cas).toBe("00:30");
    expect(m.denVTydnu).toBe(7);
  });
  it("25. 10. 2026: oba výskyty 2:30 se zobrazí jako 2:30", () => {
    expect(utcNaMistni("2026-10-25T00:30:00Z", P).cas).toBe("02:30");
    expect(utcNaMistni("2026-10-25T01:30:00Z", P).cas).toBe("02:30");
  });
  it("29. 3. 2026: 1:00 UTC je 3:00 místního", () => {
    expect(utcNaMistni("2026-03-29T01:00:00Z", P).cas).toBe("03:00");
  });
  it("tam a zpět dává stejný okamžik (mimo mezeru)", () => {
    for (const iso of ["2026-03-28T23:15:00Z", "2026-03-29T01:00:00Z", "2026-10-25T02:00:00Z", "2026-12-31T23:59:00Z"]) {
      const m = utcNaMistni(iso, P);
      expect(mistniNaUtc(m.datum, m.cas, P).toISOString()).toBe(new Date(iso).toISOString());
    }
  });
  it("formát v pásmu", () => {
    expect(formatVPasmu("2026-10-25T08:00:00Z", "d. M. yyyy H:mm", P)).toBe("25. 10. 2026 9:00");
  });
});

describe("kalendářní aritmetika", () => {
  it("přičítání dnů přes konec měsíce a roku", () => {
    expect(pridejDny("2026-12-30", 3)).toBe("2027-01-02");
    expect(pridejDny("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("den v týdnu (ISO)", () => {
    expect(denVTydnu("2026-10-12")).toBe(1);
    expect(denVTydnu("2026-10-25")).toBe(7);
  });
  it("pondělí týdne", () => {
    expect(pondeli("2026-10-25")).toBe("2026-10-19");
    expect(pondeli("2026-10-19")).toBe("2026-10-19");
  });
  it("přičítání měsíců", () => {
    expect(pridejMesice("2026-11-15", 2)).toBe("2027-01-01");
    expect(pridejMesice("2026-01-15", -1)).toBe("2025-12-01");
  });
  it("posun o 7 místních dní přes podzimní posun drží 9:00", () => {
    const z = mistniNaUtc("2026-10-20", "09:00", P);
    const k = posunOMistniDny(z, 7, P);
    expect(utcNaMistni(k, P).cas).toBe("09:00");
    expect(k.getTime() - z.getTime()).toBe(7 * 24 * 3600_000 + 3600_000);
  });
  it("posun o 7 místních dní přes jarní posun drží 9:00", () => {
    const z = mistniNaUtc("2026-03-24", "09:00", P);
    const k = posunOMistniDny(z, 7, P);
    expect(utcNaMistni(k, P).cas).toBe("09:00");
    expect(k.getTime() - z.getTime()).toBe(7 * 24 * 3600_000 - 3600_000);
  });
});
