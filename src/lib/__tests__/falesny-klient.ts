// Falešný supabase klient pro testy: zapisuje řetěz volání (from → update → eq …)
// a na await vrátí zadaná data. Není to *.test.ts, vitest ho sám nespouští.
import type { Klient } from "../supabase/client";

export type Krok = [string, unknown[]];

export function falesnyKlient(data: unknown[] = [{ id: "a" }, { id: "b" }]) {
  const volani: { tabulka: string; kroky: Krok[] }[] = [];
  const klient = {
    from(tabulka: string) {
      const zaznam = { tabulka, kroky: [] as Krok[] };
      volani.push(zaznam);
      const retez: object = new Proxy(
        {},
        {
          get(_c, vlastnost) {
            if (vlastnost === "then") {
              return (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) =>
                Promise.resolve({ data, error: null }).then(ok, ko);
            }
            return (...args: unknown[]) => {
              zaznam.kroky.push([String(vlastnost), args]);
              return retez;
            };
          },
        },
      );
      return retez;
    },
  };
  return { klient: klient as unknown as Klient, volani };
}
