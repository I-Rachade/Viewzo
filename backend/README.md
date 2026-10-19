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
| `GET` | `/health` | Healthcheck |

## Tests

```bash
npm test                     # Unit-Tests
npm run test:e2e             # End-to-End gegen PostgreSQL
```
