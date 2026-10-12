import { Suspense } from "react";
import { PrihlaseniFormular } from "./PrihlaseniFormular";

export const metadata = { title: "Přihlášení — SubBau Social Manager" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">SubBau Social Manager</h1>
        <p className="mb-6 text-sm text-slate-500">Přihlaste se e-mailem a heslem.</p>
        <Suspense fallback={<p className="text-sm text-slate-500">Načítám…</p>}>
          <PrihlaseniFormular />
        </Suspense>
      </div>
    </main>
  );
}
