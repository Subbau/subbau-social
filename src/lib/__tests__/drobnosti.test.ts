import { describe, expect, it } from "vitest";
import { casProOpakovani } from "../akce";
import { cestaMedia, cestaNahledu, priponaProMime } from "../media-cesta";
import { radekSerie, zkontrolujOpakovani, type FormularOpakovani } from "../opakovani";

describe("Zkusit znovu", () => {
  const ted = new Date("2026-10-12T10:00:00Z");
  it("původní čas v minulosti → teď + 2 min", () => {
    expect(casProOpakovani("2026-10-12T08:00:00Z", ted).toISOString()).toBe("2026-10-12T10:02:00.000Z");
  });
  it("původní čas v budoucnu zůstane", () => {
    expect(casProOpakovani("2026-10-13T08:00:00Z", ted).toISOString()).toBe("2026-10-13T08:00:00.000Z");
  });
  it("bez času → teď + 2 min", () => {
    expect(casProOpakovani(null, ted).toISOString()).toBe("2026-10-12T10:02:00.000Z");
  });
});

describe("cesty v bucketu", () => {
  it("účet / rok / měsíc v pražském čase", () => {
    // 31. 12. 23:30 UTC je v Praze už leden
    expect(cestaMedia("acc", new Date("2026-12-31T23:30:00Z"), "u1", "jpg")).toBe("acc/2027/01/u1.jpg");
    expect(cestaMedia(null, new Date("2026-10-12T10:00:00Z"), "u2", "mp4")).toBe("shared/2026/10/u2.mp4");
  });
  it("náhled", () => {
    expect(cestaNahledu("shared/2026/10/u2.mp4")).toBe("thumbs/shared/2026/10/u2.jpg");
  });
  it("přípona z MIME, jinak z názvu", () => {
    expect(priponaProMime("video/quicktime")).toBe("mov");
    expect(priponaProMime("application/x-neco", "Film.M4V")).toBe("m4v");
  });
});

describe("opakování", () => {
  const f: FormularOpakovani = {
    freq: "weekly", interval_n: 1, weekdays: [3, 1, 3], month_day: 1,
    cas: "9:05", starts_on: "2026-10-12", until_on: "",
  };
  it("platný týdenní", () => {
    expect(zkontrolujOpakovani(f)).toEqual([]);
    expect(radekSerie(f, "acc", "post", "Europe/Prague")).toMatchObject({
      weekdays: [1, 3], month_day: null, time_of_day: "09:05:00", until_on: null,
    });
  });
  it("chyby formuláře", () => {
    expect(zkontrolujOpakovani({ ...f, weekdays: [] }).join()).toMatch(/den v týdnu/);
    expect(zkontrolujOpakovani({ ...f, interval_n: 0 }).join()).toMatch(/Interval/);
    expect(zkontrolujOpakovani({ ...f, freq: "monthly", month_day: 32 }).join()).toMatch(/1–31/);
    expect(zkontrolujOpakovani({ ...f, until_on: "2026-10-01" }).join()).toMatch(/Konec/);
  });
  it("měsíční nemá dny v týdnu", () => {
    expect(radekSerie({ ...f, freq: "monthly", month_day: 31 }, "a", "p", "Europe/Prague")).toMatchObject({
      weekdays: null, month_day: 31,
    });
  });
});
