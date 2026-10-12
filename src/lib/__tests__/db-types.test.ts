// Nullability typů proti migracím DB agenta (supabase/migrations/0001_zaklad.sql).
// Tohle hlídá hlavně `tsc --noEmit` (expectTypeOf je kontrola při překladu);
// vitest jen ověří, že soubor jde spustit.
import { describe, expectTypeOf, it } from "vitest";
import type {
  AccountTimeSlot,
  AppUser,
  AuditLog,
  MediaAsset,
  Post,
  PostMedia,
  PostSeries,
  PublishAttempt,
  SocialAccount,
  TextSnippet,
} from "../db-types";

describe("db-types odpovídají migracím", () => {
  it("media_assets", () => {
    expectTypeOf<MediaAsset["kind"]>().toEqualTypeOf<"image" | "video" | null>();
    expectTypeOf<MediaAsset["account_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<MediaAsset["fingerprint"]>().toEqualTypeOf<string>();
    expectTypeOf<MediaAsset["tags"]>().toEqualTypeOf<string[]>();
    expectTypeOf<MediaAsset["mime_type"]>().toEqualTypeOf<string | null>();
    expectTypeOf<MediaAsset["duration_seconds"]>().toEqualTypeOf<number | null>();
  });
  it("publish_attempts", () => {
    expectTypeOf<PublishAttempt["started_at"]>().toEqualTypeOf<string>();
    expectTypeOf<PublishAttempt["finished_at"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PublishAttempt["outcome"]>().toEqualTypeOf<
      "success" | "retryable_error" | "fatal_error" | "unknown" | null
    >();
    expectTypeOf<PublishAttempt["created_at"]>().toEqualTypeOf<string>();
  });
  it("post_series", () => {
    expectTypeOf<PostSeries["generated_until"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PostSeries["template_post_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PostSeries["weekdays"]>().toEqualTypeOf<number[] | null>();
    expectTypeOf<PostSeries["month_day"]>().toEqualTypeOf<number | null>();
    expectTypeOf<PostSeries["until_on"]>().toEqualTypeOf<string | null>();
  });
  it("posts", () => {
    expectTypeOf<Post["scheduled_at"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Post["caption"]>().toEqualTypeOf<string>();
    expectTypeOf<Post["content_hash"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Post["attempt_count"]>().toEqualTypeOf<number>();
    expectTypeOf<Post["error_resolved_at"]>().toEqualTypeOf<string | null>();
  });
  it("ostatní tabulky", () => {
    expectTypeOf<AppUser["email"]>().toEqualTypeOf<string | null>();
    expectTypeOf<SocialAccount["username"]>().toEqualTypeOf<string | null>();
    expectTypeOf<SocialAccount["credential_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<AccountTimeSlot["time_of_day"]>().toEqualTypeOf<string>();
    expectTypeOf<TextSnippet["account_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PostMedia["position"]>().toEqualTypeOf<number>();
    expectTypeOf<AuditLog["action"]>().toEqualTypeOf<string>();
    expectTypeOf<AuditLog["entity_id"]>().toEqualTypeOf<string | null>();
  });
});
