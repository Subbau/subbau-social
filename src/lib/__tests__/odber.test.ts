import { describe, expect, it } from "vitest";
import { overOdber, vypniOdber, type OperaceOdberu } from "../skupiny/odber";

const K = { endpoint: "https://push/1", p256dh: "p", auth: "a" };

function ops(o: { radek?: boolean; ulozSelze?: boolean; smazSelze?: boolean; ulozenoZustane?: boolean } = {}) {
  let radek = o.radek ?? false;
  const volani: string[] = [];
  const op: OperaceOdberu = {
    maRadek: async () => {
      volani.push("maRadek");
      return radek;
    },
    uloz: async () => {
      volani.push("uloz");
      if (o.ulozSelze) throw new Error("RLS");
      radek = o.ulozenoZustane ?? true;
    },
    smaz: async () => {
      volani.push("smaz");
      if (o.smazSelze) throw new Error("síť");
    },
  };
  return { op, volani };
}

describe("stav upozornění podle řádku v DB", () => {
  it("odběr v prohlížeči + vlastní řádek v DB = zapnuto, nic se neukládá", async () => {
    const { op, volani } = ops({ radek: true });
    expect(await overOdber(K, op)).toEqual({ stav: "zapnuto", chyba: null });
    expect(volani).toEqual(["maRadek"]);
  });
  it("řádek v DB chybí → uloží se znovu (upsert) a ověří", async () => {
    const { op, volani } = ops({ radek: false });
    expect(await overOdber(K, op)).toEqual({ stav: "zapnuto", chyba: null });
    expect(volani).toEqual(["maRadek", "uloz", "maRadek"]);
  });
  it("uložení selže → vypnuto s chybou", async () => {
    const { op } = ops({ radek: false, ulozSelze: true });
    const v = await overOdber(K, op);
    expect(v.stav).toBe("vypnuto");
    expect(v.chyba).toMatch(/RLS/);
  });
  it("uložení „projde“, ale řádek pořád není → vypnuto s chybou", async () => {
    const { op } = ops({ radek: false, ulozenoZustane: false });
    expect((await overOdber(K, op)).stav).toBe("vypnuto");
  });
  it("prohlížeč odběr nemá → vypnuto", async () => {
    expect(await overOdber(null, ops().op)).toEqual({ stav: "vypnuto", chyba: null });
  });
});

describe("vypnutí", () => {
  it("chyba při mazání se ukáže a v prohlížeči se neodhlásí", async () => {
    let odhlaseno = false;
    const v = await vypniOdber(K.endpoint, ops({ smazSelze: true }).op, async () => {
      odhlaseno = true;
    });
    expect(v.stav).toBe("zapnuto");
    expect(v.chyba).toMatch(/síť/);
    expect(odhlaseno).toBe(false);
  });
  it("bez chyby: smazat řádek, odhlásit, vypnuto", async () => {
    let odhlaseno = false;
    const { op, volani } = ops();
    expect(await vypniOdber(K.endpoint, op, async () => (odhlaseno = true))).toEqual({ stav: "vypnuto", chyba: null });
    expect(volani).toEqual(["smaz"]);
    expect(odhlaseno).toBe(true);
  });
});
