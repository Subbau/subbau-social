"use client";

import { useEffect, type ReactNode } from "react";
import type { PostStatus, SocialAccount } from "@/lib/db-types";
import { SITE, STAVY } from "@/lib/stavy";

type Varianta = "primarni" | "sekundarni" | "nebezpecne" | "tiche";

const TRIDY: Record<Varianta, string> = {
  primarni: "bg-blue-600 text-white hover:bg-blue-700 border-transparent",
  sekundarni: "bg-white text-slate-800 hover:bg-slate-50 border-slate-300",
  nebezpecne: "bg-white text-red-700 hover:bg-red-50 border-red-300",
  tiche: "bg-transparent text-slate-700 hover:bg-slate-100 border-transparent",
};

export function Tlacitko({
  varianta = "sekundarni",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { varianta?: Varianta }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${TRIDY[varianta]} ${className}`}
    />
  );
}

export function StavStitek({ status, maly = false }: { status: PostStatus; maly?: boolean }) {
  const s = STAVY[status];
  return (
    <span
      title={s.nazev}
      className={`inline-flex items-center gap-1 rounded-full px-2 ring-1 ring-inset ${s.trida} ${maly ? "text-[10px] leading-4" : "py-0.5 text-xs"}`}
    >
      <span aria-hidden>{s.ikona}</span>
      {!maly && s.nazev}
    </span>
  );
}

export function UcetStitek({ ucet, aktivni = true, onClick }: { ucet: SocialAccount; aktivni?: boolean; onClick?: () => void }) {
  const obsah = (
    <>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ucet.color }} />
      <span className="truncate">{ucet.name}</span>
      <span className="text-[10px] uppercase text-slate-400">{SITE[ucet.platform].slice(0, 2)}</span>
    </>
  );
  const tridy = `inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${aktivni ? "border-slate-300 bg-white" : "border-dashed border-slate-300 bg-slate-50 text-slate-400"}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={aktivni} className={tridy}>
        {obsah}
      </button>
    );
  }
  return <span className={tridy}>{obsah}</span>;
}

export function Hlaska({ typ = "info", children }: { typ?: "info" | "chyba" | "varovani" | "ok"; children: ReactNode }) {
  const t = {
    info: "bg-slate-50 text-slate-700 border-slate-200",
    chyba: "bg-red-50 text-red-800 border-red-200",
    varovani: "bg-amber-50 text-amber-900 border-amber-200",
    ok: "bg-green-50 text-green-800 border-green-200",
  }[typ];
  return <div className={`rounded-md border p-3 text-sm ${t}`}>{children}</div>;
}

export function Nacitani({ text = "Načítám…" }: { text?: string }) {
  return <p className="p-4 text-sm text-slate-500">{text}</p>;
}

export function Modal({
  otevreno,
  zavrit,
  nadpis,
  children,
  siroky = false,
}: {
  otevreno: boolean;
  zavrit: () => void;
  nadpis: string;
  children: ReactNode;
  siroky?: boolean;
}) {
  useEffect(() => {
    if (!otevreno) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && zavrit();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [otevreno, zavrit]);
  if (!otevreno) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={zavrit}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={nadpis}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 shadow-xl sm:rounded-xl ${siroky ? "sm:max-w-4xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{nadpis}</h2>
          <button type="button" onClick={zavrit} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Zavřít">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Nadpis({ children, akce }: { children: ReactNode; akce?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold">{children}</h1>
      {akce && <div className="flex flex-wrap items-center gap-2">{akce}</div>}
    </div>
  );
}

/** Chyba ze Supabase → čitelný text. */
export function textChyby(e: unknown): string {
  if (!e) return "Neznámá chyba.";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
