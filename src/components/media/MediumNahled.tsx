"use client";

import type { MediaAsset } from "@/lib/db-types";

/** Malý náhled média (podepsaná URL náhledu, u obrázku bez náhledu originál). */
export function MediumNahled({
  asset,
  urls,
  className = "h-full w-full",
}: {
  asset: Pick<MediaAsset, "kind" | "thumbnail_path" | "storage_path" | "original_name" | "duration_seconds">;
  urls: Record<string, string>;
  className?: string;
}) {
  const cesta = asset.thumbnail_path ?? (asset.kind === "image" ? asset.storage_path : null);
  const url = cesta ? urls[cesta] : undefined;
  return (
    <div className={`relative overflow-hidden bg-slate-200 ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- podepsané URL z privátního bucketu, next/image by je cacheoval
        <img src={url} alt={asset.original_name ?? ""} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
          {asset.kind === "video" ? "▶ video" : "obrázek"}
        </div>
      )}
      {asset.kind === "video" && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
          ▶ {asset.duration_seconds != null ? `${Math.round(asset.duration_seconds)} s` : ""}
        </span>
      )}
    </div>
  );
}
