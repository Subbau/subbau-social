// „Poslat i do skupin“ z editoru → /skupiny/nova. Text a média se předávají přes
// sessionStorage (i neuložené úpravy), ne přes URL.

export const KLIC_PREDVYPLNENI = "subbau-skupiny-predvyplneni";

export type Predvyplneni = { text: string; assetIds: string[]; zdroj: string | null };

export function zabalPredvyplneni(p: Predvyplneni): string {
  return JSON.stringify({ v: 1, text: p.text, assetIds: p.assetIds, zdroj: p.zdroj });
}

/** Nepoškozený obsah, nebo null (cizí/rozbitá data se ignorují). */
export function rozbalPredvyplneni(surove: string | null): Predvyplneni | null {
  if (!surove) return null;
  try {
    const o = JSON.parse(surove) as Record<string, unknown>;
    if (o.v !== 1 || typeof o.text !== "string" || !Array.isArray(o.assetIds)) return null;
    const assetIds = o.assetIds.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
    return { text: o.text, assetIds, zdroj: typeof o.zdroj === "string" ? o.zdroj : null };
  } catch {
    return null;
  }
}
