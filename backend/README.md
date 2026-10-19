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
| `POST` | `/staff/accounts/:id/review` | `{ status, reason, followers?, avgStatusViews? }` Entscheidung treffen (nur Team) |
| `GET` | `/health` | Healthcheck |

Team-Zugang: Ein Konto wird zum Team-Mitglied, indem man in der Datenbank `role` auf `STAFF` setzt. Die WhatsApp-Prüfnummern stehen in `WHATSAPP_VERIFICATION_NUMBERS` (`TG:+228…,BJ:+229…`).

## Tests

```bash
npm test                     # Unit-Tests
npm run test:e2e             # End-to-End gegen PostgreSQL
```
