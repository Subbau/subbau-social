"use client";

import { useRouter } from "next/navigation";
import { KLIC_PREDVYPLNENI, zabalPredvyplneni } from "@/lib/skupiny/predvyplneni";
import type { AccountTimeSlot, MediaAsset, PostFormat, SocialAccount } from "@/lib/db-types";
import { FORMATY_NAZEV, povoleneFormaty, SITE } from "@/lib/stavy";
import { hezkyCas } from "@/lib/cas";
import { jeNejistyVysledek } from "@/lib/akce";
import type { VysledekKontroly } from "@/lib/validace";
import { Hlaska, StavStitek, Tlacitko } from "../ui";
import { CasVarianty } from "./CasVarianty";
import { MediaVarianty } from "./MediaVarianty";
import { Nahled } from "./Nahled";
import { TextVarianty } from "./TextVarianty";
import { UpozorneniDuplicita, type NalezenaDuplicita } from "./Duplicity";
import { OpakovaniPanel } from "./OpakovaniPanel";
import { okamzikVarianty, type Varianta } from "./typy";

export type AkceVarianty = {
  zkusitZnovu: () => void;
  smazat: () => void;
  duplikovat: () => void;
  ulozitKoncept: () => Promise<string | null>;
  obnovit: () => void;
};

export function ZalozkaVarianty({
  v,
  ucet,
  ucty,
  sloty,
  kontrola,
  duplicity,
  jenCteni,
  pracuji,
  zmena,
  akce,
}: {
  v: Varianta;
  ucet: SocialAccount;
  ucty: SocialAccount[];
  sloty: AccountTimeSlot[];
  kontrola: VysledekKontroly;
  duplicity: NalezenaDuplicita[];
  jenCteni: boolean;
  pracuji: boolean;
  zmena: (z: Partial<Varianta>) => void;
  akce: AkceVarianty;
}) {
  const router = useRouter();
  const formaty = povoleneFormaty(ucet.platform);
  const kdy = okamzikVarianty(v, ucet.timezone);
  const povolenaDuplicita = v.platform_options.allow_duplicate === true;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StavStitek status={v.status} />
          <span className="text-sm text-slate-600">
            {ucet.name} · {SITE[ucet.platform]}
          </span>
          {ucet.connection_status !== "connected" && (
            <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">účet není připojený</span>
          )}
          {!ucet.is_active && <span className="rounded bg-slate-200 px-1.5 text-xs">účet vypnutý</span>}
        </div>

        {v.status === "published" && (
          <Hlaska typ="ok">
            Zveřejněno {hezkyCas(v.published_at, ucet.timezone)}.{" "}
            {v.external_url && (
              <a href={v.external_url} target="_blank" rel="noreferrer" className="font-medium underline">
                Otevřít na síti ↗
              </a>
            )}
          </Hlaska>
        )}
        {v.status === "publishing" && <Hlaska typ="varovani">Příspěvek se právě publikuje — teď ho nejde měnit.</Hlaska>}
        {v.status === "failed" && (
          <Hlaska typ="chyba">
            {jeNejistyVysledek(v.last_error_code) && (
              <p className="mb-1 font-semibold">Nejdřív zkontrolujte stránku — příspěvek možná vyšel.</p>
            )}
            <p>{v.last_error_message ?? "Publikace selhala."}</p>
            {v.last_error_code && <p className="mt-1 text-xs opacity-70">kód: {v.last_error_code}</p>}
          </Hlaska>
        )}

        <div>
          <span className="stitek-pole">Formát</span>
          <div className="flex flex-wrap gap-1">
            {formaty.map((f: PostFormat) => (
              <button
                key={f}
                type="button"
                disabled={jenCteni}
                aria-pressed={v.format === f}
                onClick={() => zmena({ format: f })}
                className={`rounded-md border px-3 py-1 text-sm ${v.format === f ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"} disabled:opacity-60`}
              >
                {FORMATY_NAZEV[f]}
              </button>
            ))}
          </div>
        </div>

        <TextVarianty
          accountId={ucet.id}
          platform={ucet.platform}
          caption={v.caption}
          linkUrl={v.link_url}
          jenCteni={jenCteni}
          zmena={(z) => zmena(z)}
        />

        <MediaVarianty
          media={v.media}
          ucet={ucet}
          ucty={ucty}
          jenCteni={jenCteni}
          zmena={(media: MediaAsset[]) => zmena({ media })}
        />

        <CasVarianty
          datum={v.datum}
          cas={v.cas}
          timezone={ucet.timezone}
          sloty={sloty}
          jenCteni={jenCteni}
          zmena={(z) => zmena(z)}
        />

        <UpozorneniDuplicita
          nalezene={duplicity}
          povoleno={povolenaDuplicita}
          jenCteni={jenCteni}
          prepni={(ano) => {
            const { allow_duplicate: _x, ...zbytek } = v.platform_options;
            void _x;
            zmena({ platform_options: ano ? { ...zbytek, allow_duplicate: true } : zbytek });
          }}
        />

        {(kontrola.blokujici.length > 0 || kontrola.varovani.length > 0) && !jenCteni && (
          <div className="space-y-2">
            {kontrola.blokujici.length > 0 && (
              <Hlaska typ="chyba">
                <p className="mb-1 font-medium">Před naplánováním opravte:</p>
                <ul className="list-disc pl-5">
                  {kontrola.blokujici.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Hlaska>
            )}
            {kontrola.varovani.length > 0 && (
              <Hlaska typ="varovani">
                <ul className="list-disc pl-5">
                  {kontrola.varovani.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Hlaska>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          {v.status === "failed" && (
            <Tlacitko varianta="primarni" onClick={akce.zkusitZnovu} disabled={pracuji}>
              Zkusit znovu
            </Tlacitko>
          )}
          {v.id && (
            <Tlacitko onClick={akce.duplikovat} disabled={pracuji}>
              Duplikovat
            </Tlacitko>
          )}
          <Tlacitko
            onClick={() => {
              sessionStorage.setItem(
                KLIC_PREDVYPLNENI,
                zabalPredvyplneni({ text: v.caption, assetIds: v.media.map((m) => m.id), zdroj: v.id }),
              );
              router.push("/skupiny/nova");
            }}
            disabled={pracuji || (!v.caption.trim() && v.media.length === 0)}
            title="Připraví rozesílku do facebookových skupin s tímto textem a médii"
          >
            Poslat i do skupin
          </Tlacitko>
          {(v.id === null || v.status === "draft" || v.status === "scheduled" || v.status === "failed") && (
            <Tlacitko varianta="nebezpecne" onClick={akce.smazat} disabled={pracuji}>
              {v.id ? "Smazat" : "Odebrat účet"}
            </Tlacitko>
          )}
        </div>

        {!jenCteni && (
          <OpakovaniPanel v={v} platform={ucet.platform} timezone={ucet.timezone} ulozitKoncept={akce.ulozitKoncept} poZmene={akce.obnovit} />
        )}
      </div>

      <aside className="min-w-0 space-y-2">
        <span className="stitek-pole">Náhled (zjednodušený)</span>
        <Nahled ucet={ucet} format={v.format} caption={v.caption} linkUrl={v.link_url} media={v.media} kdy={kdy} />
      </aside>
    </div>
  );
}
