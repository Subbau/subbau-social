"use client";

import type { MediaAsset, PostFormat, SocialAccount } from "@/lib/db-types";
import { usePodepsane } from "@/lib/data/podpisy";
import { FORMATY_NAZEV } from "@/lib/stavy";
import { hezkyCas } from "@/lib/cas";

/** Zjednodušený náhled, jak bude příspěvek vypadat. */
export function Nahled({
  ucet,
  format,
  caption,
  linkUrl,
  media,
  kdy,
}: {
  ucet: SocialAccount;
  format: PostFormat;
  caption: string;
  linkUrl: string;
  media: MediaAsset[];
  kdy: Date | null;
}) {
  const prvni = media[0];
  const cesta = prvni ? (prvni.kind === "image" ? prvni.storage_path : prvni.thumbnail_path) : null;
  const urls = usePodepsane([cesta]);
  const url = cesta ? urls[cesta] : undefined;
  const ig = ucet.platform === "instagram";
  const svisle = format === "reel" || format === "story";
  const text = ig && caption.length > 125 ? `${caption.slice(0, 125)}… více` : caption;

  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
      <div className="flex items-center gap-2 p-2">
        {ucet.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar z Mety
          <img src={ucet.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="h-8 w-8 rounded-full" style={{ background: ucet.color }} />
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold">{ig ? ucet.username ?? ucet.name : ucet.name}</div>
          <div className="text-xs text-slate-500">
            {FORMATY_NAZEV[format]} · {kdy ? hezkyCas(kdy, ucet.timezone) : "bez času"}
          </div>
        </div>
      </div>
      {!ig && text && <p className="whitespace-pre-wrap break-words px-2 pb-2">{text}</p>}
      {prvni && (
        <div className={`relative bg-slate-900 ${svisle ? "aspect-[9/16]" : ig ? "aspect-[4/5]" : "aspect-video"}`}>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- podepsaná URL
            <img src={url} alt="" className={`h-full w-full ${svisle || !ig ? "object-contain" : "object-cover"}`} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">náhled</div>
          )}
          {prvni.kind === "video" && (
            <span className="absolute inset-0 flex items-center justify-center text-4xl text-white/80">▶</span>
          )}
          {media.length > 1 && (
            <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 text-xs text-white">1/{media.length}</span>
          )}
        </div>
      )}
      {!ig && linkUrl && !prvni && (
        <div className="mx-2 mb-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
          Odkaz: {linkUrl.replace(/^https?:\/\//, "").slice(0, 60)}
        </div>
      )}
      {ig && (
        <p className="whitespace-pre-wrap break-words p-2">
          <span className="font-semibold">{ucet.username ?? ucet.name}</span> {text}
        </p>
      )}
    </div>
  );
}
