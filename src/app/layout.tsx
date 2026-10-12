import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SubBau Social Manager",
  description: "Plánování příspěvků na Facebook a Instagram",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/ikona-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "SubBau Social", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
