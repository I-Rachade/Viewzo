# Viewzo

Plattform, auf der Annonceure Views kaufen und Creator die Inhalte auf ihren Netzwerken veröffentlichen. Grundlage ist das *Cahier des charges technique — Viewzo*.

Das Repository ist in zwei unabhängige Bereiche getrennt. Jeder hat eigene Abhängigkeiten, eigene Tests und eine eigene CI. Sie sprechen nur über die REST-API miteinander.

| Ordner | Inhalt | Stack |
| --- | --- | --- |
| [`backend/`](backend/README.md) | REST-API, Geschäftslogik, Datenbank | NestJS, Prisma, PostgreSQL |
| [`frontend/web/`](frontend/web/README.md) | Annonceur-Bereich, später Back-Office | Next.js |
| [`frontend/mobile/`](frontend/mobile/README.md) | App für Creator, Annonceur und Prestataire | Flutter (Android, iOS) |

## Was schon funktioniert

- Anmeldung per SMS-Code (6 Ziffern, 5 Minuten gültig, max. 5 Versuche, 1 Code pro Minute). Der Versand läuft über Didit (`OTP_PROVIDER=didit`), in der Entwicklung steht der Code stattdessen im Backend-Log.
- Beim ersten Login bekommt jeder Nutzer seinen festen Prioritätsrang pro Land (Land aus der Telefonnummer). Die ersten `FOUNDER_BADGE_LIMIT` (Standard 1000) erhalten das Badge Fondateur.
- Ein Konto, bis zu drei Profile: Créateur, Annonceur, Prestataire créatif (jeweils Niveau 1).
- Web und Mobile: Login, Anzeige von Rang und Badge, Profile aktivieren, Logout.

## Schnellstart

```bash
# Backend (Terminal 1)
cd backend
docker compose up -d
npm install && cp .env.example .env
npm run db:migrate
npm run start:dev            # http://localhost:3001

# Web (Terminal 2)
cd frontend/web
npm install && cp .env.example .env.local
npm run dev                  # http://localhost:3000
```

Mobile-App: siehe [`frontend/mobile/README.md`](frontend/mobile/README.md).

## Nächste Schritte

1. Netzwerke verknüpfen und „Mes comptes“ mit Verifizierungsstatus.
2. Kampagnen und Aufgaben (Annonceur kauft Views, Creator nimmt Aufgaben an).
3. Wallet mit Treuhand und Mobile Money (CinetPay, FedaPay oder Flutterwave).
