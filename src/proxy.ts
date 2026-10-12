import type { NextRequest } from "next/server";
import { obnovSession } from "@/lib/supabase/proxy-session";

export async function proxy(request: NextRequest) {
  return obnovSession(request);
}

export const config = {
  matcher: [
    // Vše kromě statických souborů Next.js, obrázků, PWA souborů (manifest, service worker)
    // a cronu (ten se ověřuje vlastním tajemstvím, ne přihlášením — přesměrování na /login by ho rozbilo).
    "/((?!_next/static|_next/image|favicon.ico|api/cron/|sw\\.js$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
