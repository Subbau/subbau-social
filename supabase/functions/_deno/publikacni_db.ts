// Implementace PublikacniDb a Podepisovac nad supabase-js (service_role).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PublikacniDb } from '../_shared/publikace.ts';
import type { Podepisovac } from '../_shared/pravidla.ts';
import type { MediumPostu, Ucet } from '../_shared/typy.ts';

function vyhod(kde: string, error: { message: string } | null): void {
  if (error) throw new Error(`${kde}: ${error.message}`);
}

export function vytvorPublikacniDb(sb: SupabaseClient): PublikacniDb {
  return {
    async nactiUcet(accountId) {
      const { data, error } = await sb.from('social_accounts')
        .select('id, platform, external_id, name, is_active, connection_status, credential_id, linked_page_external_id')
        .eq('id', accountId).maybeSingle();
      vyhod('nactiUcet', error);
      return (data as Ucet | null) ?? null;
    },

    async nactiMedia(postId) {
      const { data, error } = await sb.from('post_media')
        .select('position, media_assets!inner(storage_path, kind, mime_type)')
        .eq('post_id', postId).order('position');
      vyhod('nactiMedia', error);
      type Radek = { position: number; media_assets: { storage_path: string; kind: 'image' | 'video'; mime_type: string | null } };
      return ((data ?? []) as unknown as Radek[]).map((r): MediumPostu => ({
        position: r.position,
        storage_path: r.media_assets.storage_path,
        kind: r.media_assets.kind,
        mime_type: r.media_assets.mime_type,
      }));
    },

    async ziskejToken(credentialId) {
      const { data, error } = await sb.rpc('publisher_get_token', { p_credential_id: credentialId });
      vyhod('ziskejToken', error);
      return (data as string | null) ?? null;
    },

    async ulozPostup(postId, lockToken, step, remoteState) {
      const { data, error } = await sb.rpc('publisher_save_progress', {
        p_post_id: postId, p_lock_token: lockToken, p_step: step, p_remote_state: remoteState,
      });
      vyhod('ulozPostup', error);
      return data === true;
    },

    async dokonci(postId, lockToken, vysledek) {
      const { data, error } = await sb.rpc('publisher_finish', {
        p_post_id: postId, p_lock_token: lockToken, p_result: vysledek,
      });
      vyhod('dokonci', error);
      return data === true;
    },

    async vratClaim(postId, lockToken) {
      const { data, error } = await sb.rpc('publisher_return_claim', { p_post_id: postId, p_lock_token: lockToken });
      vyhod('vratClaim', error);
      return data === true;
    },

    async zapisPokus(pokus) {
      const { error } = await sb.from('publish_attempts').insert(pokus);
      vyhod('zapisPokus', error);
    },

    async oznacUcetKOpojeni(accountId, zprava) {
      const { error } = await sb.from('social_accounts')
        .update({ connection_status: 'needs_reconnect', last_check_error: zprava, last_checked_at: new Date().toISOString() })
        .eq('id', accountId);
      vyhod('oznacUcetKOpojeni', error);
    },
  };
}

export function vytvorPodepisovac(sb: SupabaseClient): Podepisovac {
  return {
    async podepsat(cesta, platnostSekund) {
      const { data, error } = await sb.storage.from('media').createSignedUrl(cesta, platnostSekund);
      if (error || !data?.signedUrl) throw new Error(`Podepsaná URL pro ${cesta}: ${error?.message ?? 'prázdná odpověď'}`);
      return data.signedUrl;
    },
  };
}
