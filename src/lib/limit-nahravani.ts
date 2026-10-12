// Limit velikosti nahrávaného souboru — na jednom místě.
// Free plán Supabase: bucket bere max 50 MB (52 428 800 B). Po přechodu na Pro jde
// limit zvednout bez změny kódu přes NEXT_PUBLIC_MAX_UPLOAD_MB (vkládá se při buildu).

export const VYCHOZI_LIMIT_MB = 50;
const MB = 1024 * 1024;

/** Limit v MB z env; nesmyslná hodnota → výchozích 50. */
export function limitNahravaniMb(hodnota: string | undefined = process.env.NEXT_PUBLIC_MAX_UPLOAD_MB): number {
  const n = Number(hodnota);
  return hodnota != null && hodnota.trim() !== "" && Number.isFinite(n) && n > 0 ? n : VYCHOZI_LIMIT_MB;
}

export const LIMIT_NAHRAVANI_MB = limitNahravaniMb();
export const LIMIT_NAHRAVANI_B = Math.floor(LIMIT_NAHRAVANI_MB * MB);

function cislo(mb: number): string {
  return mb.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
}

/** Hláška pro soubor nad limit, nebo null. */
export function chybaVelikosti(velikostB: number, limitB: number = LIMIT_NAHRAVANI_B): string | null {
  if (velikostB <= limitB) return null;
  return `Soubor má ${cislo(velikostB / MB)} MB, limit je ${cislo(limitB / MB)} MB. Zkraťte nebo zmenšete video (např. v telefonu při sdílení zvolte nižší kvalitu).`;
}

/** Obrázek se kontroluje až po převodu na JPEG (převod ho může zmenšit). */
export function jeObrazek(soubor: { type: string; name: string }): boolean {
  return soubor.type.startsWith("image/") || /\.(heic|heif)$/i.test(soubor.name);
}

/**
 * Kontrola hned při výběru, před nahráváním: neobrázky nad limit se odmítnou,
 * zbytek dávky jde dál. Obrázky projdou vždy (kontrola až po převodu).
 */
export function rozdelPodleLimitu<T extends { type: string; name: string; size: number }>(
  soubory: T[],
  limitB: number = LIMIT_NAHRAVANI_B,
): { kNahrani: T[]; odmitnute: { soubor: T; hlaska: string }[] } {
  const kNahrani: T[] = [];
  const odmitnute: { soubor: T; hlaska: string }[] = [];
  for (const s of soubory) {
    const chyba = jeObrazek(s) ? null : chybaVelikosti(s.size, limitB);
    if (chyba) odmitnute.push({ soubor: s, hlaska: chyba });
    else kNahrani.push(s);
  }
  return { kNahrani, odmitnute };
}
