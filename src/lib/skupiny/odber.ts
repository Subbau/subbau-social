// Stav upozornění: „Zapnuto“ jen když prohlížeč má odběr A v DB je k němu vlastní řádek.
// Čistá logika — operace s DB a prohlížečem se předávají zvenku.

export type KliceOdberu = { endpoint: string; p256dh: string; auth: string };

export type OperaceOdberu = {
  /** existuje vlastní řádek push_subscriptions s tímto endpointem? (RLS vrací jen vlastní) */
  maRadek: (endpoint: string) => Promise<boolean>;
  /** upsert vlastního řádku podle endpointu; chyba = výjimka */
  uloz: (k: KliceOdberu) => Promise<void>;
  /** smaže vlastní řádek; chyba = výjimka */
  smaz: (endpoint: string) => Promise<void>;
};

export type StavOdberu = { stav: "zapnuto" | "vypnuto"; chyba: string | null };

function text(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/**
 * Po načtení stránky / po přihlášení k odběru: když prohlížeč odběr má, ale řádek v DB
 * chybí (smazal ho cron po 410, jiný účet, nedokončené zapnutí), uloží se znovu.
 * Když to nejde, stav je „vypnuto“ s chybou — upozornění by nechodila.
 */
export async function overOdber(k: KliceOdberu | null, op: OperaceOdberu): Promise<StavOdberu> {
  if (!k) return { stav: "vypnuto", chyba: null };
  try {
    if (await op.maRadek(k.endpoint)) return { stav: "zapnuto", chyba: null };
    await op.uloz(k);
    if (!(await op.maRadek(k.endpoint))) {
      return { stav: "vypnuto", chyba: "Odběr se nepodařilo uložit na server." };
    }
    return { stav: "zapnuto", chyba: null };
  } catch (e) {
    return { stav: "vypnuto", chyba: `Upozornění nejsou uložená na serveru: ${text(e)}` };
  }
}

/** Vypnutí: nejdřív řádek v DB (chyba se hlásí a nic dál), pak odhlášení v prohlížeči. */
export async function vypniOdber(
  endpoint: string | null,
  op: Pick<OperaceOdberu, "smaz">,
  odhlasit: () => Promise<unknown>,
): Promise<StavOdberu> {
  if (!endpoint) return { stav: "vypnuto", chyba: null };
  try {
    await op.smaz(endpoint);
  } catch (e) {
    return { stav: "zapnuto", chyba: `Vypnutí se nepovedlo: ${text(e)}` };
  }
  await odhlasit();
  return { stav: "vypnuto", chyba: null };
}
