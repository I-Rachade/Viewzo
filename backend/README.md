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

## Anmeldung

Registrieren: E-Mail oder Nummer mit einem Code bestätigen, dann Passwort festlegen. Einloggen: E-Mail oder Nummer plus Passwort. Nach 5 Fehlversuchen ist das Konto 15 Minuten gesperrt. Passwörter werden mit scrypt gehasht; ein neues Passwort beendet alle anderen Sitzungen.

`OTP_PROVIDER` in `.env` wählt, wer SMS-Codes verschickt und prüft:

- `local` (Standard): Das Backend erzeugt den Code selbst und schreibt ihn ins Log. Für Entwicklung und Tests.
- `didit`: [Didit](https://docs.didit.me/standalone-apis/phone-send) verschickt den Code per SMS und prüft ihn. Dafür `DIDIT_API_KEY` setzen.

`MAIL_PROVIDER` wählt, wer E-Mail-Codes verschickt (das Backend erzeugt und prüft sie selbst):

- leer (Standard): Die Mail landet im Log.
- `cloudflare`: [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/). Dafür `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_TOKEN` (Berechtigung *Email Sending: Edit*) und optional `MAIL_FROM` (Standard `noreply@viewzo.app`) setzen.

## API

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `POST` | `/auth/register/start` | `{ identifier }` (E-Mail oder Nummer) schickt einen Code, 409 wenn schon registriert |
| `POST` | `/auth/register/verify` | `{ identifier, code }` liefert ein `ticket` (15 Minuten gültig) |
| `POST` | `/auth/register/complete` | `{ ticket, password, role: CREATOR \| ADVERTISER, country? }` legt das Konto an; `country` nur bei E-Mail |
| `POST` | `/auth/login` | `{ identifier, password }` liefert `accessToken` und Nutzer; 403 `PASSWORD_NOT_SET` für alte Konten ohne Passwort |
| `POST` | `/auth/password/forgot` | `{ identifier }` schickt einen Code, falls das Konto existiert |
| `POST` | `/auth/password/reset` | `{ identifier, code, password }` setzt das Passwort und meldet an |
| `POST` | `/auth/contact/request` | `{ identifier }` andere Angabe zum eigenen Konto hinzufügen (Bearer-Token) |
| `POST` | `/auth/contact/verify` | `{ identifier, code }` bestätigt sie |
| `POST` | `/auth/otp/request` | `{ phone }` alter Login per SMS-Code, bleibt bis zum App-Update |
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
| `POST` | `/campaigns/:id/pay` | `{ method: WALLET \| MOBILE_MONEY, phone? }` Budget in den Treuhand legen; bei Mobile Money kommt `checkoutUrl` zurück. Aufgaben erscheinen erst danach |
| `GET` | `/me/wallet` | Verfügbar, gesperrt (Sicherheitsfrist), Treuhand, laufende Auszahlungen, Anbieter des Landes |
| `GET` | `/me/wallet/transactions` | Buchungen (Einzahlung, Treuhand, Gewinn, Provision, Auszahlung, Erstattung) |
| `POST` | `/me/wallet/deposits` | `{ amount, phone? }` Guthaben per Mobile Money aufladen |
| `GET` / `POST` | `/me/wallet/withdrawals` | Auszahlungen ansehen bzw. `{ amount, beneficiaryName, phone?, operator? }` beantragen (ab Niveau 2) |
| `GET` | `/payments/:reference` | Status einer Zahlung, wird beim Anbieter nachgefragt (Rückkehrseite) |
| `POST` | `/payments/webhooks/:provider` | Benachrichtigungen von FedaPay, CinetPay, Flutterwave |
| `GET` | `/staff/withdrawals?status=REQUESTED` | Auszahlungen zur Freigabe (nur Team) |
| `POST` | `/staff/withdrawals/:id/review` | `{ decision: APPROVE \| REJECT, reason? }` Auszahlung senden oder ablehnen (nur Team) |
| `POST` | `/staff/payments/:id/refresh` | Status einer hängenden Zahlung beim Anbieter nachfragen (nur Team) |
| `POST` | `/staff/assignments/:id/views` | `{ totalViews }` geprüfte Views eintragen, schreibt dem Creator den Gewinn gut (nur Team, bis die automatische Zählung kommt) |
| `GET` | `/staff/overview` | Zähler je Warteschlange: Konten, Kampagnen, Auszahlungen, Beiträge zum Zählen (nur Team) |
| `GET` | `/staff/assignments` | Eingereichte Beiträge mit Link, Kampagne und bisher geprüften Views (nur Team) |
| `GET` / `POST` | `/staff/members` | Team-Mitglieder auflisten bzw. `{ phone }` hinzufügen; die Person muss sich vorher einmal angemeldet haben (nur Team) |
| `DELETE` | `/staff/members/:id` | Team-Zugang entziehen, nicht bei sich selbst (nur Team) |
| `GET` | `/countries` | Freigeschaltete Länder (ISO-Codes), öffentlich; alle Länderauswahlen in Web und App nutzen diese Liste |
| `GET` / `POST` | `/staff/countries` | Alle Länder mit Status lesen (Team) bzw. `{ code }` hinzufügen oder wieder einschalten (nur Super-Admin, im Audit-Journal) |
| `PATCH` | `/staff/countries/:code` | `{ enabled }` ein- oder ausschalten (nur Super-Admin, im Audit-Journal) |

Nicht freigeschaltete Länder lehnt der Server mit `400 COUNTRY_NOT_ALLOWED` ab: bei der Registrierung (Telefon schon vor dem Code, E-Mail beim letzten Schritt), bei neuen Konten über den Code-Login, in Kampagnen, im Kompetenzformular und bei den Ländern eines Team-Mitglieds. Bestehende Konten eines abgeschalteten Landes bleiben nutzbar.

Eine nachträglich hinzugefügte Telefonnummer muss aus dem Land des Kontos stammen (`400 PHONE_COUNTRY_MISMATCH`) und dieses Land muss freigeschaltet sein. Beides wird geprüft, bevor die SMS rausgeht; eine Nummer ohne Vorwahl wird im Land des Kontos gelesen.

Ein Creator ohne bestätigte Telefonnummer (Registrierung per E-Mail, oder ein Annonceur, der später das Creator-Profil aktiviert) darf nur ansehen: Kampagnen (`GET /me/tasks`), eigene Aufgaben und Ergebnisse. Alle Creator-Aktionen antworten `403 PHONE_REQUIRED`: Aufgaben annehmen, Links und Beweise senden, Konten, Kompetenzen, Verbindungen und Auszahlungen. `/me` liefert dafür `phoneRequired`.

| `GET` | `/health` | Healthcheck |

Kampagnenregeln (Standardwerte aus dem Lastenheft in `src/campaigns/pricing.ts`, später pro Land im Back-Office): Package begrenzt die Plattformen (Basique 1, Pro 3, Premium 6, Élite alle), jede Plattform hat ein Mindestbudget, der Inhaltstyp multipliziert den Preis (× 1 bis × 1,6). Annonceur pro 1.000 Views: 1.000 FCFA, Creator: 450 FCFA, jeweils mal Koeffizient. Annonceure auf Niveau 1 nur Basique und höchstens 100.000 FCFA im Monat. Creator auf Niveau 1 bekommen nur Aufgaben mit gelieferten Elementen aus Basique-Kampagnen.

Team-Zugang: Das erste Team-Mitglied entsteht, indem man in der Datenbank `role` auf `STAFF` setzt (`UPDATE "User" SET role = 'STAFF' WHERE phone = '+228…';`). Weitere fügt das Team selbst über `/staff/members` hinzu. `GET /me` liefert dafür `isStaff`. Die WhatsApp-Prüfnummern stehen in `WHATSAPP_VERIFICATION_NUMBERS` (`TG:+228…,BJ:+229…`).

## Zahlungen

Der Anbieter richtet sich nach dem Land der Telefonnummer: FedaPay für Togo und Benin, CinetPay für die übrigen frankophonen Länder, Flutterwave für alle anderen. `PAYMENT_ROUTES` überschreibt das, z. B. `TG:fedapay,CI:cinetpay,*:flutterwave`. Ein Anbieter ohne Schlüssel lehnt Zahlungen ab, bis die Schlüssel gesetzt sind. Lokal gilt `PAYMENT_MODE=local`: jede Zahlung gelingt sofort.

Webhooks sind nur ein Signal: Der Status wird immer über die API des Anbieters nachgelesen, nie aus der Benachrichtigung übernommen. Webhook-URL im Dashboard des Anbieters: `https://api.<domain>/payments/webhooks/fedapay` (bzw. `cinetpay`, `flutterwave`).

Regeln aus dem Lastenheft:

- Das Budget einer Kampagne liegt im Treuhand, bevor Creator die Aufgaben sehen. Eine abgelehnte Kampagne bekommt den Rest zurück.
- Pro geprüfter View zahlt der Annonceur den Preis mal Koeffizient aus dem Treuhand, der Creator bekommt seinen Satz. Views über dem Budget der Aufgabe werden nicht bezahlt.
- Gewinne eines Monats werden ab dem 1. des Folgemonats auszahlbar, für Certifiés (Niveau 3) nach 3 Tagen.
- Niveau 1: Gewinne höchstens 10.000 FCFA, Auszahlung erst ab Niveau 2.
- Jede Auszahlung gibt das Team einzeln frei; abgelehnte oder gescheiterte Auszahlungen gehen zurück ins Guthaben.

## Tests

```bash
npm test                     # Unit-Tests
npm run test:e2e             # End-to-End gegen PostgreSQL
```
