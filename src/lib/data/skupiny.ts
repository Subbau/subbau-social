// Dotazy pro Skupiny přes přihlášeného uživatele (RLS is_app_user). Žádný service klíč.

import type { FbGroup, GroupBatch, GroupCampaign, GroupTask, MediaAsset } from "../db-types";
import type { ImportovanaSkupina } from "../skupiny/import";
import { supabase } from "../supabase/client";

export async function nactiSkupiny(): Promise<FbGroup[]> {
  const { data, error } = await supabase().from("fb_groups").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

/** Vloží jednu dávku importu (dávkování a výběr řeší ulozImport). */
export async function vlozDavkuSkupin(davka: ImportovanaSkupina[], sady: string[]): Promise<number> {
  if (davka.length === 0) return 0;
  const { data, error } = await supabase()
    .from("fb_groups")
    .insert(davka.map((p) => ({ name: p.name, url: p.url, sady })))
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function upravSkupinu(
  id: string,
  zmena: Partial<Pick<FbGroup, "name" | "url" | "sady" | "note" | "is_active">>,
): Promise<FbGroup> {
  const { data, error } = await supabase().from("fb_groups").update(zmena).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

export async function smazSkupinu(id: string): Promise<void> {
  const { error } = await supabase().from("fb_groups").delete().eq("id", id);
  if (error) throw error;
}

export async function zalozRozesilku(a: {
  title: string;
  variants: string[];
  assetIds: string[];
  groupIds: string[];
  startsAt: Date;
  batchSize: number;
  intervalMinut: number;
}): Promise<string> {
  const { data, error } = await supabase().rpc("create_group_campaign", {
    p_title: a.title,
    p_variants: a.variants,
    p_asset_ids: a.assetIds,
    p_group_ids: a.groupIds,
    p_starts_at: a.startsAt.toISOString(),
    p_batch_size: a.batchSize,
    p_batch_interval_minutes: a.intervalMinut,
  });
  if (error) throw error;
  return data;
}

export type UkolDnes = GroupTask & {
  fb_groups: Pick<FbGroup, "id" | "name" | "url" | "note"> | null;
  group_batches: Pick<GroupBatch, "id" | "batch_no" | "due_at"> | null;
  group_campaigns: Pick<GroupCampaign, "id" | "title" | "variants" | "status"> | null;
};

/** Všechny úkoly aktivních rozesílek (i hotové — kvůli počítadlům). */
export async function nactiUkolyAktivnich(): Promise<UkolDnes[]> {
  const { data, error } = await supabase()
    .from("group_tasks")
    .select(
      "*, fb_groups(id, name, url, note), group_batches(id, batch_no, due_at), group_campaigns!inner(id, title, variants, status)",
    )
    .eq("group_campaigns.status", "active")
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as unknown as UkolDnes[];
}

export async function nastavStavUkolu(
  id: string,
  z: GroupTask["status"],
  na: GroupTask["status"],
): Promise<void> {
  const { data, error } = await supabase().from("group_tasks").update({ status: na }).eq("id", id).eq("status", z).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Úkol se mezitím změnil — načtěte stránku znovu.");
}

export async function mediaRozesilky(campaignId: string): Promise<MediaAsset[]> {
  const { data, error } = await supabase()
    .from("group_campaign_media")
    .select("position, media_assets(*)")
    .eq("campaign_id", campaignId)
    .order("position");
  if (error) throw error;
  return ((data ?? []) as unknown as { media_assets: MediaAsset | null }[])
    .map((r) => r.media_assets)
    .filter((m): m is MediaAsset => Boolean(m));
}

export type PrehledRozesilky = GroupCampaign & {
  group_tasks: Pick<GroupTask, "status">[];
  group_batches: Pick<GroupBatch, "batch_no" | "due_at" | "notified_at">[];
};

export async function nactiRozesilky(): Promise<PrehledRozesilky[]> {
  const { data, error } = await supabase()
    .from("group_campaigns")
    .select("*, group_tasks(status), group_batches(batch_no, due_at, notified_at)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as PrehledRozesilky[];
}

export async function zrusRozesilku(id: string): Promise<void> {
  const { data, error } = await supabase()
    .from("group_campaigns")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "active")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Rozesílka už není aktivní.");
}
