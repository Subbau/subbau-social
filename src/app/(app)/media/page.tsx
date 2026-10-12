"use client";

import { KnihovnaMedii } from "@/components/media/KnihovnaMedii";
import { Hlaska, Nacitani, Nadpis } from "@/components/ui";
import { useUcty } from "@/lib/data/ucty";

export default function MediaPage() {
  const ucty = useUcty();
  return (
    <div>
      <Nadpis>Média</Nadpis>
      {ucty.chyba && <Hlaska typ="chyba">{ucty.chyba}</Hlaska>}
      {ucty.nacitam ? <Nacitani /> : <KnihovnaMedii ucty={ucty.data} />}
    </div>
  );
}
