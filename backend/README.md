# Viewzo Backend

REST-API mit NestJS, Prisma und PostgreSQL. Redis steht in `docker-compose.yml` bereit (für spätere Jobs wie View-Abfragen und Timer), wird aber noch nicht genutzt.

## Starten

```bash
docker compose up -d         # PostgreSQL + Redis
npm install
cp .env.example .env
npm run db:migrate           # Tabellen anlegen
npm run start:dev            # http://localhost:3001
```

## SMS-Code (Login)

`OTP_PROVIDER` in `.env` wählt, wer den Code verschickt und prüft:

- `local` (Standard): Das Backend erzeugt den Code selbst und schreibt ihn ins Log. Für Entwicklung und Tests.
- `didit`: [Didit](https://docs.didit.me/standalone-apis/phone-send) verschickt den Code per SMS und prüft ihn. Dafür `DIDIT_API_KEY` setzen.

## API

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `POST` | `/auth/otp/request` | `{ phone }` schickt einen Code |
| `POST` | `/auth/otp/verify` | `{ phone, code }` liefert `accessToken` und Nutzer |
| `GET` | `/me` | Eigenes Konto (Bearer-Token) |
| `POST` | `/me/profiles` | `{ type: CREATOR \| ADVERTISER \| PROVIDER }` aktiviert ein Profil |
| `GET` | `/me/accounts` | Eigene Netzwerke mit Status und Prüfanleitung |
| `POST` | `/me/accounts` | `{ network, handle }` fügt ein Netzwerk hinzu (Profil Créateur nötig) |
| `DELETE` | `/me/accounts/:id` | Netzwerk entfernen (nicht bei Suspendu oder während der 30 Tage) |
| `POST` | `/me/accounts/:id/resubmit` | Nach „À corriger“ oder nach Ablauf der 30 Tage erneut prüfen lassen |
| `GET` / `PUT` | `/me/skills` | Kompetenzformular lesen bzw. speichern |
| `GET` | `/staff/accounts?status=PENDING` | Prüfwarteschlange (nur Team) |
| `GET` | `/staff/accounts/by-code/:code` | WhatsApp-Gespräch per Code dem Creator zuordnen (nur Team) |
| `POST` | `/staff/accounts/:id/review` | `{ status, reason, followers?, avgStatusViews? }` Entscheidung treffen (nur Team). „Éligible“ erst ab 1.000 Abonnenten bzw. 300 Aufrufen pro WhatsApp-Status, auch auf Niveau 1 |
| `GET` | `/campaigns/quote?package=PRO&budget=70000&platforms=TIKTOK,INSTAGRAM` | Plattformauswahl live: was ausgegraut ist und warum, Mindestbudget, Aufteilung, geschätzte Views |
| `POST` | `/campaigns` | Kampagne anlegen und zur Moderation schicken (Profil Annonceur nötig) |
| `GET` | `/me/campaigns`, `/me/campaigns/:id` | Eigene Kampagnen mit Status, Budget pro Plattform, Views-Schätzung, Anzahl Creator |
| `GET` | `/me/tasks` | Aufgaben, die der Creator jetzt annehmen kann |
| `POST` | `/tasks/:id/accept` | Aufgabe annehmen |
| `GET` | `/me/assignments` | Angenommene Aufgaben |
| `POST` | `/me/assignments/:id/submit` | `{ postUrl }` Link zur Veröffentlichung einreichen |
| `GET` | `/staff/campaigns?status=PENDING_REVIEW` | Moderationswarteschlange mit den gelieferten Elementen (nur Team) |
| `POST` | `/staff/campaigns/:id/review` | `{ status: ACTIVE \| REJECTED, reason }` Kampagne freigeben oder ablehnen (nur Team) |
| `GET` | `/health` | Healthcheck |

Kampagnenregeln (Standardwerte aus dem Lastenheft in `src/campaigns/pricing.ts`, später pro Land im Back-Office): Package begrenzt die Plattformen (Basique 1, Pro 3, Premium 6, Élite alle), jede Plattform hat ein Mindestbudget, der Inhaltstyp multipliziert den Preis (× 1 bis × 1,6). Annonceur pro 1.000 Views: 1.000 FCFA, Creator: 450 FCFA, jeweils mal Koeffizient. Annonceure auf Niveau 1 nur Basique und höchstens 100.000 FCFA im Monat. Creator auf Niveau 1 bekommen nur Aufgaben mit gelieferten Elementen aus Basique-Kampagnen.

Team-Zugang: Ein Konto wird zum Team-Mitglied, indem man in der Datenbank `role` auf `STAFF` setzt. Die WhatsApp-Prüfnummern stehen in `WHATSAPP_VERIFICATION_NUMBERS` (`TG:+228…,BJ:+229…`).

## Tests

```bash
npm test                     # Unit-Tests
npm run test:e2e             # End-to-End gegen PostgreSQL
```
