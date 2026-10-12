// Načtení účtů z Mety (meta-sync) a denní kontrola účtů (check-accounts). Čistá logika.
import { klasifikujChybu } from './chyby.ts';
import type { GraphKlient } from './graph.ts';

// ---------------------------------------------------------------- meta-sync
export interface StrankaMeta {
  id: string;
  name: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
}

/** Sloupce social_accounts, které zapisuje meta-sync. Barvu, pásmo a zapnutí nechává být. */
export interface RadekUctu {
  platform: 'facebook' | 'instagram';
  external_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  connection_status: 'connected';
  credential_id: string;
  linked_page_external_id: string | null;
  last_checked_at: string;
  last_check_error: null;
}

export const POLE_STRANEK = 'id,name,picture{url},instagram_business_account{id,username,profile_picture_url}';

/** GET /me/accounts se stránkováním (kurzor after), nejvýš `maxStran` stran po 100. */
export async function nactiStranky(graph: GraphKlient, token: string, maxStran = 10): Promise<StrankaMeta[]> {
  const vse: StrankaMeta[] = [];
  let after: string | undefined;
  for (let i = 0; i < maxStran; i++) {
    const params: Record<string, string> = { fields: POLE_STRANEK, limit: '100' };
    if (after) params.after = after;
    const r = await graph.get<{ data?: StrankaMeta[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      '/me/accounts', params, token);
    vse.push(...(r.data ?? []));
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return vse;
}

export function prevedNaUcty(stranky: StrankaMeta[], credentialId: string, ted: Date): RadekUctu[] {
  const kdy = ted.toISOString();
  const radky: RadekUctu[] = [];
  for (const s of stranky) {
    radky.push({
      platform: 'facebook',
      external_id: s.id,
      name: s.name,
      username: null,
      avatar_url: s.picture?.data?.url ?? null,
      connection_status: 'connected',
      credential_id: credentialId,
      linked_page_external_id: null,
      last_checked_at: kdy,
      last_check_error: null,
    });
    const ig = s.instagram_business_account;
    if (ig?.id) {
      radky.push({
        platform: 'instagram',
        external_id: ig.id,
        name: ig.username ?? s.name,
        username: ig.username ?? null,
        avatar_url: ig.profile_picture_url ?? null,
        connection_status: 'connected',
        credential_id: credentialId,
        linked_page_external_id: s.id,
        last_checked_at: kdy,
        last_check_error: null,
      });
    }
  }
  return radky;
}

/** Účty, které klíč už nevidí (dřív propojené) → needs_reconnect. Vrací jejich id. */
export function uctyMimoKlic(
  existujici: { id: string; platform: string; external_id: string; connection_status: string }[],
  nove: RadekUctu[],
): string[] {
  const klice = new Set(nove.map((r) => `${r.platform}:${r.external_id}`));
  return existujici
    .filter((u) => (u.platform === 'facebook' || u.platform === 'instagram')
      && u.connection_status === 'connected'
      && !klice.has(`${u.platform}:${u.external_id}`))
    .map((u) => u.id);
}

export const ZPRAVA_MIMO_KLIC = 'Klíč Meta tento účet už nevidí (systémový uživatel ho nemá přiřazený). Propojte ho znovu.';

// ---------------------------------------------------------------- check-accounts
export interface KontrolovanyUcet {
  id: string;
  platform: 'facebook' | 'instagram' | 'tiktok';
  external_id: string;
}

/** Změna řádku social_accounts po kontrole (chybějící klíč = beze změny). */
export interface ZmenaUctu {
  name?: string;
  username?: string | null;
  avatar_url?: string | null;
  quota?: Record<string, unknown>;
  connection_status?: 'connected' | 'needs_reconnect';
  last_checked_at: string;
  last_check_error: string | null;
}

/** Ověří samotný klíč (GET /me). token=true znamená neplatný klíč (Graph 190 apod.). */
export async function overKlic(graph: GraphKlient, token: string): Promise<{ ok: true } | { ok: false; token: boolean; zprava: string }> {
  try {
    await graph.get('/me', { fields: 'id' }, token);
    return { ok: true };
  } catch (e) {
    const k = klasifikujChybu(e);
    return { ok: false, token: k.druh === 'token', zprava: k.zprava };
  }
}

export async function zkontrolujUcet(graph: GraphKlient, token: string, ucet: KontrolovanyUcet, ted: Date): Promise<ZmenaUctu> {
  const kdy = ted.toISOString();
  try {
    if (ucet.platform === 'facebook') {
      const r = await graph.get<{ name?: string; picture?: { data?: { url?: string } } }>(
        `/${ucet.external_id}`, { fields: 'name,picture{url}' }, token);
      return {
        ...(r.name ? { name: r.name } : {}),
        avatar_url: r.picture?.data?.url ?? null,
        connection_status: 'connected',
        last_checked_at: kdy,
        last_check_error: null,
      };
    }
    if (ucet.platform === 'instagram') {
      const r = await graph.get<{ username?: string; name?: string; profile_picture_url?: string }>(
        `/${ucet.external_id}`, { fields: 'username,name,profile_picture_url' }, token);
      const limit = await graph.get<{ data?: { quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }[] }>(
        `/${ucet.external_id}/content_publishing_limit`, { fields: 'quota_usage,config' }, token);
      const radek = limit.data?.[0];
      return {
        ...(r.username || r.name ? { name: (r.username ?? r.name) as string } : {}),
        username: r.username ?? null,
        avatar_url: r.profile_picture_url ?? null,
        quota: {
          ig_used: radek?.quota_usage ?? null,
          ig_limit: radek?.config?.quota_total ?? 100,
          ig_window_seconds: radek?.config?.quota_duration ?? 86400,
          checked_at: kdy,
        },
        connection_status: 'connected',
        last_checked_at: kdy,
        last_check_error: null,
      };
    }
    return { last_checked_at: kdy, last_check_error: 'TikTok zatím není podporovaný.' };
  } catch (e) {
    const k = klasifikujChybu(e);
    if (k.druh === 'token') {
      return { connection_status: 'needs_reconnect', last_checked_at: kdy, last_check_error: k.zprava };
    }
    return { last_checked_at: kdy, last_check_error: k.puvodni ? `${k.zprava} (${k.puvodni})` : k.zprava };
  }
}
