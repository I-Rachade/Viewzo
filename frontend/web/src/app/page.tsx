import type { Viewport } from "next";
import Link from "next/link";

import { Logo } from "./logo";
import styles from "./page.module.css";

// The landing screen is dark from edge to edge, browser bars included.
export const viewport: Viewport = { themeColor: "#16151d" };

// The four ways in: two open now, the others with the Studio and the experts.
const DOORS: { title: string; text: string; href?: string }[] = [
  {
    title: "Créateur",
    text: "Gagner de l’argent avec mes réseaux",
    href: "/inscription?profil=CREATOR",
  },
  {
    title: "Annonceur",
    text: "Faire connaître ma marque",
    href: "/inscription?profil=ADVERTISER",
  },
  { title: "Créatif", text: "Proposer mes talents" },
  { title: "Expert", text: "Construire des plans média" },
];

export default function Home() {
  return (
    <div className={`hero ${styles.welcome}`}>
      <div aria-hidden="true" />
      <div className={styles.center}>
        <div className={styles.stage}>
          <span className={`${styles.bubble} ${styles.views}`}>+12 vues</span>
          <Logo size={168} tile={false} animated />
          <span className={`${styles.bubble} ${styles.money}`}>+60 F</span>
        </div>
        <div className={styles.words}>
          <h1 className="rise" style={{ animationDelay: "700ms" }}>
            Viewzo
          </h1>
          <p className="promise rise" style={{ animationDelay: "880ms" }}>
            Ton audience vaut de l’argent.
          </p>
        </div>
      </div>
      <div
        className={`${styles.bottom} rise`}
        style={{ animationDelay: "1150ms" }}
      >
        <div className={styles.doors}>
          {DOORS.map((d) =>
            d.href ? (
              <Link key={d.title} className={styles.door} href={d.href}>
                <strong>{d.title}</strong>
                <span>{d.text}</span>
              </Link>
            ) : (
              <div key={d.title} className={`${styles.door} ${styles.soon}`}>
                <strong>{d.title}</strong>
                <span>{d.text}</span>
                <small>Bientôt</small>
              </div>
            ),
          )}
        </div>
        <p>
          Déjà inscrit ? <Link href="/login">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
