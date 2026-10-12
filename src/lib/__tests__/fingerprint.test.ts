import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprintSouboru } from "../fingerprint";

// Záměrně literály ze SPEC, ne konstanty z kódu — jinak by test s kódem „souhlasil“ i po chybě.
const PADESAT_MIB = 50 * 1024 * 1024;
const OSM_MIB = 8 * 1024 * 1024;

const nodeSha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function data(velikost: number): Uint8Array {
  const b = new Uint8Array(velikost);
  for (let i = 0; i < velikost; i += 4096) b[i] = (i / 4096) % 251;
  b[velikost - 1] = 7;
  return b;
}

describe("fingerprint", () => {
  it("malý soubor = sha256 celého", async () => {
    const b = data(1000);
    expect(await fingerprintSouboru(new Blob([b as BlobPart]))).toBe(nodeSha(b));
  });

  it("přesně 50 MiB = ještě celý soubor (bez dvojtečky)", async () => {
    const b = data(PADESAT_MIB);
    const f = await fingerprintSouboru(new Blob([b as BlobPart]));
    expect(f).toBe(nodeSha(b));
    expect(f).not.toContain(":");
  });

  it("nad 50 MiB = sha256 prvních 8 MiB + ':' + velikost", async () => {
    const velikost = PADESAT_MIB + 1;
    const b = data(velikost);
    const f = await fingerprintSouboru(new Blob([b as BlobPart]));
    expect(f).toBe(`${nodeSha(b.subarray(0, OSM_MIB))}:${velikost}`);
  });

  it("velký soubor se liší jen za 8 MiB → stejný fingerprint, jiná velikost → jiný", async () => {
    const a = data(PADESAT_MIB + 10);
    const b = a.slice();
    b[OSM_MIB + 5] = 99;
    const fa = await fingerprintSouboru(new Blob([a as BlobPart]));
    expect(await fingerprintSouboru(new Blob([b as BlobPart]))).toBe(fa);
    const c = data(PADESAT_MIB + 11);
    expect(await fingerprintSouboru(new Blob([c as BlobPart]))).not.toBe(fa);
  });
});
