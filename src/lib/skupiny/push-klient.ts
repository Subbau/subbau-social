// Čistá logika pro zapnutí upozornění v prohlížeči (bez DOM).

/** VAPID veřejný klíč (base64url) → bajty pro pushManager.subscribe. */
export function klicZBase64Url(base64Url: string): Uint8Array<ArrayBuffer> {
  const doplneni = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + doplneni).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** iPhone/iPad (i iPad, který se hlásí jako Mac s dotykem). */
export function jeIos(userAgent: string, dotykovychBodu = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && dotykovychBodu > 1;
}

/**
 * Na iOS (16.4+) fungují upozornění jen v appce přidané na plochu.
 * Když běží v Safari jako stránka, je potřeba návod „Sdílet → Přidat na plochu“.
 */
export function potrebujePridatNaPlochu(userAgent: string, standalone: boolean, dotykovychBodu = 0): boolean {
  return jeIos(userAgent, dotykovychBodu) && !standalone;
}

/** Klíče odběru z PushSubscription.toJSON(). */
export function klicOdberu(json: { endpoint?: string; keys?: Record<string, string> }):
  | { endpoint: string; p256dh: string; auth: string }
  | null {
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}
