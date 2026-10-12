"use client";

import type { AccountTimeSlot } from "@/lib/db-types";
import { dnes, pridejDny } from "@/lib/cas";
import { slotyProDen } from "@/lib/mrizka";

export function CasVarianty({
  datum,
  cas,
  timezone,
  sloty,
  jenCteni,
  zmena,
}: {
  datum: string;
  cas: string;
  timezone: string;
  sloty: AccountTimeSlot[];
  jenCteni: boolean;
  zmena: (z: { datum?: string; cas?: string }) => void;
}) {
  const dneska = dnes(timezone);
  const rychle = datum ? slotyProDen(sloty, datum) : [];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="stitek-pole" htmlFor="datum">Datum</label>
          <input id="datum" type="date" className="pole" value={datum} readOnly={jenCteni} onChange={(e) => zmena({ datum: e.target.value })} />
        </div>
        <div>
          <label className="stitek-pole" htmlFor="cas">Čas</label>
          <input id="cas" type="time" className="pole" value={cas} readOnly={jenCteni} onChange={(e) => zmena({ cas: e.target.value })} />
        </div>
      </div>
      {!jenCteni && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button type="button" className="rounded-full bg-slate-100 px-2 py-0.5 hover:bg-slate-200" onClick={() => zmena({ datum: dneska })}>
            dnes
          </button>
          <button type="button" className="rounded-full bg-slate-100 px-2 py-0.5 hover:bg-slate-200" onClick={() => zmena({ datum: pridejDny(dneska, 1) })}>
            zítra
          </button>
          {rychle.map((s) => (
            <button
              key={s}
              type="button"
              className={`rounded-full px-2 py-0.5 ${s === cas ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-800 hover:bg-blue-100"}`}
              onClick={() => zmena({ cas: s })}
            >
              {s}
            </button>
          ))}
          {datum && rychle.length === 0 && sloty.length > 0 && <span className="text-slate-400">pro tento den nejsou výchozí časy</span>}
          {(datum || cas) && (
            <button type="button" className="ml-auto text-slate-500 hover:underline" onClick={() => zmena({ datum: "", cas: "" })}>
              bez času
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">Pásmo účtu: {timezone}</p>
    </div>
  );
}
