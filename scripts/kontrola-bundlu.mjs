// Kontrola po buildu: serverová tajemství nesmí být v klientském bundlu (.next/static).
// Spouštět po `npm run build` se zkušebními hodnotami v env, např.:
//   SUPABASE_SECRET_KEY=KONTROLA-... VAPID_PRIVATE_KEY=KONTROLA-... VERCEL_CRON_SECRET=KONTROLA-... \
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY=KONTROLA-VEREJNY-... npm run build && npm run kontrola:bundl
// Kontrola umí selhat: když nic neprojde nebo když v bundlu chybí i veřejný klíč
// (pozitivní kontrola — jinak by „nic nenalezeno“ mohlo znamenat jen to, že hledáme špatně).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATIC = join(process.cwd(), ".next", "static");
const TAJNE_NAZVY = ["SUPABASE_SECRET_KEY", "VAPID_PRIVATE_KEY", "VERCEL_CRON_SECRET"];

function soubory(adr) {
  return readdirSync(adr).flatMap((j) => {
    const c = join(adr, j);
    return statSync(c).isDirectory() ? soubory(c) : [c];
  });
}

let chyba = false;
if (!existsSync(STATIC)) {
  console.error("Chybí .next/static — nejdřív npm run build.");
  process.exit(1);
}
const vse = soubory(STATIC).filter((s) => /\.(js|css|json|txt|map)$/.test(s));
if (vse.length < 5) {
  console.error(`V .next/static je jen ${vse.length} souborů — build asi neproběhl.`);
  process.exit(1);
}
const obsah = vse.map((s) => [s, readFileSync(s, "utf8")]);

const hledane = [...TAJNE_NAZVY];
for (const n of TAJNE_NAZVY) {
  const v = process.env[n];
  if (!v || v.length < 12) {
    console.error(`Pro kontrolu nastavte při buildu zkušební ${n} (aspoň 12 znaků).`);
    chyba = true;
  } else hledane.push(v);
}
for (const h of hledane) {
  const kde = obsah.filter(([, t]) => t.includes(h)).map(([s]) => s.replace(process.cwd() + "/", ""));
  if (kde.length) {
    console.error(`NALEZENO v klientském bundlu: ${h.startsWith("KONTROLA") ? "(hodnota)" : h} → ${kde.join(", ")}`);
    chyba = true;
  }
}
const verejny = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
if (!verejny || !obsah.some(([, t]) => t.includes(verejny))) {
  console.error("Pozitivní kontrola selhala: veřejný VAPID klíč v bundlu není (nastavte ho při buildu) — hledání nejde ověřit.");
  chyba = true;
}
if (chyba) process.exit(1);
console.log(`OK: ${vse.length} souborů v .next/static, žádné serverové tajemství; veřejný VAPID klíč nalezen (kontrola funguje).`);
