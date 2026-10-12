// Service worker SubBau Social — JEN pro upozornění (push). Žádné cachování stránek
// ani dat: nemá posluchač „fetch“, takže síť jde vždy napřímo.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const VYCHOZI_URL = "/skupiny/dnes";

/** Jen adresy uvnitř appky — cizí URL z payloadu se ignoruje. */
function bezpecnaUrl(url) {
  try {
    const u = new URL(url || VYCHOZI_URL, self.location.origin);
    return u.origin === self.location.origin ? u.href : new URL(VYCHOZI_URL, self.location.origin).href;
  } catch {
    return new URL(VYCHOZI_URL, self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SubBau Social";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "subbau-skupiny",
      renotify: true,
      icon: "/ikona-192.png",
      badge: "/ikona-192.png",
      data: { url: bezpecnaUrl(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = bezpecnaUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((okna) => {
      for (const okno of okna) {
        if (new URL(okno.url).origin === self.location.origin && "focus" in okno) {
          return okno.focus().then((o) => (o && "navigate" in o ? o.navigate(url) : self.clients.openWindow(url)));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
