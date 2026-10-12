// „Zkopírovat týden“: všechny koncepty a naplánované příspěvky zobrazeného
// týdne o 7 dní později jako KONCEPTY s copied_from_id. Nic se samo nepublikuje.

import type { Post } from "./db-types";
import { APP_TZ, posunOMistniDny } from "./cas";

/** Rozhodnutí majitele: kopie týdne se vždy upravují — dialog to musí říct jasně. */
export const VETA_KOPIE_UPRAVIT =
  "Kopie jsou koncepty. Když kopii před naplánováním neupravíte (text nebo grafiku), v den zveřejnění ji appka zastaví jako duplicitu, protože stejný obsah na stejném účtu už vyšel.";

export function textPotvrzeniKopie(pocet: number): string {
  return `Zkopírovat ${pocet} příspěvků o týden později?\n\n${VETA_KOPIE_UPRAVIT}`;
}

export type ZdrojKopie = Pick<
  Post,
  | "id"
  | "account_id"
  | "group_id"
  | "series_id"
  | "format"
  | "caption"
  | "link_url"
  | "scheduled_at"
  | "status"
  | "platform_options"
  | "content_hash"
> & { assetIds: string[] };

export type NovaKopie = {
  zdrojId: string;
  radek: {
    account_id: string;
    group_id: string | null;
    copied_from_id: string;
    format: Post["format"];
    caption: string;
    link_url: string | null;
    scheduled_at: string;
    status: "draft";
    platform_options: Post["platform_options"];
    content_hash: string | null;
  };
  assetIds: string[];
};

export type PlanKopie = { kopie: NovaKopie[]; preskocene: { zdrojId: string; duvod: string }[] };

/**
 * @param prispevky   příspěvky načtené pro týden (může jich být víc, filtruje se tady)
 * @param od,do       rozsah týdne [od, do)
 * @param sablonyIds  id příspěvků, které jsou šablonou opakování (nekopírují se)
 * @param existujici  už existující kopie (copied_from_id + scheduled_at) — druhé kliknutí nic nezdvojí
 */
export function naplanujKopiiTydne(
  prispevky: ZdrojKopie[],
  od: Date,
  do_: Date,
  sablonyIds: Set<string>,
  existujici: { copied_from_id: string | null; scheduled_at: string | null }[],
  noveUuid: () => string,
  timezone: string = APP_TZ,
): PlanKopie {
  const kopie: NovaKopie[] = [];
  const preskocene: PlanKopie["preskocene"] = [];
  const skupiny = new Map<string, string>();
  const uz = new Set(
    existujici
      .filter((e) => e.copied_from_id && e.scheduled_at)
      .map((e) => `${e.copied_from_id}|${new Date(e.scheduled_at as string).getTime()}`),
  );

  const vTydnu = prispevky
    .filter((p) => p.scheduled_at)
    .filter((p) => {
      const t = new Date(p.scheduled_at as string).getTime();
      return t >= od.getTime() && t < do_.getTime();
    })
    .sort((a, b) => (a.scheduled_at as string).localeCompare(b.scheduled_at as string));

  for (const p of vTydnu) {
    if (p.status !== "draft" && p.status !== "scheduled") continue;
    if (sablonyIds.has(p.id)) {
      preskocene.push({ zdrojId: p.id, duvod: "šablona opakování" });
      continue;
    }
    if (p.series_id) {
      preskocene.push({ zdrojId: p.id, duvod: "výskyt opakování (série si další vytvoří sama)" });
      continue;
    }
    const novyCas = posunOMistniDny(p.scheduled_at as string, 7, timezone);
    if (uz.has(`${p.id}|${novyCas.getTime()}`)) {
      preskocene.push({ zdrojId: p.id, duvod: "kopie už existuje" });
      continue;
    }
    let group: string | null = null;
    if (p.group_id) {
      group = skupiny.get(p.group_id) ?? null;
      if (!group) {
        group = noveUuid();
        skupiny.set(p.group_id, group);
      }
    }
    const { allow_duplicate: _bezPovoleni, ...volby } = p.platform_options ?? {};
    void _bezPovoleni;
    kopie.push({
      zdrojId: p.id,
      radek: {
        account_id: p.account_id,
        group_id: group,
        copied_from_id: p.id,
        format: p.format,
        caption: p.caption,
        link_url: p.link_url,
        scheduled_at: novyCas.toISOString(),
        status: "draft",
        platform_options: volby,
        content_hash: p.content_hash,
      },
      assetIds: [...p.assetIds],
    });
  }
  return { kopie, preskocene };
}
