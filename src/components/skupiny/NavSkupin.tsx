"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ODKAZY = [
  { href: "/skupiny/dnes", nazev: "Dnes" },
  { href: "/skupiny", nazev: "Skupiny" },
  { href: "/skupiny/kampane", nazev: "Rozesílky" },
  { href: "/skupiny/nova", nazev: "+ Nová rozesílka" },
];

export function NavSkupin() {
  const cesta = usePathname();
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 pb-2 text-sm">
      {ODKAZY.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className={`rounded-md px-3 py-1.5 ${cesta === o.href ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"}`}
        >
          {o.nazev}
        </Link>
      ))}
    </nav>
  );
}
