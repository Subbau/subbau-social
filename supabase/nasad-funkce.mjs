#!/usr/bin/env node
// Nasazení Edge funkcí přes Management API Supabase.
//
// Proč ne `supabase functions deploy`: 12. 10. 2026 vracelo nasazení pro tento projekt
// NÁHODNĚ „500 internal error“ — tentýž jednořádkový soubor dvakrát spadl a potřetí prošel;
// funkce s více soubory a npm importem neprošla ani na 8 pokusů. Prošla až jako JEDEN
// soubor sbalený `deno bundle` (vč. supabase-js) a to na 4. pokus. CLI znovu nezkouší.
//
// Skript proto pro každou funkci: `deno check` → `deno bundle` do jednoho index.js →
// nahrání s až 10 pokusy (pauza 15 s).
//
// Použití (token se nikam neukládá, čte se jen z proměnné prostředí):
//   SUPABASE_ACCESS_TOKEN=sbp_… node supabase/nasad-funkce.mjs [publisher check-accounts meta-sync]
// Volitelně SUPABASE_PROJECT_REF (výchozí projekt SubBau Social).
//
// verify_jwt je u všech funkcí vypnuté: publisher a check-accounts ověřují CRON_SECRET,
// meta-sync ověřuje přihlášení sám (getUser + app_users). Projekt používá nové klíče,
// u kterých Supabase ověřování JWT na bráně nedoporučuje.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const FUNKCE = ['publisher', 'check-accounts', 'meta-sync'];
const POKUSU = 10;
const koren = join(dirname(fileURLToPath(import.meta.url)), 'functions');
const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const ref = process.env.SUPABASE_PROJECT_REF ?? 'orqzfmbgnxsarxtfwduq';

if (!token.startsWith('sbp_')) {
  console.error('Chybí SUPABASE_ACCESS_TOKEN (sbp_…).');
  process.exit(1);
}

const vybrane = process.argv.slice(2);
for (const f of vybrane) {
  if (!FUNKCE.includes(f)) {
    console.error(`Neznámá funkce ${f}. Znám: ${FUNKCE.join(', ')}`);
    process.exit(1);
  }
}

const deno = (args) => execFileSync('npx', ['-y', 'deno', ...args], { cwd: koren, stdio: 'inherit' });

async function nasad(nazev) {
  const cil = mkdtempSync(join(tmpdir(), `subbau-fn-${nazev}-`));
  try {
    deno(['check', `${nazev}/index.ts`]);
    deno(['bundle', '--platform', 'deno', `${nazev}/index.ts`, '-o', join(cil, 'index.js')]);
    const kod = readFileSync(join(cil, 'index.js'), 'utf8');
    if (/["']npm:/.test(kod)) throw new Error(`${nazev}: v balíku zůstal npm: import.`);

    let odp;
    let telo = '';
    for (let pokus = 1; pokus <= POKUSU; pokus++) {
      const form = new FormData();
      form.append(
        'metadata',
        new Blob([JSON.stringify({ entrypoint_path: 'index.js', name: nazev, verify_jwt: false })], {
          type: 'application/json',
        }),
      );
      form.append('file', new Blob([kod], { type: 'application/javascript' }), 'index.js');
      odp = await fetch(
        `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(nazev)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      );
      telo = await odp.text();
      if (odp.ok || odp.status < 500) break;
      console.log(`${nazev}: pokus ${pokus} — ${odp.status}, zkouším znovu za 15 s`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
    if (!odp.ok) throw new Error(`${nazev}: nasazení selhalo (${odp.status}) ${telo.slice(0, 300)}`);
    const j = JSON.parse(telo);
    console.log(`${nazev}: nasazeno, verze ${j.version}, stav ${j.status}, verify_jwt ${j.verify_jwt}`);
  } finally {
    rmSync(cil, { recursive: true, force: true });
  }
}

for (const f of vybrane.length ? vybrane : FUNKCE) {
  await nasad(f);
}
