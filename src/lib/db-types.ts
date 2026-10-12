// Typy databáze ručně podle SPEC.md (kontrakt s DB agentem).
// Pozor: řádky musí být `type`, ne `interface` — supabase-js je porovnává
// s Record<string, unknown> a interface by tím neprošel.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Platform = "facebook" | "instagram" | "tiktok";
export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";
export type PostFormat = "feed" | "reel" | "story" | "carousel";
export type ConnectionStatus = "connected" | "needs_reconnect" | "not_connected";
export type AttemptOutcome = "success" | "retryable_error" | "fatal_error" | "unknown";
export type SeriesFreq = "weekly" | "monthly";

export type AppUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: "admin" | "editor";
  created_at: string;
};

export type SocialAccount = {
  id: string;
  platform: Platform;
  external_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  color: string;
  timezone: string;
  is_active: boolean;
  connection_status: ConnectionStatus;
  credential_id: string | null;
  linked_page_external_id: string | null;
  quota: Json;
  token_expires_at: string | null;
  last_checked_at: string | null;
  last_check_error: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountTimeSlot = {
  id: string;
  account_id: string;
  weekday: number;
  /** "HH:MM:SS" */
  time_of_day: string;
};

export type MediaAsset = {
  id: string;
  account_id: string | null;
  storage_path: string;
  /** V DB bez not null (jen check) — může být null. */
  kind: "image" | "video" | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  fingerprint: string;
  thumbnail_path: string | null;
  original_name: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
};

export type TextSnippet = {
  id: string;
  account_id: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type PlatformOptions = {
  allow_duplicate?: boolean;
  [key: string]: Json | undefined;
};

export type Post = {
  id: string;
  account_id: string;
  group_id: string | null;
  series_id: string | null;
  copied_from_id: string | null;
  format: PostFormat;
  caption: string;
  link_url: string | null;
  scheduled_at: string | null;
  status: PostStatus;
  platform_options: PlatformOptions;
  content_hash: string | null;
  external_id: string | null;
  external_url: string | null;
  published_at: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  locked_at: string | null;
  lock_token: string | null;
  step: string | null;
  remote_state: Json;
  last_error_code: string | null;
  last_error_message: string | null;
  error_resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PostMedia = {
  post_id: string;
  asset_id: string;
  position: number;
};

export type PostSeries = {
  id: string;
  account_id: string;
  template_post_id: string | null;
  freq: SeriesFreq;
  interval_n: number;
  weekdays: number[] | null;
  month_day: number | null;
  time_of_day: string;
  timezone: string;
  starts_on: string;
  until_on: string | null;
  horizon_weeks: number;
  is_active: boolean;
  /** Není ve SPEC, přidal DB agent (do kdy už jsou výskyty vygenerované). Sloupec existuje vždy. */
  generated_until: string | null;
  created_at: string;
};

export type PublishAttempt = {
  id: string;
  post_id: string;
  started_at: string;
  finished_at: string | null;
  step: string | null;
  outcome: AttemptOutcome | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  error_message_cs: string | null;
  remote_ids: Json | null;
  created_at: string;
};

export type AuditLog = {
  id: number;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Json | null;
  created_at: string;
};


// Typy Skupin jsou kvůli délce v samostatném souboru (stejný kontrakt, migrace 0008).
import type {
  DueGroupBatch,
  FbGroup,
  GroupBatch,
  GroupCampaign,
  GroupCampaignMedia,
  GroupTask,
  PushSubscriptionRow,
} from "./db-types-skupiny";
export type * from "./db-types-skupiny";

/** Pomocník: Insert = povinné sloupce + volitelné ostatní. */
type Ins<Row, Required extends keyof Row> = Pick<Row, Required> & Partial<Omit<Row, Required>>;

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12" };
  public: {
    Tables: {
      app_users: {
        Row: AppUser;
        Insert: Ins<AppUser, "id">;
        Update: Partial<AppUser>;
        Relationships: Rel[];
      };
      social_accounts: {
        Row: SocialAccount;
        Insert: Ins<SocialAccount, "platform" | "external_id" | "name">;
        // Klient smí měnit jen color, timezone, is_active (hlídá trigger v DB).
        Update: Partial<Pick<SocialAccount, "color" | "timezone" | "is_active">>;
        Relationships: Rel[];
      };
      account_time_slots: {
        Row: AccountTimeSlot;
        Insert: Ins<AccountTimeSlot, "account_id" | "weekday" | "time_of_day">;
        Update: Partial<AccountTimeSlot>;
        Relationships: [
          {
            foreignKeyName: "account_time_slots_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      media_assets: {
        Row: MediaAsset;
        Insert: Ins<MediaAsset, "storage_path" | "kind" | "fingerprint">;
        Update: Partial<MediaAsset>;
        Relationships: [
          {
            foreignKeyName: "media_assets_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      text_snippets: {
        Row: TextSnippet;
        Insert: Ins<TextSnippet, "title" | "body">;
        Update: Partial<TextSnippet>;
        Relationships: [
          {
            foreignKeyName: "text_snippets_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: Post;
        Insert: Ins<Post, "account_id">;
        Update: Partial<Post>;
        Relationships: [
          {
            foreignKeyName: "posts_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_series_id_fkey";
            columns: ["series_id"];
            isOneToOne: false;
            referencedRelation: "post_series";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_copied_from_id_fkey";
            columns: ["copied_from_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      post_media: {
        Row: PostMedia;
        Insert: PostMedia;
        Update: Partial<PostMedia>;
        Relationships: [
          {
            foreignKeyName: "post_media_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_media_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      post_series: {
        Row: PostSeries;
        Insert: Ins<PostSeries, "account_id" | "freq" | "time_of_day" | "starts_on">;
        Update: Partial<PostSeries>;
        Relationships: [
          {
            foreignKeyName: "post_series_template_post_id_fkey";
            columns: ["template_post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      publish_attempts: {
        Row: PublishAttempt;
        Insert: Ins<PublishAttempt, "post_id">;
        Update: Partial<PublishAttempt>;
        Relationships: [
          {
            foreignKeyName: "publish_attempts_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      fb_groups: {
        Row: FbGroup;
        Insert: Ins<FbGroup, "name">;
        Update: Partial<FbGroup>;
        Relationships: Rel[];
      };
      group_campaigns: {
        Row: GroupCampaign;
        Insert: Ins<GroupCampaign, "title" | "variants" | "starts_at">;
        Update: Partial<GroupCampaign>;
        Relationships: Rel[];
      };
      group_campaign_media: {
        Row: GroupCampaignMedia;
        Insert: GroupCampaignMedia;
        Update: Partial<GroupCampaignMedia>;
        Relationships: [
          {
            foreignKeyName: "group_campaign_media_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "group_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_campaign_media_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      group_batches: {
        Row: GroupBatch;
        Insert: Ins<GroupBatch, "campaign_id" | "batch_no" | "due_at">;
        Update: Partial<GroupBatch>;
        Relationships: [
          {
            foreignKeyName: "group_batches_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "group_campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      group_tasks: {
        Row: GroupTask;
        Insert: Ins<GroupTask, "campaign_id" | "batch_id" | "group_id" | "variant_index">;
        Update: Partial<GroupTask>;
        Relationships: [
          {
            foreignKeyName: "group_tasks_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "group_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_tasks_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "group_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_tasks_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "fb_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Ins<PushSubscriptionRow, "endpoint" | "p256dh" | "auth">;
        Update: Partial<PushSubscriptionRow>;
        Relationships: Rel[];
      };
      audit_log: {
        Row: AuditLog;
        Insert: Partial<AuditLog>;
        Update: Partial<AuditLog>;
        Relationships: Rel[];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_app_user: { Args: Record<string, never>; Returns: boolean };
      generate_series_occurrences: { Args: { p_series_id: string }; Returns: number };
      create_group_campaign: {
        Args: {
          p_title: string;
          p_variants: string[];
          p_asset_ids: string[];
          p_group_ids: string[];
          p_starts_at: string;
          p_batch_size: number;
          p_batch_interval_minutes: number;
        };
        Returns: string;
      };
      /** jen service_role */
      due_group_batches: { Args: { p_limit?: number }; Returns: DueGroupBatch[] };
      /** jen service_role — vrátí dávce notified_at = null (nedoručené upozornění) */
      release_group_batch: { Args: { p_batch_id: string }; Returns: boolean };
    };
    Enums: {
      platform: Platform;
      post_status: PostStatus;
      post_format: PostFormat;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

/** Příspěvek i s médii v pořadí (výsledek vnořeného selectu). */
export type PostWithMedia = Post & {
  post_media: { position: number; asset_id: string; media_assets: MediaAsset | null }[];
};

export const POST_WITH_MEDIA_SELECT =
  "*, post_media(position, asset_id, media_assets(*))" as const;
