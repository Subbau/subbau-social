import type { NextRequest } from "next/server";
import { obnovSession } from "@/lib/supabase/proxy-session";

export async function proxy(request: NextRequest) {
  return obnovSession(request);
}

export const config = {
  matcher: [
    // vše kromě statických souborů Next.js a obrázků
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
