// Práce s příspěvky přes přihlášeného uživatele (RLS). Žádný service role.

import type { MediaAsset, Post, PostSeries, PostStatus, PostWithMedia, SocialAccount } from "../db-types";
import { POST_WITH_MEDIA_SELECT } from "../db-types";
import { contentHash } from "../hash";
import { naplanujKopiiTydne } from "../kopirovani";
import { povoleneFormaty, lzeUpravit } from "../stavy";
import { casProOpakovani } from "../akce";
import { supabase, type Klient } from "../supabase/client";
import { oznamZmenu } from "../udalosti";
import { OKNO_DUPLICITY_MS, rozdelDuplicity, type NalezenaDuplicita } from "../duplicity";
import {
  naplanujUlozeni,
  provedPoVlozeni,
  provedUlozeni,
  type ObsahPrispevku,
  type OperaceUlozeni,
  type StavVDb,
} from "../ukladani";

export const ZMENENO_MEZITIM =
  "Příspěvek se mezitím změnil (možná se právě publikuje). Načtěte stránku znovu.";

/** Média příspěvku seřazená podle position. */
export function serazenaMedia(p: Pick<PostWithMedia, "post_media">): MediaAsset[] {
  return [...(p.post_media ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((pm) => pm.media_assets)
    .filter((m): m is MediaAsset => Boolean(m));
}

export function hashProPrispevek(accountId: string, format: string, caption: string, media: MediaAsset[]) {
  return contentHash(accountId, format, caption, media.map((m) => m.fingerprint));
}

export async function nactiPrispevkyVRozsahu(od: Date, do_: Date): Promise<PostWithMedia[]> {
  const { data, error } = await supabase()
    .from("posts")
    .select(POST_WITH_MEDIA_SELECT)
    .gte("scheduled_at", od.toISOString())
    .lt("scheduled_at", do_.toISOString())
    .order("scheduled_at");
  if (error) throw error;
  return (data ?? []) as unknown as PostWithMedia[];
}

export async function nactiPrispevek(id: string): Promise<PostWithMedia | null> {
  const { data, error } = await supabase().from("posts").select(POST_WITH_MEDIA_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as PostWithMedia) ?? null;
}

export async function nactiSkupinu(groupId: string): Promise<PostWithMedia[]> {
  const { data, error } = await supabase()
    .from("posts")
    .select(POST_WITH_MEDIA_SELECT)
    .eq("group_id", groupId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as PostWithMedia[];
}

export async function nactiSerie(): Promise<PostSeries[]> {
  const { data, error } = await supabase().from("post_series").select("*");
  if (error) throw error;
  return data ?? [];
}

export function idSablon(serie: PostSeries[]): Set<string> {
  return new Set(serie.map((s) => s.template_post_id).filter((x): x is string => Boolean(x)));
}

/** Nahradí média příspěvku (pořadí = pořadí v poli). */
export async function nastavMedia(postId: string, assetIds: string[]): Promise<void> {
  const sb = supabase();
  const { error: e1 } = await sb.from("post_media").delete().eq("post_id", postId);
  if (e1) throw e1;
  if (assetIds.length === 0) return;
  const { error: e2 } = await sb
    .from("post_media")
    .insert(assetIds.map((asset_id, position) => ({ post_id: postId, asset_id, position })));
  if (e2) throw e2;
}

/** Změna řádku jen když je pořád ve stavu, který známe (jinak hlásí změnu). */
async function zmenSeStavem(id: string, ocekavany: PostStatus, zmena: Partial<Post>): Promise<void> {
  const { data, error } = await supabase()
    .from("posts")
    .update(zmena)
    .eq("id", id)
    .eq("status", ocekavany)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(ZMENENO_MEZITIM);
}

export type UkladanaVarianta = {
  id: string | null;
  /** stav v DB (u nového 'draft') */
  status: PostStatus;
  account_id: string;
  group_id: string | null;
  copied_from_id?: string | null;
  format: Post["format"];
  caption: string;
  link_url: string | null;
  scheduled_at: string | null;
  platform_options: Post["platform_options"];
  media: MediaAsset[];
};

const OPERACE: OperaceUlozeni = {
  zmenStav: (id, ocekavany, novy) => zmenSeStavem(id, ocekavany, { status: novy }),
  zmenObsah: (id, ocekavany, obsah) => zmenSeStavem(id, ocekavany, obsah),
  nastavMedia,
};

/** Aktuální stav příspěvku v DB (obsah + seřazená média) pro porovnání před uložením. */
async function nactiStavVDb(id: string): Promise<StavVDb> {
  const { data, error } = await supabase()
    .from("posts")
    .select("status, account_id, group_id, format, caption, link_url, scheduled_at, platform_options, content_hash, post_media(asset_id, position)")
    .eq("id", id)
    .single();
  if (error) throw error;
  const { status, post_media, ...obsah } = data as unknown as Post & { post_media: { asset_id: string; position: number }[] };
  return {
    status,
    obsah: {
      account_id: obsah.account_id,
      group_id: obsah.group_id,
      format: obsah.format,
      caption: obsah.caption,
      link_url: obsah.link_url,
      scheduled_at: obsah.scheduled_at,
      platform_options: obsah.platform_options ?? {},
      content_hash: obsah.content_hash,
    },
    assetIds: [...(post_media ?? [])].sort((x, y) => x.position - y.position).map((m) => m.asset_id),
  };
}

/**
 * Uloží variantu a nastaví cílový stav. Mění jen to, co se opravdu změnilo
 * (viz src/lib/ukladani.ts — přepsání médií by v DB smazalo remote_state).
 * Když uložení naplánovaného příspěvku selže v půlce, vyhodí UlozeniNedokonceno
 * (příspěvek je pak v DB koncept).
 */
export async function ulozVariantu(v: UkladanaVarianta, cil: "draft" | "scheduled"): Promise<string> {
  const sb = supabase();
  const content_hash = await hashProPrispevek(v.account_id, v.format, v.caption, v.media);
  const obsah: ObsahPrispevku = {
    account_id: v.account_id,
    group_id: v.group_id,
    format: v.format,
    caption: v.caption,
    link_url: v.link_url || null,
    scheduled_at: v.scheduled_at,
    platform_options: v.platform_options,
    content_hash,
  };
  const assetIds = v.media.map((m) => m.id);

  if (!v.id) {
    const { data, error } = await sb
      .from("posts")
      .insert({ ...obsah, copied_from_id: v.copied_from_id ?? null, status: "draft" })
      .select("id")
      .single();
    if (error) throw error;
    try {
      await provedPoVlozeni(data.id, assetIds, cil, OPERACE);
    } finally {
      oznamZmenu();
    }
    return data.id;
  }

  if (!lzeUpravit(v.status)) throw new Error("Tento příspěvek už nejde upravit.");
  const vDb = await nactiStavVDb(v.id);
  if (vDb.status !== v.status) throw new Error(ZMENENO_MEZITIM);
  try {
    await provedUlozeni(v.id, naplanujUlozeni(vDb, { obsah, assetIds }, cil), OPERACE);
  } finally {
    oznamZmenu();
  }
  return v.id;
}

/** Přetažení v kalendáři. U chyby se příspěvek zároveň znovu zařadí. */
export async function presunPrispevek(p: Post, novyCas: Date): Promise<void> {
  if (!lzeUpravit(p.status)) throw new Error("Tento příspěvek nejde přesunout.");
  const zmena: Partial<Post> = { scheduled_at: novyCas.toISOString() };
  if (p.status === "failed") zmena.status = "scheduled";
  await zmenSeStavem(p.id, p.status, zmena);
  oznamZmenu();
}

/** Jen změna času (hromadný posun v Seznamu) — stav zůstává. */
export async function zmenCas(p: Pick<Post, "id" | "status">, novyCas: Date): Promise<void> {
  if (!lzeUpravit(p.status)) throw new Error("Tento příspěvek nejde přesunout.");
  await zmenSeStavem(p.id, p.status, { scheduled_at: novyCas.toISOString() });
}

/** „Zkusit znovu“: scheduled, čas = max(původní, teď + 2 min). */
export async function zkusitZnovu(p: Pick<Post, "id" | "status" | "scheduled_at">): Promise<void> {
  if (p.status !== "failed") throw new Error("Znovu jde pustit jen příspěvek s chybou.");
  await zmenSeStavem(p.id, "failed", {
    status: "scheduled",
    scheduled_at: casProOpakovani(p.scheduled_at).toISOString(),
  });
  oznamZmenu();
}

export const ZMENIL_STAV = "Příspěvek už mezitím změnil stav.";

/**
 * „Vyřešeno“ jen u příspěvku, který je pořád ve stavu chyba — zastaralá stránka
 * nesmí označit příspěvek, který už mezitím někdo znovu naplánoval.
 */
export async function oznacVyresene(id: string, sb: Klient = supabase()): Promise<void> {
  const { data, error } = await sb
    .from("posts")
    .update({ error_resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(ZMENIL_STAV);
  oznamZmenu();
}

export async function prevedNaKoncept(p: Pick<Post, "id" | "status">): Promise<void> {
  if (p.status !== "scheduled" && p.status !== "failed") return;
  await zmenSeStavem(p.id, p.status, { status: "draft" });
}

export async function smazPrispevek(p: Pick<Post, "id" | "status">): Promise<void> {
  const { error } = await supabase().from("posts").delete().eq("id", p.id).eq("status", p.status);
  if (error) throw error;
  oznamZmenu();
}

/** Duplikát jako nový koncept (může jít na jiný účet i čas). Vrací id. */
export async function duplikuj(
  zdroj: Pick<Post, "id" | "format" | "caption" | "link_url" | "platform_options">,
  media: MediaAsset[],
  ucet: SocialAccount,
  kdy: Date | null,
): Promise<string> {
  const format = povoleneFormaty(ucet.platform).includes(zdroj.format) ? zdroj.format : "feed";
  const { allow_duplicate: _povoleni, ...volby } = zdroj.platform_options ?? {};
  void _povoleni;
  const content_hash = await hashProPrispevek(ucet.id, format, zdroj.caption, media);
  const { data, error } = await supabase()
    .from("posts")
    .insert({
      account_id: ucet.id,
      copied_from_id: zdroj.id,
      format,
      caption: zdroj.caption,
      link_url: zdroj.link_url,
      scheduled_at: kdy ? kdy.toISOString() : null,
      status: "draft",
      platform_options: volby,
      content_hash,
    })
    .select("id")
    .single();
  if (error) throw error;
  await nastavMedia(data.id, media.map((m) => m.id));
  return data.id;
}

/** Zkopíruje draft/scheduled příspěvky týdne o 7 dní později jako koncepty. */
export async function kopirujTyden(
  od: Date,
  do_: Date,
  prispevky: PostWithMedia[],
  sablony: Set<string>,
  timezone: string,
): Promise<{ vytvoreno: number; preskoceno: { zdrojId: string; duvod: string }[] }> {
  const sb = supabase();
  const zdroje = prispevky.map((p) => ({ ...p, assetIds: serazenaMedia(p).map((m) => m.id) }));
  const ids = zdroje.map((z) => z.id);
  let existujici: { copied_from_id: string | null; scheduled_at: string | null }[] = [];
  if (ids.length) {
    const { data, error } = await sb.from("posts").select("copied_from_id, scheduled_at").in("copied_from_id", ids);
    if (error) throw error;
    existujici = data ?? [];
  }
  const plan = naplanujKopiiTydne(zdroje, od, do_, sablony, existujici, () => crypto.randomUUID(), timezone);
  let vytvoreno = 0;
  for (const k of plan.kopie) {
    const { data, error } = await sb.from("posts").insert(k.radek).select("id").single();
    if (error) throw error;
    await nastavMedia(data.id, k.assetIds);
    vytvoreno++;
  }
  return { vytvoreno, preskoceno: plan.preskocene };
}

/**
 * Kandidáti na duplicitu: stejný účet + content_hash. Bere se široce (vše, co se za
 * 30 dní publikovalo, změnilo, je naplánované nebo právě publikuje); co z toho opravdu
 * vadí, rozhodne čistá funkce rozdelDuplicity (stejné pravidlo jako claim_due_posts).
 */
export async function najdiDuplicity(
  accountId: string,
  hash: string,
  ja: { id: string | null; series_id: string | null },
  ted: Date = new Date(),
): Promise<NalezenaDuplicita[]> {
  const od = new Date(ted.getTime() - OKNO_DUPLICITY_MS).toISOString();
  let q = supabase()
    .from("posts")
    .select("id, status, scheduled_at, published_at, updated_at, created_at, caption, external_url, last_error_code, series_id")
    .eq("account_id", accountId)
    .eq("content_hash", hash)
    .or(`status.eq.publishing,published_at.gte.${od},updated_at.gte.${od},scheduled_at.gte.${od},created_at.gte.${od}`)
    .limit(50);
  if (ja.id) q = q.neq("id", ja.id);
  const { data, error } = await q;
  if (error) throw error;
  return rozdelDuplicity(data ?? [], ja, ted);
}
