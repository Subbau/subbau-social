import { Suspense } from "react";
import { Editor } from "@/components/editor/Editor";
import { Nacitani } from "@/components/ui";

export const metadata = { title: "Příspěvek — SubBau Social" };

export default async function PrispevekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Nacitani />}>
      <Editor key={id} postId={id} />
    </Suspense>
  );
}
