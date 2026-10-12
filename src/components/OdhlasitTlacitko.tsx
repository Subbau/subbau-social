"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export function OdhlasitTlacitko({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={`rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 ${className}`}
      onClick={async () => {
        await supabase().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Odhlásit
    </button>
  );
}
