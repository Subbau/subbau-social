"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountTimeSlot, SocialAccount } from "../db-types";
import { supabase } from "../supabase/client";

export type StavNacitani<T> = { data: T; nacitam: boolean; chyba: string | null; obnov: () => void };

/** Všechny účty (i neaktivní), seřazené: aktivní nahoře, pak podle názvu. */
export function useUcty(): StavNacitani<SocialAccount[]> {
  const [data, setData] = useState<SocialAccount[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [verze, setVerze] = useState(0);

  useEffect(() => {
    let platne = true;
    (async () => {
      try {
        const { data: radky, error } = await supabase()
          .from("social_accounts")
          .select("*")
          .order("is_active", { ascending: false })
          .order("name");
        if (!platne) return;
        if (error) setChyba(error.message);
        else {
          setData(radky ?? []);
          setChyba(null);
        }
      } catch (e) {
        if (platne) setChyba(e instanceof Error ? e.message : String(e));
      } finally {
        if (platne) setNacitam(false);
      }
    })();
    return () => {
      platne = false;
    };
  }, [verze]);

  const obnov = useCallback(() => setVerze((v) => v + 1), []);
  return { data, nacitam, chyba, obnov };
}

export function useCasoveSloty(): StavNacitani<AccountTimeSlot[]> {
  const [data, setData] = useState<AccountTimeSlot[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);
  const [verze, setVerze] = useState(0);

  useEffect(() => {
    let platne = true;
    (async () => {
      try {
        const { data: radky, error } = await supabase()
          .from("account_time_slots")
          .select("*")
          .order("weekday")
          .order("time_of_day");
        if (!platne) return;
        if (error) setChyba(error.message);
        else setData(radky ?? []);
      } catch (e) {
        if (platne) setChyba(e instanceof Error ? e.message : String(e));
      } finally {
        if (platne) setNacitam(false);
      }
    })();
    return () => {
      platne = false;
    };
  }, [verze]);

  const obnov = useCallback(() => setVerze((v) => v + 1), []);
  return { data, nacitam, chyba, obnov };
}

export function mapaUctu(ucty: SocialAccount[]): Map<string, SocialAccount> {
  return new Map(ucty.map((u) => [u.id, u]));
}
