// Minimální typy Deno pro kontrolu Edge funkcí přes tsc (deno na tomto stroji není).
// Pokrývá jen to, co funkce používají; skutečné typy dodá Deno při nasazení.
declare namespace Deno {
  const env: { get(nazev: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
