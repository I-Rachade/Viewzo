import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Same files as the mobile app (SIL Open Font License, see fonts/).
const sora = localFont({
  src: [
    { path: "./fonts/Sora-600.woff2", weight: "600" },
    { path: "./fonts/Sora-700.woff2", weight: "700" },
    { path: "./fonts/Sora-800.woff2", weight: "800" },
  ],
  variable: "--font-display",
  display: "swap",
});

const dmSans = localFont({
  src: [
    { path: "./fonts/DMSans-400.woff2", weight: "400" },
    { path: "./fonts/DMSans-500.woff2", weight: "500" },
    { path: "./fonts/DMSans-700.woff2", weight: "700" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Viewzo",
  description: "Tes vues, payées. Partout dans le monde.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${sora.variable} ${dmSans.variable}`}>
      <body>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
