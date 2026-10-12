import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db-types";
import { CHYBI_NASTAVENI, supabaseEnv } from "./env";

export type Klient = SupabaseClient<Database>;

let instance: Klient | null = null;

/**
 * Klient v prohlížeči (přihlášený uživatel, RLS). Volat až v efektech
 * a obsluhách událostí — při prerenderu na serveru nemusí být env.
 * Service role klíč appka nepoužívá nikde.
 */
export function supabase(): Klient {
  if (instance) return instance;
  const env = supabaseEnv();
  if (!env) throw new Error(CHYBI_NASTAVENI);
  instance = createBrowserClient<Database>(env.url, env.anonKey);
  return instance;
}
