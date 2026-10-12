import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

const VEREJNE = ["/login"];

/**
 * Obnoví session (cookies) a nepřihlášené pošle na /login.
 * Bez env nikdo přihlášený být nemůže → vše kromě /login přesměruje.
 */
export async function obnovSession(request: NextRequest): Promise<NextResponse> {
  const cesta = request.nextUrl.pathname;
  const jeVerejna = VEREJNE.some((v) => cesta === v || cesta.startsWith(`${v}/`));
  let response = NextResponse.next({ request });
  const env = supabaseEnv();

  let prihlasen = false;
  if (env) {
    const supabase = createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(seznam, hlavicky) {
          seznam.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          seznam.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(hlavicky ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    });
    try {
      const { data } = await supabase.auth.getClaims();
      prihlasen = Boolean(data?.claims?.sub);
    } catch {
      prihlasen = false;
    }
  }

  if (!prihlasen && !jeVerejna) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (cesta !== "/") url.searchParams.set("next", cesta + request.nextUrl.search);
    const presmerovani = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => presmerovani.cookies.set(c));
    return presmerovani;
  }

  if (prihlasen && jeVerejna) {
    const url = request.nextUrl.clone();
    url.pathname = "/kalendar";
    url.search = "";
    const presmerovani = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => presmerovani.cookies.set(c));
    return presmerovani;
  }

  return response;
}
