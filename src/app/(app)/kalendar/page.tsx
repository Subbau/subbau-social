import { Suspense } from "react";
import { Kalendar } from "@/components/kalendar/Kalendar";
import { Nacitani } from "@/components/ui";

export const metadata = { title: "Kalendář — SubBau Social" };

export default function KalendarPage() {
  return (
    <Suspense fallback={<Nacitani />}>
      <Kalendar />
    </Suspense>
  );
}
