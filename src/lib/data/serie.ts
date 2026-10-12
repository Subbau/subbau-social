import type { Post } from "../db-types";
import type { NovaSerie } from "../opakovani";
import { supabase, type Klient } from "../supabase/client";
import { oznamZmenu } from "../udalosti";

/**
 * Založí opakování: šablona zůstane konceptem, výskyty vytvoří DB
 * (generate_series_occurrences) jako naplánované.
 * Opakování je záměr → šabloně se nastaví allow_duplicate, jinak by
 * publikační smyčka každý další výskyt se stejným textem odmítla jako duplicitu.
 */
export async function zalozSerii(
  sablona: Pick<Post, "id" | "status" | "platform_options">,
  serie: NovaSerie,
): Promise<{ seriesId: string; vytvoreno: number }> {
  const sb = supabase();
  if (sablona.status !== "draft") throw new Error("Šablona opakování musí být koncept — uložte ho jako koncept.");
  const { error: e0 } = await sb
    .from("posts")
    .update({ platform_options: { ...(sablona.platform_options ?? {}), allow_duplicate: true } })
    .eq("id", sablona.id)
    .eq("status", "draft");
  if (e0) throw e0;
  const { data, error } = await sb.from("post_series").insert(serie).select("id").single();
  if (error) throw error;
  const { data: pocet, error: e2 } = await sb.rpc("generate_series_occurrences", { p_series_id: data.id });
  if (e2) throw e2;
  oznamZmenu();
  return { seriesId: data.id, vytvoreno: pocet ?? 0 };
}

/**
 * Ukončí opakování a smaže VŠECHNY naplánované výskyty série — i ty, jejichž čas už
 * minul a čekají na další pokus (next_attempt_at). Zveřejněné, publikující se,
 * chybové a koncepty zůstanou. Vrací počet smazaných.
 */
export async function ukonciSerii(seriesId: string, sb: Klient = supabase()): Promise<number> {
  const { error } = await sb.from("post_series").update({ is_active: false }).eq("id", seriesId);
  if (error) throw error;
  const { data, error: e2 } = await sb
    .from("posts")
    .delete()
    .eq("series_id", seriesId)
    .eq("status", "scheduled")
    .select("id");
  if (e2) throw e2;
  oznamZmenu();
  return data?.length ?? 0;
}

export async function nactiSeriiProPrispevek(postId: string, seriesId: string | null) {
  const sb = supabase();
  if (seriesId) {
    const { data } = await sb.from("post_series").select("*").eq("id", seriesId).maybeSingle();
    return data;
  }
  const { data } = await sb
    .from("post_series")
    .select("*")
    .eq("template_post_id", postId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
