// Společné typy publikační logiky. Čistý TypeScript — žádné Deno API, nic z Node.

export type Platforma = 'facebook' | 'instagram' | 'tiktok';
export type FormatPrispevku = 'feed' | 'reel' | 'story' | 'carousel';
export type StavPrispevku = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

/** Rozpracovaný stav na platformě (posts.remote_state). Ukládá se po každém kroku. */
export interface RemoteState {
  // Instagram
  container_id?: string;
  container_created_at?: string;
  children?: string[];
  carousel_started_at?: string;
  publish_sent_at?: string;
  media_id?: string;
  permalink?: string | null;
  // Facebook
  photo_ids?: string[];
  video_id?: string;
  upload_url?: string;
  uploaded?: boolean;
  post_id?: string;
  post_url?: string | null;
  [klic: string]: unknown;
}

/** Řádek posts tak, jak ho vrací claim_due_posts. */
export interface Prispevek {
  id: string;
  account_id: string;
  series_id: string | null;
  format: FormatPrispevku;
  caption: string;
  link_url: string | null;
  scheduled_at: string | null;
  status: StavPrispevku;
  platform_options: Record<string, unknown>;
  content_hash: string | null;
  attempt_count: number;
  lock_token: string;
  step: string | null;
  remote_state: RemoteState;
}

export interface Ucet {
  id: string;
  platform: Platforma;
  external_id: string;
  name: string;
  is_active: boolean;
  connection_status: 'connected' | 'needs_reconnect' | 'not_connected';
  credential_id: string | null;
  linked_page_external_id: string | null;
}

/** Médium příspěvku v pořadí position (z post_media + media_assets). */
export interface MediumPostu {
  position: number;
  storage_path: string;
  kind: 'image' | 'video';
  mime_type: string | null;
}

export interface PodepsaneMedium extends MediumPostu {
  url: string;
}

/** Co se zapíše do posts přes publisher_finish (chybějící klíč = beze změny). */
export interface ZapisVysledku {
  status: 'published' | 'scheduled' | 'failed' | 'publishing';
  step?: string | null;
  remote_state?: RemoteState;
  external_id?: string | null;
  external_url?: string | null;
  next_attempt_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
}

export type VysledekPokusu = 'success' | 'retryable_error' | 'fatal_error' | 'unknown';

/** Řádek publish_attempts. */
export interface Pokus {
  post_id: string;
  started_at: string;
  finished_at: string;
  step: string | null;
  outcome: VysledekPokusu;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  error_message_cs: string | null;
  remote_ids: Record<string, unknown>;
}
