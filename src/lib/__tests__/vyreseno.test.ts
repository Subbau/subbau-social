import { describe, expect, it } from "vitest";
import { oznacVyresene, ZMENIL_STAV } from "../data/prispevky";
import { falesnyKlient } from "./falesny-klient";

describe("Vyřešeno", () => {
  it("označí jen příspěvek, který je pořád ve stavu chyba", async () => {
    const { klient, volani } = falesnyKlient([{ id: "p1" }]);
    await oznacVyresene("p1", klient);
    const kroky = volani[0].kroky;
    expect(volani[0].tabulka).toBe("posts");
    expect(kroky.map((k) => k[0])).toContain("update");
    expect(kroky).toContainEqual(["eq", ["id", "p1"]]);
    expect(kroky).toContainEqual(["eq", ["status", "failed"]]);
  });
  it("když se nic neoznačilo (mezitím znovu naplánováno) → hláška o změně stavu", async () => {
    const { klient } = falesnyKlient([]);
    await expect(oznacVyresene("p1", klient)).rejects.toThrow(ZMENIL_STAV);
    expect(ZMENIL_STAV).toBe("Příspěvek už mezitím změnil stav.");
  });
});
