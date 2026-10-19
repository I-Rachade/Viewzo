import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viewzo",
  description: "Achète des vues, publie, gagne.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
