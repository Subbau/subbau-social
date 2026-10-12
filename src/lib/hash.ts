// content_hash podle SPEC.md:
// hex sha256( account_id + '|' + format + '|' + normalize(caption) + '|' + fingerprinty médií v pořadí position spojené ',' )
// normalize = trim, sjednocení bílých znaků na jednu mezeru, lowercase (toLocaleLowerCase('cs-CZ')).

function naHex(buffer: ArrayBuffer): string {
  const bajty = new Uint8Array(buffer);
  let vysledek = "";
  for (let i = 0; i < bajty.length; i++) vysledek += bajty[i].toString(16).padStart(2, "0");
  return vysledek;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("Prohlížeč nepodporuje crypto.subtle (stránka musí běžet přes https).");
  }
  return c.subtle;
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  let vstup: ArrayBuffer;
  if (typeof data === "string") {
    const kod = new TextEncoder().encode(data);
    vstup = kod.buffer.slice(kod.byteOffset, kod.byteOffset + kod.byteLength) as ArrayBuffer;
  } else if (data instanceof Uint8Array) {
    vstup = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } else {
    vstup = data;
  }
  return naHex(await subtle().digest("SHA-256", vstup));
}

export function normalizeCaption(caption: string): string {
  return caption.trim().replace(/\s+/g, " ").toLocaleLowerCase("cs-CZ");
}

export function contentHashVstup(
  accountId: string,
  format: string,
  caption: string,
  fingerprinty: string[],
): string {
  return `${accountId}|${format}|${normalizeCaption(caption)}|${fingerprinty.join(",")}`;
}

/** Fingerprinty musí být seřazené podle post_media.position. */
export function contentHash(
  accountId: string,
  format: string,
  caption: string,
  fingerprinty: string[],
): Promise<string> {
  return sha256Hex(contentHashVstup(accountId, format, caption, fingerprinty));
}
