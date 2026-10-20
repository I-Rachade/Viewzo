import type { Viewport } from "next";
import Link from "next/link";

import { Logo } from "./logo";
import styles from "./page.module.css";

// The landing screen is dark from edge to edge, browser bars included.
export const viewport: Viewport = { themeColor: "#16151d" };

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
        <Link className="button coral" href="/login">
          Commencer à gagner
        </Link>
        <p>Tes vues, payées. Partout dans le monde.</p>
      </div>
    </div>
  );
}
