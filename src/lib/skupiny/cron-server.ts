// Serverová logika cronu skupin. Importuje ji JEN route src/app/api/cron/skupiny/route.ts
// (Node runtime). Nic odsud nesmí do klienta — service klíč a VAPID private jsou jen tady.

import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { DueGroupBatch } from "../db-types";
import { textNotifikace, URL_SKUPINY_DNES } from "./texty";

export const MIN_DELKA_SECRETU = 32;

/**
 * Ověření `Authorization: Bearer <VERCEL_CRON_SECRET>` v konstantním čase.
 * Porovnávají se sha256 otisky (stejná délka), takže délka hlavičky nic neprozradí.
 * Secret kratší než 32 znaků se nepřijímá vůbec.
 */
export function overCronSecret(hlavicka: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_DELKA_SECRETU) return false;
  const ocekavano = createHash("sha256").update(`Bearer ${secret}`).digest();
  const prislo = createHash("sha256").update(hlavicka ?? "").digest();
  return timingSafeEqual(ocekavano, prislo) && hlavicka !== null;
}

export type CronEnv = {
  supabaseUrl: string;
  secretKey: string;
  vapidPublic: string;
  vapidPrivate: string;
  vapidSubject: string;
  cronSecret: string;
};

/** Env pro cron; chybějící proměnné vrací jménem (hodnoty nikdy). */
export function nactiCronEnv(env: Record<string, string | undefined> = process.env): CronEnv | { chybi: string[] } {
  const hodnoty = {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY,
    vapidPublic: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    vapidPrivate: env.VAPID_PRIVATE_KEY,
    cronSecret: env.VERCEL_CRON_SECRET,
  };
  const jmena: Record<keyof typeof hodnoty, string> = {
    supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
    secretKey: "SUPABASE_SECRET_KEY",
    vapidPublic: "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    vapidPrivate: "VAPID_PRIVATE_KEY",
    cronSecret: "VERCEL_CRON_SECRET",
  };
  const chybi = (Object.keys(hodnoty) as (keyof typeof hodnoty)[]).filter((k) => !hodnoty[k]).map((k) => jmena[k]);
  if (chybi.length) return { chybi };
  return {
    supabaseUrl: (hodnoty.supabaseUrl as string).replace(/\/+$/, ""),
    secretKey: hodnoty.secretKey as string,
    vapidPublic: hodnoty.vapidPublic as string,
    vapidPrivate: hodnoty.vapidPrivate as string,
    vapidSubject: env.VAPID_SUBJECT || "mailto:info@subbau.cz",
    cronSecret: hodnoty.cronSecret as string,
  };
}

export type Odber = { id: string; endpoint: string; p256dh: string; auth: string };

export type CronZavislosti = {
  dueBatches: () => Promise<DueGroupBatch[]>;
  pocetDavek: (campaignId: string) => Promise<number>;
  pocetCekajicich: (batchId: string) => Promise<number>;
  odbery: () => Promise<Odber[]>;
  posli: (o: Odber, payload: string) => Promise<void>;
  smazOdber: (id: string) => Promise<void>;
  /** release_group_batch: vrátí dávce notified_at = null, ať se příště zkusí znovu */
  uvolniDavku: (batchId: string) => Promise<boolean>;
  log: (zprava: string) => void;
};

export type VysledekCronu = {
  davek: number;
  notifikaci: number;
  chyb: number;
  smazanoOdberu: number;
  /** dávky vrácené k dalšímu pokusu (nedoručené na žádný odběr) */
  vraceno: number;
};

function stavovyKod(e: unknown): number | null {
  const k = (e as { statusCode?: unknown })?.statusCode;
  return typeof k === "number" ? k : null;
}

/**
 * Projde splatné dávky a pošle notifikace. Odběry, které vrátí 404/410, smaže.
 * Dávku, která nedošla na ŽÁDNÝ odběr kvůli chybě (odběry nejdou načíst, všechna
 * odeslání 5xx/síť), vrátí přes release_group_batch, ať se zkusí v další minutě.
 * Při nule odběrů ji naopak nevrací (jinak nekonečná smyčka) — jen zaloguje.
 */
export async function zpracujDavky(z: CronZavislosti): Promise<VysledekCronu> {
  const davky = await z.dueBatches();
  const vysledek: VysledekCronu = { davek: davky.length, notifikaci: 0, chyb: 0, smazanoOdberu: 0, vraceno: 0 };
  if (davky.length === 0) return vysledek;

  let odbery: Odber[] = [];
  let odberyChyba = false;
  try {
    odbery = await z.odbery();
  } catch (e) {
    odberyChyba = true;
    z.log(`cron skupiny: odběry nejdou načíst (${e instanceof Error ? e.message : String(e)})`);
  }

  const vratit = async (batchId: string) => {
    try {
      if (await z.uvolniDavku(batchId)) vysledek.vraceno++;
    } catch (e) {
      z.log(`cron skupiny: dávku ${batchId} nejde vrátit (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  for (const d of davky) {
    // Počty vrací due_group_batches; kdyby chyběly (starší verze funkce), dopočítají se.
    const cekajicich = d.pending_count ?? (await z.pocetCekajicich(d.batch_id));
    if (cekajicich <= 0) continue;
    if (odberyChyba) {
      vysledek.chyb++;
      await vratit(d.batch_id);
      continue;
    }
    if (odbery.length === 0) {
      z.log(`cron skupiny: dávka ${d.batch_no} (${d.batch_id}) — 0 odběrů, upozornění nemá kam jít`);
      continue;
    }
    const pocet = d.batch_count ?? (await z.pocetDavek(d.campaign_id));
    const { title, body } = textNotifikace(d.batch_no, pocet, cekajicich);
    const payload = JSON.stringify({ title, body, url: URL_SKUPINY_DNES, tag: `skupiny-${d.campaign_id}` });
    const mrtve: string[] = [];
    let doruceno = 0;
    let docasnychChyb = 0;
    for (const o of odbery) {
      try {
        await z.posli(o, payload);
        vysledek.notifikaci++;
        doruceno++;
      } catch (e) {
        const kod = stavovyKod(e);
        if (kod === 404 || kod === 410) {
          await z.smazOdber(o.id);
          mrtve.push(o.id);
          vysledek.smazanoOdberu++;
        } else {
          vysledek.chyb++;
          docasnychChyb++;
        }
      }
    }
    odbery = odbery.filter((o) => !mrtve.includes(o.id));
    if (doruceno === 0) {
      if (docasnychChyb > 0) await vratit(d.batch_id);
      else z.log(`cron skupiny: dávka ${d.batch_no} (${d.batch_id}) — všechny odběry neplatné, 0 doručeno`);
    }
  }
  return vysledek;
}
