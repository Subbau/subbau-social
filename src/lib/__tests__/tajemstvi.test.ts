// Hlídá, že serverová tajemství (service klíč, VAPID private, cron secret) nikdy
// nemíří do prohlížeče, a že zdrojáky nemají \u escapy ani zaměnitelné znaky.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const KOREN = join(__dirname, "..", "..", "..");
const SRC = join(KOREN, "src");

function soubory(adr: string): string[] {
  return readdirSync(adr).flatMap((j) => {
    const c = join(adr, j);
    return statSync(c).isDirectory() ? soubory(c) : /\.(ts|tsx|mts|css)$/.test(j) ? [c] : [];
  });
}
const vse = soubory(SRC).filter((s) => !s.includes("__tests__"));
const rel = (s: string) => relative(KOREN, s);
const TAJNE = ["SUPABASE_SECRET_KEY", "VAPID_PRIVATE_KEY", "VERCEL_CRON_SECRET"];
const SMI_ZNAT_TAJEMSTVI = ["src/app/api/cron/skupiny/route.ts", "src/lib/skupiny/cron-server.ts"];

describe("tajemství zůstávají na serveru", () => {
  it("žádná NEXT_PUBLIC_ proměnná s SECRET/PRIVATE/SERVICE v názvu (ani v .env.example)", () => {
    const vzor = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE)/;
    const nalezy = [...vse, join(KOREN, ".env.example")].filter((s) => vzor.test(readFileSync(s, "utf8"))).map(rel);
    expect(nalezy).toEqual([]);
  });
  it("tajná env zná jen cron route a její serverová logika", () => {
    const nalezy = vse.filter((s) => TAJNE.some((t) => readFileSync(s, "utf8").includes(t))).map(rel).sort();
    expect(nalezy).toEqual([...SMI_ZNAT_TAJEMSTVI].sort());
  });
  it("každý soubor, který čte tajná env, má import \"server-only\"", () => {
    const bez = vse
      .filter((s) => TAJNE.some((t) => readFileSync(s, "utf8").includes(`process.env.${t}`) || readFileSync(s, "utf8").includes(`env.${t}`)))
      .filter((s) => !/^import "server-only";$/m.test(readFileSync(s, "utf8")))
      .map(rel);
    expect(bez).toEqual([]);
    for (const s of SMI_ZNAT_TAJEMSTVI) expect(readFileSync(join(KOREN, s), "utf8")).toMatch(/^import "server-only";$/m);
  });
  it("cron-server neimportuje žádný klientský soubor a žádný klientský soubor neimportuje cron-server", () => {
    const klientske = vse.filter((s) => /^\s*["']use client["']/.test(readFileSync(s, "utf8")));
    expect(klientske.length).toBeGreaterThan(10);
    const importujiServer = klientske.filter((s) => /skupiny\/cron-server|api\/cron/.test(readFileSync(s, "utf8"))).map(rel);
    expect(importujiServer).toEqual([]);
    const route = readFileSync(join(SRC, "app/api/cron/skupiny/route.ts"), "utf8");
    expect(route).toMatch(/export const runtime = "nodejs"/);
  });
});

// Vzory skládané z kódů znaků, aby tenhle soubor sám neobsahoval to, co hledá.
const z = (od: number, do_?: number) =>
  do_ === undefined ? String.fromCharCode(od) : `${String.fromCharCode(od)}-${String.fromCharCode(do_)}`;
const ESCAPE = new RegExp("\\\\" + "u" + "([0-9a-fA-F]{4}|\\{)");
const NEVIDITELNE = new RegExp(`[${z(0xa0)}${z(0x200b, 0x200d)}${z(0xfeff)}]`);
const ZAMENITELNE = new RegExp(`[${z(0x370, 0x3ff)}${z(0x400, 0x4ff)}]`);

describe("zdrojáky", () => {
  it("bez \\u escapů, neviditelných a zaměnitelných znaků (cyrilice, řečtina)", () => {
    const spatne = [...vse, join(KOREN, "public/sw.js"), join(KOREN, "ROZHODNUTI-UI.md")].flatMap((s) => {
      const t = readFileSync(s, "utf8");
      const nalezy: string[] = [];
      if (ESCAPE.test(t)) nalezy.push("\\u escape");
      if (NEVIDITELNE.test(t)) nalezy.push("neviditelný znak");
      if (ZAMENITELNE.test(t)) nalezy.push("řečtina/cyrilice");
      return nalezy.map((n) => `${rel(s)}: ${n}`);
    });
    expect(spatne).toEqual([]);
  });
});
