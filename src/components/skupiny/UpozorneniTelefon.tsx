"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { klicOdberu, klicZBase64Url, potrebujePridatNaPlochu } from "@/lib/skupiny/push-klient";
import { overOdber, vypniOdber, type OperaceOdberu } from "@/lib/skupiny/odber";
import { Hlaska, Tlacitko, textChyby } from "../ui";

type Stav =
  | "zjistuji"
  | "nepodporovano"
  | "pridat-na-plochu"
  | "zakazano"
  | "vypnuto"
  | "zapnuto"
  | "chybi-klic";

const VAPID_VEREJNY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const OPERACE: OperaceOdberu = {
  maRadek: async (endpoint) => {
    const { data, error } = await supabase().from("push_subscriptions").select("id").eq("endpoint", endpoint).limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  },
  uloz: async (k) => {
    const { error } = await supabase()
      .from("push_subscriptions")
      .upsert({ ...k, user_agent: navigator.userAgent.slice(0, 300) }, { onConflict: "endpoint" });
    if (error) throw error;
  },
  smaz: async (endpoint) => {
    const { error } = await supabase().from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
  },
};

async function registrace(): Promise<ServiceWorkerRegistration> {
  const r = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready.then(() => r);
}

/** Panel „Upozornění v telefonu“: zapnutí a vypnutí Web Push pro tento prohlížeč. */
export function UpozorneniTelefon() {
  const [stav, setStav] = useState<Stav>("zjistuji");
  const [chyba, setChyba] = useState<string | null>(null);
  const [pracuji, setPracuji] = useState(false);

  useEffect(() => {
    let platne = true;
    (async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      let s: Stav;
      if (potrebujePridatNaPlochu(navigator.userAgent, standalone, navigator.maxTouchPoints)) s = "pridat-na-plochu";
      else if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) s = "nepodporovano";
      else if (!VAPID_VEREJNY) s = "chybi-klic";
      else if (Notification.permission === "denied") s = "zakazano";
      else {
        const r = await navigator.serviceWorker.getRegistration("/");
        const sub = r ? await r.pushManager.getSubscription() : null;
        // Zapnuto jen s vlastním řádkem v DB; chybí-li, uloží se znovu.
        const v = await overOdber(sub ? klicOdberu(sub.toJSON()) : null, OPERACE);
        s = v.stav;
        if (platne && v.chyba) setChyba(v.chyba);
      }
      if (platne) setStav(s);
    })().catch(() => platne && setStav("nepodporovano"));
    return () => {
      platne = false;
    };
  }, []);

  async function zapnout() {
    setPracuji(true);
    setChyba(null);
    try {
      const povoleni = await Notification.requestPermission();
      if (povoleni !== "granted") {
        setStav(povoleni === "denied" ? "zakazano" : "vypnuto");
        return;
      }
      const r = await registrace();
      const sub =
        (await r.pushManager.getSubscription()) ??
        (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: klicZBase64Url(VAPID_VEREJNY) }));
      const k = klicOdberu(sub.toJSON());
      if (!k) throw new Error("Prohlížeč nevrátil klíče odběru.");
      const v = await overOdber(k, OPERACE);
      setStav(v.stav);
      setChyba(v.chyba);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  async function vypnout() {
    setPracuji(true);
    setChyba(null);
    try {
      const r = await navigator.serviceWorker.getRegistration("/");
      const sub = r ? await r.pushManager.getSubscription() : null;
      const v = await vypniOdber(sub?.endpoint ?? null, OPERACE, async () => sub?.unsubscribe());
      setStav(v.stav);
      setChyba(v.chyba);
    } catch (e) {
      setChyba(textChyby(e));
    } finally {
      setPracuji(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <h2 className="mb-1 font-medium">Upozornění v telefonu</h2>
      {stav === "zjistuji" && <p className="text-slate-500">Zjišťuji…</p>}
      {stav === "pridat-na-plochu" && (
        <div className="space-y-1 text-slate-700">
          <p>Na iPhonu fungují upozornění jen z appky přidané na plochu (iOS 16.4 a novější):</p>
          <ol className="list-decimal pl-5">
            <li>V Safari klepněte dole na tlačítko Sdílet (čtvereček se šipkou).</li>
            <li>Zvolte „Přidat na plochu“ a potvrďte.</li>
            <li>Otevřete SubBau Social z plochy a tady klepněte na Zapnout.</li>
          </ol>
        </div>
      )}
      {stav === "nepodporovano" && <p className="text-slate-600">Tento prohlížeč upozornění neumí.</p>}
      {stav === "chybi-klic" && <p className="text-slate-600">Na serveru chybí NEXT_PUBLIC_VAPID_PUBLIC_KEY — upozornění zatím nejdou zapnout.</p>}
      {stav === "zakazano" && (
        <p className="text-slate-600">Upozornění jsou v prohlížeči zakázaná. Povolte je v nastavení webu (zámek u adresy) a načtěte stránku znovu.</p>
      )}
      {stav === "vypnuto" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-600">V tomto zařízení vypnuto.</span>
          <Tlacitko varianta="primarni" onClick={() => void zapnout()} disabled={pracuji}>Zapnout</Tlacitko>
        </div>
      )}
      {stav === "zapnuto" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-green-700">Zapnuto — v čas dávky přijde upozornění.</span>
          <Tlacitko onClick={() => void vypnout()} disabled={pracuji}>Vypnout</Tlacitko>
        </div>
      )}
      {chyba && <div className="mt-2"><Hlaska typ="chyba">{chyba}</Hlaska></div>}
    </section>
  );
}
