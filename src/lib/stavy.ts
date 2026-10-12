import type { Platform, PostFormat, PostStatus } from "./db-types";

export const STAVY: Record<PostStatus, { nazev: string; ikona: string; trida: string }> = {
  draft: { nazev: "Koncept", ikona: "✎", trida: "bg-slate-100 text-slate-700 ring-slate-300" },
  scheduled: { nazev: "Naplánováno", ikona: "◷", trida: "bg-blue-50 text-blue-700 ring-blue-300" },
  publishing: { nazev: "Publikuje se", ikona: "⟳", trida: "bg-amber-50 text-amber-800 ring-amber-300" },
  published: { nazev: "Zveřejněno", ikona: "✓", trida: "bg-green-50 text-green-700 ring-green-300" },
  failed: { nazev: "Chyba", ikona: "!", trida: "bg-red-50 text-red-700 ring-red-300" },
};

export const SITE: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export const FORMATY_NAZEV: Record<PostFormat, string> = {
  feed: "Příspěvek",
  reel: "Reel",
  story: "Story",
  carousel: "Karusel",
};

/** Které formáty má síť. TikTok je odložený — nic. */
export function povoleneFormaty(platform: Platform): PostFormat[] {
  if (platform === "facebook") return ["feed", "reel"];
  if (platform === "instagram") return ["feed", "reel", "story", "carousel"];
  return [];
}

/** Ve kterých stavech smí klient příspěvek upravovat a přesouvat. */
export const UPRAVITELNE: PostStatus[] = ["draft", "scheduled", "failed"];

export function lzeUpravit(status: PostStatus): boolean {
  return UPRAVITELNE.includes(status);
}

/** Stavy, které jdou smazat (publishing a published DB nedovolí). */
export function lzeSmazat(status: PostStatus): boolean {
  return status === "draft" || status === "scheduled" || status === "failed";
}
