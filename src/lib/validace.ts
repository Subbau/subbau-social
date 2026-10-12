// Kontroly příspěvku před naplánováním. Blokující = nejde naplánovat,
// varování = jde, ale ať o tom majitel ví.

import type { Platform, PostFormat } from "./db-types";
import { povoleneFormaty, FORMATY_NAZEV } from "./stavy";

export const LIMIT_ZNAKU: Record<Platform, number> = {
  instagram: 2200,
  facebook: 63206,
  tiktok: 2200,
};
export const IG_MAX_HASHTAGU = 30;
export const IG_POMER_MIN = 4 / 5; // 0.8 (na výšku)
export const IG_POMER_MAX = 1.91; // na šířku
export const IG_MAX_OBRAZEK_BAJTU = 8 * 1024 * 1024;
export const FB_REEL_MIN_S = 3;
export const FB_REEL_MAX_S = 90;
export const KARUSEL_MIN = 2;
export const KARUSEL_MAX = 10;

export type MediumProKontrolu = {
  /** media_assets.kind smí být v DB null (neznámý druh). */
  kind: "image" | "video" | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  original_name?: string | null;
};

export type VariantaProKontrolu = {
  platform: Platform;
  format: PostFormat;
  caption: string;
  link_url: string | null;
  media: MediumProKontrolu[];
  scheduledAt: Date | null;
};

export type VysledekKontroly = { blokujici: string[]; varovani: string[] };

/** Počet znaků jako „znaky“ (kódové body), ne UTF-16 jednotky — emoji = 1. */
export function pocetZnaku(text: string): number {
  return Array.from(text).length;
}

export function hashtagy(text: string): string[] {
  return text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

export function pocetHashtagu(text: string): number {
  return hashtagy(text).length;
}

function nazevMedia(m: MediumProKontrolu, i: number): string {
  return m.original_name ? `„${m.original_name}“` : `č. ${i + 1}`;
}

export function zkontrolujVariantu(
  v: VariantaProKontrolu,
  /** "opakovani" = jako naplánování, ale bez kontroly času (čas určuje série). */
  rezim: "koncept" | "naplanovat" | "opakovani",
  ted: Date = new Date(),
): VysledekKontroly {
  const blokujici: string[] = [];
  const varovani: string[] = [];
  const pocetMedii = v.media.length;
  const videa = v.media.filter((m) => m.kind === "video");
  const obrazky = v.media.filter((m) => m.kind === "image");
  v.media.forEach((m, i) => {
    if (m.kind == null) varovani.push(`U média ${nazevMedia(m, i)} neznáme, jestli je to obrázek, nebo video.`);
  });

  if (v.platform === "tiktok") {
    blokujici.push("TikTok zatím není podporovaný.");
    return { blokujici, varovani };
  }

  if (!povoleneFormaty(v.platform).includes(v.format)) {
    blokujici.push(`${FORMATY_NAZEV[v.format]} na této síti nejde.`);
  }

  // ---- text ----
  const limit = LIMIT_ZNAKU[v.platform];
  const znaky = pocetZnaku(v.caption);
  if (znaky > limit) {
    blokujici.push(`Text je moc dlouhý: ${znaky} znaků, limit je ${limit}.`);
  }
  if (v.platform === "instagram") {
    const h = pocetHashtagu(v.caption);
    if (h > IG_MAX_HASHTAGU) {
      blokujici.push(`Instagram dovolí nejvýš ${IG_MAX_HASHTAGU} hashtagů, v textu je ${h}.`);
    }
    if (v.link_url) {
      varovani.push("Instagram odkaz u příspěvku nezobrazí (není klikací).");
    }
  }

  // ---- média podle formátu ----
  if (v.platform === "instagram") {
    if (v.format === "feed") {
      if (pocetMedii === 0) blokujici.push("Příspěvek na Instagram potřebuje obrázek nebo video.");
      if (pocetMedii > 1) blokujici.push("Víc médií najednou jde jen jako karusel — přepněte formát.");
      if (videa.length > 0 && pocetMedii === 1) {
        varovani.push("Video v příspěvku Instagram zveřejní jako reel.");
      }
    }
    if (v.format === "carousel") {
      if (pocetMedii < KARUSEL_MIN || pocetMedii > KARUSEL_MAX) {
        blokujici.push(`Karusel potřebuje ${KARUSEL_MIN}–${KARUSEL_MAX} položek, teď jich je ${pocetMedii}.`);
      }
    }
    if (v.format === "reel") {
      if (pocetMedii !== 1 || videa.length !== 1) blokujici.push("Reel = právě jedno video.");
    }
    if (v.format === "story") {
      if (pocetMedii !== 1) blokujici.push("Story = právě jeden obrázek nebo video.");
    }
    obrazky.forEach((m) => {
      const i = v.media.indexOf(m);
      if (m.mime_type && m.mime_type !== "image/jpeg") {
        blokujici.push(`Instagram bere jen JPEG — obrázek ${nazevMedia(m, i)} je ${m.mime_type}.`);
      }
      if (m.size_bytes != null && m.size_bytes > IG_MAX_OBRAZEK_BAJTU) {
        blokujici.push(`Obrázek ${nazevMedia(m, i)} je větší než 8 MB, Instagram ho nepřijme.`);
      }
      if (v.format === "story") return; // story má vlastní poměr 9:16, ořízne se
      if (!m.width || !m.height) {
        varovani.push(`U obrázku ${nazevMedia(m, i)} neznáme rozměry, poměr stran nejde ověřit.`);
        return;
      }
      const pomer = m.width / m.height;
      if (pomer < IG_POMER_MIN - 0.005 || pomer > IG_POMER_MAX + 0.005) {
        varovani.push(
          `Obrázek ${nazevMedia(m, i)} má poměr ${pomer.toFixed(2)} — Instagram chce 4:5 až 1,91:1 a ořízne ho.`,
        );
      }
    });
  }

  if (v.platform === "facebook") {
    if (v.format === "feed" && pocetMedii === 0 && v.caption.trim() === "" && !v.link_url) {
      blokujici.push("Prázdný příspěvek — přidejte text, odkaz nebo médium.");
    }
    if (v.format === "feed" && videa.length > 0 && pocetMedii > 1) {
      blokujici.push("Facebook příspěvek může mít víc fotek, nebo jedno video — ne obojí.");
    }
    if (v.format === "reel") {
      if (pocetMedii !== 1 || videa.length !== 1) {
        blokujici.push("Reel = právě jedno video.");
      } else {
        const d = videa[0].duration_seconds;
        if (d == null) {
          varovani.push("Neznáme délku videa, nejde ověřit 3–90 s pro reel.");
        } else if (d < FB_REEL_MIN_S || d > FB_REEL_MAX_S) {
          varovani.push(`Facebook reel má mít ${FB_REEL_MIN_S}–${FB_REEL_MAX_S} s, video má ${Math.round(d)} s.`);
        }
      }
    }
  }

  // ---- čas ----
  if (rezim === "naplanovat") {
    if (!v.scheduledAt) {
      blokujici.push("Chybí datum a čas zveřejnění.");
    } else if (v.scheduledAt.getTime() <= ted.getTime()) {
      blokujici.push("Čas zveřejnění je v minulosti.");
    }
  }

  return { blokujici, varovani };
}
