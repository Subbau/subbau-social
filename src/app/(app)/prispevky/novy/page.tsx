import { Suspense } from "react";
import { Editor } from "@/components/editor/Editor";
import { Nacitani } from "@/components/ui";

export const metadata = { title: "Nový příspěvek — SubBau Social" };

export default function NovyPrispevekPage() {
  return (
    <Suspense fallback={<Nacitani />}>
      <Editor />
    </Suspense>
  );
}
