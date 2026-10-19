# Viewzo

Plattform, auf der Annonceure Views kaufen und Creator die Inhalte auf ihren Netzwerken veröffentlichen. Grundlage ist das *Cahier des charges technique — Viewzo*.

## Aufbau

| Ordner | Inhalt | Stack |
| --- | --- | --- |
| `apps/api` | REST-API, Geschäftslogik | NestJS, Prisma, PostgreSQL |
| `apps/web` | Annonceur-Bereich, später Back-Office | Next.js |
| `apps/mobile` | App für Creator, Annonceur und Prestataire | Flutter |

Redis (für Jobs wie View-Abfragen und Timer) steht in `docker-compose.yml` bereit, wird aber noch nicht genutzt.

## Was schon funktioniert

- Anmeldung per SMS-Code (6 Ziffern, 5 Minuten gültig, max. 5 Versuche, 1 Code pro Minute). In der Entwicklung wird der Code im API-Log ausgegeben statt verschickt.
- Beim ersten Login bekommt jeder Nutzer seinen festen Prioritätsrang pro Land (Land aus der Telefonnummer). Die ersten `FOUNDER_BADGE_LIMIT` (Standard 1000) erhalten das Badge Fondateur.
- Ein Konto, bis zu drei Profile: Créateur, Annonceur, Prestataire créatif (jeweils Niveau 1).
- Web und Mobile: Login, Anzeige von Rang und Badge, Profile aktivieren, Logout.

## Lokal starten

Voraussetzungen: Node.js 22, Docker, Flutter (stable).

```bash
docker compose up -d                       # PostgreSQL + Redis
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run db:migrate -w apps/api             # Datenbanktabellen anlegen

npm run dev:api                            # http://localhost:3001
npm run dev:web                            # http://localhost:3000
```

Mobile-App: siehe [`apps/mobile/README.md`](apps/mobile/README.md).

## API

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `POST` | `/auth/otp/request` | `{ phone }` schickt einen Code |
| `POST` | `/auth/otp/verify` | `{ phone, code }` liefert `accessToken` und Nutzer |
| `GET` | `/me` | Eigenes Konto (Bearer-Token) |
| `POST` | `/me/profiles` | `{ type: CREATOR \| ADVERTISER \| PROVIDER }` aktiviert ein Profil |
| `GET` | `/health` | Healthcheck |

## Tests

```bash
npm test -w apps/api                       # Unit-Tests
npm run test:e2e -w apps/api               # End-to-End gegen PostgreSQL
cd apps/mobile && flutter test
```

## Nächste Schritte

1. Echter SMS-Versand (z. B. Bird oder Twilio) hinter `SmsSender`.
2. Netzwerke verknüpfen und „Mes comptes“ mit Verifizierungsstatus.
3. Kampagnen und Aufgaben (Annonceur kauft Views, Creator nimmt Aufgaben an).
4. Wallet mit Treuhand und Mobile Money (CinetPay, FedaPay oder Flutterwave).
