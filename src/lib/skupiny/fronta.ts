// Fronta pro obrazovku „Skupiny dnes“ — čistá logika nad načtenými úkoly.

export type UkolProFrontu = {
  id: string;
  campaign_id: string;
  batch_id: string;
  status: "pending" | "sent" | "skipped";
  variant_index: number;
  skupina: { name: string; url: string | null; note: string | null };
  davka: { batch_no: number; due_at: string };
  kampan: { title: string; variants: string[] };
};

export type PolozkaFronty = UkolProFrontu & {
  text: string;
  vDavce: { poradi: number; celkem: number };
  celkem: { poradi: number; celkem: number };
};

export type BudouciDavka = { campaign_id: string; title: string; batch_no: number; due_at: string; cekajicich: number };

function hotovo(u: { status: string }): boolean {
  return u.status !== "pending";
}

/**
 * Aktuální fronta: čekající úkoly dávek, které už mají být odeslané (due_at ≤ teď),
 * seřazené podle času dávky, čísla dávky a názvu skupiny. Počítadla „7 / 20 v dávce ·
 * 31 / 160 celkem“: pořadí = hotové + pozice ve frontě.
 */
export function sestavFrontu(ukoly: UkolProFrontu[], ted: Date): { fronta: PolozkaFronty[]; budouci: BudouciDavka[] } {
  const vDavce = new Map<string, { hotovo: number; celkem: number }>();
  const vKampani = new Map<string, { hotovo: number; celkem: number }>();
  for (const u of ukoly) {
    const d = vDavce.get(u.batch_id) ?? { hotovo: 0, celkem: 0 };
    d.celkem++;
    if (hotovo(u)) d.hotovo++;
    vDavce.set(u.batch_id, d);
    const k = vKampani.get(u.campaign_id) ?? { hotovo: 0, celkem: 0 };
    k.celkem++;
    if (hotovo(u)) k.hotovo++;
    vKampani.set(u.campaign_id, k);
  }

  const cekajici = ukoly
    .filter((u) => u.status === "pending")
    .sort(
      (a, b) =>
        a.davka.due_at.localeCompare(b.davka.due_at) ||
        a.davka.batch_no - b.davka.batch_no ||
        a.skupina.name.localeCompare(b.skupina.name, "cs") ||
        a.id.localeCompare(b.id),
    );

  const splatne = cekajici.filter((u) => new Date(u.davka.due_at).getTime() <= ted.getTime());
  const poziceDavka = new Map<string, number>();
  const poziceKampan = new Map<string, number>();
  const fronta: PolozkaFronty[] = splatne.map((u) => {
    const pd = (poziceDavka.get(u.batch_id) ?? 0) + 1;
    poziceDavka.set(u.batch_id, pd);
    const pk = (poziceKampan.get(u.campaign_id) ?? 0) + 1;
    poziceKampan.set(u.campaign_id, pk);
    const d = vDavce.get(u.batch_id) as { hotovo: number; celkem: number };
    const k = vKampani.get(u.campaign_id) as { hotovo: number; celkem: number };
    const varianty = u.kampan.variants;
    return {
      ...u,
      text: varianty.length ? varianty[u.variant_index % varianty.length] : "",
      vDavce: { poradi: d.hotovo + pd, celkem: d.celkem },
      celkem: { poradi: k.hotovo + pk, celkem: k.celkem },
    };
  });

  const budouciMapa = new Map<string, BudouciDavka>();
  for (const u of cekajici) {
    if (new Date(u.davka.due_at).getTime() <= ted.getTime()) continue;
    const b = budouciMapa.get(u.batch_id) ?? {
      campaign_id: u.campaign_id,
      title: u.kampan.title,
      batch_no: u.davka.batch_no,
      due_at: u.davka.due_at,
      cekajicich: 0,
    };
    b.cekajicich++;
    budouciMapa.set(u.batch_id, b);
  }
  const budouci = [...budouciMapa.values()].sort((a, b) => a.due_at.localeCompare(b.due_at) || a.batch_no - b.batch_no);
  return { fronta, budouci };
}
