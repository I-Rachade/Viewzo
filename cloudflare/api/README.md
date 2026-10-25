# Probe: Viewzo-API auf Cloudflare Workers mit D1

Schritt 0 des Plans „Viewzo komplett auf Cloudflare“. Hier wird geprüft, ob die schwierigen Teile der API ohne eigenen Server laufen: Login, Geldbuchungen ohne PostgreSQL-Transaktionen und das Mitlesen von TikTok-Lives. Die echte API in `backend/` bleibt unverändert, viewzo.app ist nicht betroffen.

| Datei | Inhalt |
| --- | --- |
| `prisma/schema.prisma` | Tabellen User, Session, UserProfile, Transaction, Payment als SQLite für D1 |
| `migrations/0001_init.sql` | daraus erzeugtes SQL (`npm run db:sql`) |
| `migrations/0002_wallet_guards.sql` | Sperren in der Datenbank, die `pg_advisory_xact_lock` ersetzen |
| `src/auth.ts` | `POST /auth/login` (E-Mail oder Telefon + Passwort), Sessions, Bearer-Token |
| `src/wallet.ts` | `GET /wallet`, `POST /wallet/withdrawals`, `POST /staff/wallet/withdrawals/:id/approve` |
| `src/live.ts` | Durable Object `LiveReader`: eine Instanz pro laufendem TikTok-Live |

## Ergebnisse

- **Prisma 7 läuft im Workers-Runtime mit D1** (`@prisma/adapter-d1`, ohne Rust-Engine). Gebündelt etwa 1,3 MB komprimiert, passt in Workers Paid (Grenze 10 MB).
- **Login** mit denselben Regeln wie `backend/src/auth`: scrypt-Passwörter (dieselben Hashes, also keine neuen Passwörter nötig), Sperre nach 5 Fehlversuchen auch bei gleichzeitigen Versuchen, Sessions in der Datenbank, Telefonnummer auch im lokalen Format.
- **Geld ohne interaktive Transaktionen.** Eine Abhebung schreibt Zahlung und Buchung in einem D1-Batch (ganz oder gar nicht). Den Kontostand prüft ein Trigger in der Datenbank, mit derselben Formel wie `WalletService.balance()`. 20 gleichzeitige Abhebungen von je 1000 bei 5000 Guthaben: genau 5 gehen durch, Saldo 0. Zur Kontrolle: der alte Weg (erst lesen, dann schreiben) ohne Sperre zahlt in demselben Test alle 20 aus.
- **Freigaben** sind Compare-and-set (`WHERE status = 'REQUESTED'`): drei gleichzeitige Klicks, eine Freigabe. Eine abgeschlossene Zahlung kann auch per SQL nicht wieder geöffnet werden.
- **TikTok-Live.** `tiktok-live-connector` lädt im Worker nicht (sein HTTP-Client braucht Node-Interna). Die Protokoll-Bibliothek darunter (`tiktok-live-proto`) läuft aber, ebenso gzip und WebSockets. Der `LiveReader` dekodiert TikTok-Frames und speichert Kommentare ohne Dubletten. Was fehlt, ist der Verbindungsaufbau zu TikTok (Raum finden, URL über die Euler-Sign-API signieren); das braucht einen echten Live und den `EULER_API_KEY` und ist der nächste Test.

## Lokal ausführen

```bash
cd cloudflare/api
npm install          # erzeugt auch den Prisma-Client
npm test             # Tests im Workers-Runtime mit lokaler D1
npm run dev          # lokale API auf http://localhost:8787
```

Für `npm run dev` vorher die Tabellen anlegen und ein Secret setzen:

```bash
npx wrangler d1 migrations apply viewzo-probe --local
echo 'JWT_SECRET=lokal-mindestens-32-zeichen-langes-geheimnis' > .dev.vars
```

## Beta-Adresse (erst nach Freigabe)

Braucht ein Cloudflare-API-Token mit Rechten für Workers, D1 und Durable Objects:

```bash
npx wrangler d1 create viewzo-beta        # ID in wrangler.jsonc unter env.beta eintragen
npx wrangler d1 migrations apply viewzo-beta --remote --env beta
npx wrangler secret put JWT_SECRET --env beta
npm run deploy:beta
```
