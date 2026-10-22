import Link from "next/link";

import { LandingCount } from "./landing-counts";
import { Logo } from "./logo";
import styles from "./page.module.css";

// Every channel a campaign can run on, the street included.
const CHANNELS = [
  "WhatsApp Statut",
  "TikTok",
  "Instagram",
  "Facebook",
  "YouTube",
  "X",
  "Terrain",
];

// A few of the countries creators sign up from; "+ le monde" says the rest.
const FLAGS = ["🇹🇬", "🇧🇯", "🇨🇮", "🇸🇳", "🇨🇲", "🇬🇭", "🇳🇬", "🇫🇷"];

// The hero: promise and the two open doors on the left, on the right a phone
// showing what a creator sees when a status is counted.
export default function Home() {
  return (
    <div className={`hero full ${styles.landing}`}>
      <header className={styles.top}>
        <span className={styles.brand}>
          <Logo size={34} />
          Viewzo
        </span>
        <Link href="/login" className={styles.login}>
          Se connecter
        </Link>
      </header>

      <section className={styles.grid}>
        <div className={styles.copy}>
          <span className={`${styles.eyebrow} rise`}>
            <i aria-hidden="true" /> Payé à la vue, sur tous les réseaux
          </span>
          <h1 className="rise" style={{ animationDelay: "120ms" }}>
            Ton audience vaut de l’argent.{" "}
            <span className={styles.paid}>Tes vues, payées.</span>
          </h1>
          <p className="rise" style={{ animationDelay: "240ms" }}>
            Les créateurs gagnent avec chaque vue vérifiée, même avec un seul
            réseau ou leurs statuts WhatsApp. Les annonceurs ne paient que des
            résultats prouvés.
          </p>
          <div
            className={`${styles.ctas} rise`}
            style={{ animationDelay: "360ms" }}
          >
            <Link className="button coral" href="/inscription?profil=CREATOR">
              Je suis créateur
            </Link>
            <Link
              className="button secondary"
              href="/inscription?profil=ADVERTISER"
            >
              Je suis annonceur
            </Link>
          </div>
          <small
            className={`${styles.soon} rise`}
            style={{ animationDelay: "480ms" }}
          >
            Bientôt : créatifs et experts marketing
          </small>
        </div>

        <div className={styles.visual} aria-hidden="true">
          <span className={`${styles.bubble} ${styles.views}`}>+12 vues</span>
          <div className={styles.phone}>
            <div className={styles.notch} />
            <p className={styles.label}>Statut WhatsApp · Campagne en cours</p>
            <div className={styles.post}>
              <Logo size={72} animated />
            </div>
            <div className={styles.stats}>
              <div>
                <small>Vues</small>
                <strong>
                  <LandingCount value={1240} />
                </strong>
              </div>
              <div>
                <small>Gagné</small>
                <strong className={styles.earned}>
                  <LandingCount value={6200} money />
                </strong>
              </div>
            </div>
            <div className={styles.bar}>
              <span />
            </div>
            <p className={styles.payout}>Retrait Mobile Money disponible</p>
          </div>
          <span className={`${styles.bubble} ${styles.money}`}>+60 F</span>
        </div>
      </section>

      <footer className={`${styles.trust} rise`} style={{ animationDelay: "600ms" }}>
        <ul className={styles.channels}>
          {CHANNELS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className={styles.flags}>
          <span aria-hidden="true">{FLAGS.join(" ")}</span> + le monde entier
        </p>
      </footer>
    </div>
  );
}
