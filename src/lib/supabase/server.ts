import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "../db-types";
import { supabaseEnv } from "./env";

/** Serverový klient pro jeden požadavek, nebo null, když chybí env. */
export async function supabaseServer(): Promise<SupabaseClient<Database> | null> {
  const env = supabaseEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(seznam) {
        try {
          seznam.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Ze Server Component cookies nastavit nejdou — obnovu session dělá proxy.
        }
      },
    },
  });
}
