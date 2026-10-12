import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cron/skupiny/route";
import type { DueGroupBatch } from "../db-types";
import { MIN_DELKA_SECRETU, overCronSecret, zpracujDavky, type CronZavislosti, type Odber } from "../skupiny/cron-server";

const SECRET = "a".repeat(40);

describe("ověření cron secretu", () => {
  it("správná hlavička projde", () => {
    expect(overCronSecret(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
  it("chybějící, špatná, jiné schéma nebo jiná délka → ne", () => {
    expect(overCronSecret(null, SECRET)).toBe(false);
    expect(overCronSecret("", SECRET)).toBe(false);
    expect(overCronSecret(`Bearer ${"b".repeat(40)}`, SECRET)).toBe(false);
    expect(overCronSecret(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(overCronSecret(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(overCronSecret(SECRET, SECRET)).toBe(false);
  });
  it("secret kratší než 32 znaků se nepřijme ani se správnou hlavičkou", () => {
    const kratky = "k".repeat(MIN_DELKA_SECRETU - 1);
    expect(MIN_DELKA_SECRETU).toBe(32);
    expect(overCronSecret(`Bearer ${kratky}`, kratky)).toBe(false);
    expect(overCronSecret(`Bearer ${"k".repeat(32)}`, "k".repeat(32))).toBe(true);
    expect(overCronSecret("Bearer ", "")).toBe(false);
    expect(overCronSecret("Bearer undefined", undefined)).toBe(false);
  });
  it("porovnání je v konstantním čase (timingSafeEqual na otiscích, ne ===)", async () => {
    const { readFileSync } = await import("node:fs");
    const zdroj = readFileSync(new URL("../skupiny/cron-server.ts", import.meta.url), "utf8");
    const telo = zdroj.slice(zdroj.indexOf("export function overCronSecret"), zdroj.indexOf("export type CronEnv"));
    expect(telo).toContain("timingSafeEqual(");
    expect(telo).not.toMatch(/hlavicka\s*===\s*`Bearer/);
  });
});

describe("route /api/cron/skupiny", () => {
  afterEach(() => vi.unstubAllEnvs());
  const pozadavek = (auth?: string) =>
    new Request("http://localhost/api/cron/skupiny", { method: "POST", headers: auth ? { authorization: auth } : {} });

  it("bez env → 500 s českou hláškou", async () => {
    vi.stubEnv("VERCEL_CRON_SECRET", "");
    const r = await POST(pozadavek(`Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/chybí nastavení VERCEL_CRON_SECRET/);
  });
  it("špatný nebo chybějící secret → 401", async () => {
    vi.stubEnv("VERCEL_CRON_SECRET", SECRET);
    expect((await POST(pozadavek())).status).toBe(401);
    expect((await POST(pozadavek("Bearer spatne"))).status).toBe(401);
  });
  it("krátký secret v env → 401 i se shodnou hlavičkou", async () => {
    vi.stubEnv("VERCEL_CRON_SECRET", "kratky");
    expect((await POST(pozadavek("Bearer kratky"))).status).toBe(401);
  });
  it("správný secret, ale chybí ostatní env → 500 se jmény (bez hodnot)", async () => {
    vi.stubEnv("VERCEL_CRON_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const r = await POST(pozadavek(`Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    const t = JSON.stringify(await r.json());
    expect(t).toContain("SUPABASE_SECRET_KEY");
    expect(t).toContain("VAPID_PRIVATE_KEY");
    expect(t).not.toContain(SECRET);
  });
});

describe("rozeslání upozornění", () => {
  function zavislosti(o: Partial<CronZavislosti> = {}) {
    const poslane: { endpoint: string; payload: string }[] = [];
    const smazane: string[] = [];
    const vracene: string[] = [];
    const logy: string[] = [];
    const odbery: Odber[] = [
      { id: "s1", endpoint: "https://push/1", p256dh: "k", auth: "a" },
      { id: "s2", endpoint: "https://push/2", p256dh: "k", auth: "a" },
      { id: "s3", endpoint: "https://push/3", p256dh: "k", auth: "a" },
    ];
    const z: CronZavislosti = {
      dueBatches: async () => [{ batch_id: "b1", campaign_id: "c1", campaign_title: "N", batch_no: 2, batch_count: 8, due_at: "x", pending_count: 20 }],
      pocetDavek: async () => 8,
      pocetCekajicich: async () => 0,
      odbery: async () => odbery,
      posli: async (s, payload) => {
        if (s.id === "s2") throw Object.assign(new Error("Gone"), { statusCode: 410 });
        if (s.id === "s3") throw Object.assign(new Error("boom"), { statusCode: 500 });
        poslane.push({ endpoint: s.endpoint, payload });
      },
      smazOdber: async (id) => {
        smazane.push(id);
      },
      uvolniDavku: async (id) => {
        vracene.push(id);
        return true;
      },
      log: (t) => {
        logy.push(t);
      },
      ...o,
    };
    return { z, poslane, smazane, vracene, logy };
  }

  it("pošle text dávky, odběr s 410 smaže, jinou chybu jen spočítá", async () => {
    const { z, poslane, smazane } = zavislosti();
    const v = await zpracujDavky(z);
    expect(v).toEqual({ davek: 1, notifikaci: 1, chyb: 1, smazanoOdberu: 1, vraceno: 0 });
    expect(smazane).toEqual(["s2"]);
    expect(JSON.parse(poslane[0].payload)).toMatchObject({
      body: "Skupiny: dávka 2 z 8 — 20 skupin čeká",
      url: "/skupiny/dnes",
    });
  });
  it("404 taky maže a smazaný odběr se v další dávce už nezkouší", async () => {
    let pokusu = 0;
    const { z, smazane } = zavislosti({
      dueBatches: async () => [
        { batch_id: "b1", campaign_id: "c1", campaign_title: "N", batch_no: 1, batch_count: 1, due_at: "x", pending_count: 5 },
        { batch_id: "b2", campaign_id: "c2", campaign_title: "N", batch_no: 1, batch_count: 1, due_at: "x", pending_count: 5 },
      ],
      posli: async (s) => {
        pokusu++;
        if (s.id === "s1") throw Object.assign(new Error("nf"), { statusCode: 404 });
      },
    });
    await zpracujDavky(z);
    expect(smazane).toEqual(["s1"]);
    expect(pokusu).toBe(3 + 2);
  });
  it("dávka bez čekajících skupin se neposílá; chybějící počty se dopočítají", async () => {
    const pocitano: string[] = [];
    const { z, poslane } = zavislosti({
      dueBatches: async () =>
        [
          { batch_id: "b0", campaign_id: "c1", campaign_title: "N", batch_no: 1, batch_count: 1, due_at: "x", pending_count: 0 },
          // starší tvar bez počtů → dopočítat
          { batch_id: "b9", campaign_id: "c9", batch_no: 3 },
        ] as unknown as DueGroupBatch[],
      pocetCekajicich: async (id) => {
        pocitano.push(id);
        return 4;
      },
      pocetDavek: async () => 5,
    });
    await zpracujDavky(z);
    expect(pocitano).toEqual(["b9"]);
    expect(poslane.map((p) => JSON.parse(p.payload).body)).toEqual(["Skupiny: dávka 3 z 5 — 4 skupiny čekají"]);
  });
  it("žádné dávky → žádné dotazy na odběry", async () => {
    const odbery = vi.fn(async () => []);
    const { z } = zavislosti({ dueBatches: async () => [], odbery });
    expect(await zpracujDavky(z)).toEqual({ davek: 0, notifikaci: 0, chyb: 0, smazanoOdberu: 0, vraceno: 0 });
    expect(odbery).not.toHaveBeenCalled();
  });

  describe("nedoručená dávka se vrátí k dalšímu pokusu", () => {
    const jednaDavka = async () => [
      { batch_id: "b1", campaign_id: "c1", campaign_title: "N", batch_no: 1, batch_count: 2, due_at: "x", pending_count: 5 },
    ];
    it("všechna odeslání 5xx/síť → release_group_batch", async () => {
      const { z, vracene } = zavislosti({
        dueBatches: jednaDavka,
        posli: async () => {
          throw Object.assign(new Error("503"), { statusCode: 503 });
        },
      });
      const v = await zpracujDavky(z);
      expect(vracene).toEqual(["b1"]);
      expect(v.vraceno).toBe(1);
    });
    it("síťová chyba bez stavového kódu → taky vrátit", async () => {
      const { z, vracene } = zavislosti({
        dueBatches: jednaDavka,
        posli: async () => {
          throw new Error("ECONNRESET");
        },
      });
      await zpracujDavky(z);
      expect(vracene).toEqual(["b1"]);
    });
    it("odběry nejdou načíst → vrátit", async () => {
      const { z, vracene } = zavislosti({
        dueBatches: jednaDavka,
        odbery: async () => {
          throw new Error("db down");
        },
      });
      await zpracujDavky(z);
      expect(vracene).toEqual(["b1"]);
    });
    it("aspoň jedno doručení → nevracet", async () => {
      const { z, vracene } = zavislosti({ dueBatches: jednaDavka });
      await zpracujDavky(z);
      expect(vracene).toEqual([]);
    });
    it("nula odběrů → NEvracet (nekonečná smyčka), jen zalogovat", async () => {
      const { z, vracene, logy } = zavislosti({ dueBatches: jednaDavka, odbery: async () => [] });
      await zpracujDavky(z);
      expect(vracene).toEqual([]);
      expect(logy.join()).toMatch(/0 odběrů/);
    });
    it("všechny odběry mrtvé (410) → smazat, ale nevracet", async () => {
      const { z, vracene, smazane } = zavislosti({
        dueBatches: jednaDavka,
        posli: async () => {
          throw Object.assign(new Error("Gone"), { statusCode: 410 });
        },
      });
      await zpracujDavky(z);
      expect(smazane).toEqual(["s1", "s2", "s3"]);
      expect(vracene).toEqual([]);
    });
  });
});
