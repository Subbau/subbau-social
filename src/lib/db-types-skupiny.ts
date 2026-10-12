// ---------- Skupiny (SPEC-SKUPINY.md, migrace 0008_skupiny.sql) ----------

export type FbGroup = {
  id: string;
  name: string;
  url: string | null;
  sady: string[];
  is_active: boolean;
  note: string | null;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignStatus = "active" | "done" | "cancelled";

export type GroupCampaign = {
  id: string;
  title: string;
  variants: string[];
  starts_at: string;
  batch_size: number;
  batch_interval_minutes: number;
  status: CampaignStatus;
  created_by: string | null;
  created_at: string;
};

export type GroupCampaignMedia = {
  campaign_id: string;
  asset_id: string;
  position: number;
};

export type GroupBatch = {
  id: string;
  campaign_id: string;
  batch_no: number;
  due_at: string;
  notified_at: string | null;
};

export type GroupTaskStatus = "pending" | "sent" | "skipped";

export type GroupTask = {
  id: string;
  campaign_id: string;
  batch_id: string;
  group_id: string;
  variant_index: number;
  status: GroupTaskStatus;
  done_at: string | null;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
};

/** Řádek z due_group_batches (jen service_role) — přesně podle 0008_skupiny.sql. */
export type DueGroupBatch = {
  batch_id: string;
  campaign_id: string;
  campaign_title: string;
  batch_no: number;
  batch_count: number;
  due_at: string;
  pending_count: number;
};
