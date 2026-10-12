// Deno vrstva společná Edge funkcím: proměnné prostředí, klient Supabase, ověření
// CRON_SECRET, odpovědi. Čistá logika je v ../_shared (bez Deno API).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { verzeGraph } from '../_shared/graph.ts';

export interface Konfigurace {
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
  cronSecret: string;
  /** Jediné místo, kde se čte GRAPH_API_VERSION (výchozí hodnota je v _shared/graph.ts). */
  graphVerze: string;
}

export function nactiKonfiguraci(): Konfigurace {
  const povinna = (nazev: string): string => {
    const v = Deno.env.get(nazev);
    if (!v) throw new Error(`Chybí proměnná prostředí ${nazev}`);
    return v;
  };
  return {
    supabaseUrl: povinna('SUPABASE_URL'),
    serviceKey: povinna('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    cronSecret: Deno.env.get('CRON_SECRET') ?? '',
    graphVerze: verzeGraph(Deno.env.get('GRAPH_API_VERSION')),
  };
}

export function sluzebniKlient(k: Konfigurace): SupabaseClient {
  return createClient(k.supabaseUrl, k.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function stejne(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let rozdil = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) rozdil |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return rozdil === 0;
}

/** Authorization: Bearer <CRON_SECRET>. Prázdný nebo krátký CRON_SECRET = vždy odmítnout. */
export function overCronSecret(req: Request, cronSecret: string): boolean {
  if (!cronSecret || cronSecret.length < 24) return false;
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m !== null && stejne(m[1].trim(), cronSecret);
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function odpoved(status: number, telo: unknown, hlavicky: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(telo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...hlavicky },
  });
}

export const spanek = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
