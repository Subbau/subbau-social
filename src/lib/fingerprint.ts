// fingerprint média podle SPEC.md:
// hex sha256 celého souboru, je-li ≤ 50 MB; jinak hex sha256(prvních 8 MiB) + ':' + size_bytes.
// „50 MB“ chápeme jako 50 × 1024 × 1024 bajtů (stejně jako 8 MiB) — viz ROZHODNUTI-UI.md.

import { sha256Hex } from "./hash";

export const FINGERPRINT_CELY_DO = 50 * 1024 * 1024;
export const FINGERPRINT_HLAVA = 8 * 1024 * 1024;

/** Minimum, které potřebujeme ze souboru (Blob i File to splňují). */
export type CitelnySoubor = {
  size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
};

export async function fingerprintSouboru(soubor: CitelnySoubor): Promise<string> {
  if (soubor.size <= FINGERPRINT_CELY_DO) {
    return sha256Hex(await soubor.slice(0, soubor.size).arrayBuffer());
  }
  const hlava = await soubor.slice(0, FINGERPRINT_HLAVA).arrayBuffer();
  return `${await sha256Hex(hlava)}:${soubor.size}`;
}
