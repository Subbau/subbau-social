// POST /api/cron/skupiny — volá pg_cron (supabase/setup/06_cron_skupiny.sql) každou minutu.
// Node runtime: web-push a node:crypto. Service klíč a VAPID private jen tady na serveru.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { Database } from "@/lib/db-types";
import { nactiCronEnv, overCronSecret, zpracujDavky, type CronZavislosti } from "@/lib/skupiny/cron-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, telo: Record<string, unknown>): Response {
  return Response.json(telo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.VERCEL_CRON_SECRET;
  if (!secret) return json(500, { error: "Na serveru chybí nastavení VERCEL_CRON_SECRET." });
  if (!overCronSecret(req.headers.get("authorization"), secret)) return json(401, { error: "Nepovolený přístup." });

  const env = nactiCronEnv();
  if ("chybi" in env) return json(500, { error: `Na serveru chybí nastavení: ${env.chybi.join(", ")}.` });

  try {
    const sb = createClient<Database>(env.supabaseUrl, env.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);

    const z: CronZavislosti = {
      dueBatches: async () => {
        const { data, error } = await sb.rpc("due_group_batches", { p_limit: 10 });
        if (error) throw new Error(`due_group_batches: ${error.message}`);
        return data ?? [];
      },
      pocetDavek: async (campaignId) => {
        const { count } = await sb
          .from("group_batches")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId);
        return count ?? 0;
      },
      pocetCekajicich: async (batchId) => {
        const { count } = await sb
          .from("group_tasks")
          .select("id", { count: "exact", head: true })
          .eq("batch_id", batchId)
          .eq("status", "pending");
        return count ?? 0;
      },
      odbery: async () => {
        const { data, error } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth");
        if (error) throw new Error(`push_subscriptions: ${error.message}`);
        return data ?? [];
      },
      posli: async (o, payload) => {
        await webpush.sendNotification({ endpoint: o.endpoint, keys: { p256dh: o.p256dh, auth: o.auth } }, payload, {
          TTL: 6 * 3600,
          urgency: "high",
        });
      },
      smazOdber: async (id) => {
        await sb.from("push_subscriptions").delete().eq("id", id);
      },
      uvolniDavku: async (batchId) => {
        const { data, error } = await sb.rpc("release_group_batch", { p_batch_id: batchId });
        if (error) throw new Error(`release_group_batch: ${error.message}`);
        return data === true;
      },
      log: (zprava) => console.log(zprava),
    };

    const v = await zpracujDavky(z);
    return json(200, { ok: true, ...v });
  } catch (e) {
    // Bez podrobností ven (mohly by obsahovat interní údaje) — jen do logu Vercelu.
    console.error("cron skupiny:", e instanceof Error ? e.message : e);
    return json(500, { error: "Rozeslání upozornění selhalo, podrobnosti jsou v logu serveru." });
  }
}
