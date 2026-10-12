// Texty notifikací a ukazatelů — sdílí server (cron) i klient.

export function textNotifikace(batchNo: number, pocetDavek: number, cekajicich: number): { title: string; body: string } {
  return {
    title: "SubBau Social",
    body: `Skupiny: dávka ${batchNo} z ${pocetDavek} — ${cekajicich} ${cekajicich === 1 ? "skupina čeká" : cekajicich >= 2 && cekajicich <= 4 ? "skupiny čekají" : "skupin čeká"}`,
  };
}

export const URL_SKUPINY_DNES = "/skupiny/dnes";

export const HLASKA_SCHRANKA = "Text je ve schránce — ve Facebooku vyber skupinu, vlož text a odešli.";
