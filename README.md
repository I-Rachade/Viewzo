# Viewzo

Plattform, auf der Annonceure Views kaufen und Creator die Inhalte auf ihren Netzwerken veröffentlichen. Grundlage ist das *Cahier des charges technique — Viewzo*.

Das Repository ist in zwei unabhängige Bereiche getrennt. Jeder hat eigene Abhängigkeiten, eigene Tests und eine eigene CI. Sie sprechen nur über die REST-API miteinander.

| Ordner | Inhalt | Stack |
| --- | --- | --- |
| [`backend/`](backend/README.md) | REST-API, Geschäftslogik, Datenbank | NestJS, Prisma, PostgreSQL |
| [`frontend/web/`](frontend/web/README.md) | Creator-, Annonceur-Bereich und Back-Office | Next.js |
| [`frontend/mobile/`](frontend/mobile/README.md) | App für Creator, Annonceur und Prestataire | Flutter (Android, iOS) |

## Was schon funktioniert

- Anmeldung per SMS-Code (6 Ziffern, 5 Minuten gültig, max. 5 Versuche, 1 Code pro Minute). Der Versand läuft über Didit (`OTP_PROVIDER=didit`), in der Entwicklung steht der Code stattdessen im Backend-Log.
- Beim ersten Login bekommt jeder Nutzer seinen festen Prioritätsrang pro Land (Land aus der Telefonnummer). Die ersten `FOUNDER_BADGE_LIMIT` (Standard 1000) erhalten das Badge Fondateur.
- Ein Konto, bis zu drei Profile: Créateur, Annonceur, Prestataire créatif (jeweils Niveau 1).
- „Mes comptes“ (Web und Mobile): Creator tragen ihre Konten von Hand ein, mit Plattform, Kontoname oder Profil-Link und optional der Follower-Zahl (TikTok bis WhatsApp Statut, eins pro Netzwerk; dasselbe Konto nur einmal auf ganz Viewzo). Anonyme Konten sind verboten, der Creator bestätigt das beim Speichern. Jedes Konto bekommt einen Code `VZ-123456` für die Bio bzw. für die WhatsApp-Nachricht an die offizielle Prüfnummer des Landes und durchläuft die Status En vérification, Éligible, À corriger, Non éligible (neuer Versuch nach 30 Tagen) und Suspendu. Jede Entscheidung wird mit Begründung protokolliert.
- Automatische Vorprüfung beim Hinzufügen, wo die Plattform es offiziell erlaubt: YouTube (`YOUTUBE_API_KEY`), öffentliche Telegram-Kanäle (`TELEGRAM_BOT_TOKEN`) und Instagram-Business-/Creator-Konten (`INSTAGRAM_DISCOVERY_USER_ID`, `INSTAGRAM_DISCOVERY_TOKEN`). Das System trägt die Follower-Zahl ein und lehnt Konten ab, die es nicht gibt (YouTube) oder die weder Namen noch Profilbild haben. Alle anderen Plattformen prüft das Team im Back-Office; automatisch abgelehnte Konten stehen dort in einem eigenen Filter.
- Aufgaben auf Plattformen ohne geprüftes Konto erscheinen gesperrt und lassen sich nicht annehmen.
- Kompetenzformular (Backend und Mobile): Aufgabentypen, Spezialitäten, Gesicht, Material, 3 bis 5 Beispielvideos (Pflicht für eigene Videos), Sprachen, Länder und Städte, Themen, Verfügbarkeit.
- Kampagnen und Aufgaben (Backend, Web für Annonceure, Mobile für Creator): Annonceure legen Kampagnen an (Ziel, Länder, Zeitraum, Package, Budget, Plattformen mit Inhaltstyp, gelieferte Elemente, Vorgaben). Plattformen außerhalb von Package oder Budget werden mit Grund ausgegraut. Das Team prüft und gibt frei, danach sehen passende Creator die Aufgaben (berechtigtes Konto, Land, Kompetenzen, Niveau, nie eigene Kampagnen), nehmen sie an und reichen den Link ein.
- Wallet und Treuhand (Backend, Web und Mobile): Das Kampagnenbudget liegt im Treuhand, bevor Creator die Aufgaben sehen. Einzahlung und Auszahlung per Mobile Money über FedaPay (Togo, Benin), CinetPay (übrige frankophone Länder) oder Flutterwave (alle anderen). Annonceure bezahlen Kampagnen im Web aus dem Guthaben oder per Mobile Money. Gewinne werden ab dem Folgemonat auszahlbar, Auszahlungen ab Niveau 2 und nach Freigabe durch das Team.
- Back-office (Backend und Web unter `/staff`): Konten prüfen (auch per WhatsApp-Code), Kampagnen moderieren, Auszahlungen freigeben, Team-Mitglieder hinzufügen und entfernen, erlaubte Länder verwalten (Tab „Pays“). Jede Länderauswahl in Web und App bietet nur diese Länder an: geschlossen nur die Flagge, geöffnet Flagge und Name.
- Publikationen im Back-office (`/staff/publications`): jede Publikation mit Risiko-Score, gefiltert nach Status, Netzwerk, Land und Suche. Das Dossier einer Publikation zeigt den Verlauf der Views (Creator-Captures, automatische Abrufe, Freigaben des Teams), alle Captures mit Aufnahmezeit, Gerät, IP und Bild-Fingerabdruck, das Briefing, die Betrugssignale, den Creator und die Chronologie. Entscheidungen: Views validieren, Korrektur verlangen, ablehnen (bereits gutgeschriebene, noch gesperrte Gewinne werden storniert) oder das Konto sperren. Jede Entscheidung mit Begründung, die der Creator sieht.
- Creator-Akte (`/staff/createurs/<id>`): Konten, Profil, alle Publikationen, Auszahlungen, Kontoentscheidungen und Konten, die dasselbe Gerät nutzen.
- Betrugssignale: Sprung der Views, sinkende Zahlen, mehr Views als die Reichweite des Kontos, dieselbe Capture für mehrere Publikationen, Capture älter als die Annahme der Aufgabe, fehlende Aufnahmezeit, Link passt nicht zum Netzwerk, gemeinsames Gerät oder gemeinsame IP, frühere Ablehnungen. Ab Score 50 erscheint die Publikation unter „Alertes fraude“.
- WhatsApp Statut: Der Creator schickt in der App drei Captures (am Anfang, nach 12 Stunden, vor 24 Stunden) mit den sichtbaren Views und wird an fehlende erinnert.
- Automatischer Abruf der Views alle 10 Minuten, wo die Plattformen es erlauben: YouTube und X mit einem Schlüssel von Viewzo, Telegram ohne Schlüssel (öffentliche Kanäle), TikTok, Instagram, Facebook und Threads sobald der Creator sein Konto unter „Comptes connectés“ verbindet (zurzeit ausgeblendet, `OAUTH_CONNECTIONS_ENABLED=1` schaltet es wieder ein). Nicht möglich: Snapchat, LinkedIn-Privatprofile und WhatsApp Statut (dort bleiben die Captures).
- Creator (Web unter `/resultats` und App): validierte Views, Verdienst im Monat und gesamt, Validierungsquote, Status und Begründung jeder Publikation, Captures hochladen.
- Annonceure (Web unter `/campaigns/<id>`): Live-Bericht mit geprüften Views, Kosten pro 1 000 Views, Views pro Netzwerk und Land, Tageskurve, Galerie der validierten Publikationen und CSV-Export. Abgerechnet werden nur geprüfte Views.
- Benachrichtigungen (Web und App): neue Aufgabe, Erinnerung an eine Capture, Publikation validiert, zu korrigieren oder abgelehnt, Konto geprüft, Kampagne geprüft, Auszahlung.
- Web mit Menüleiste: Seitenmenü mit Wechsel Créateur/Annonceur und Back-office-Bereich für das Team, auf dem Handy Menü und Tab-Leiste unten.
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

## Deployment

Web und API laufen per Docker Compose auf einem VPS hinter Cloudflare, mit täglichen Datenbank-Backups nach R2 und Deploy über GitHub Actions. Anleitung: [`deploy/README.md`](deploy/README.md).

## Nächste Schritte

1. Plattform-Apps für den automatischen Abruf anlegen und prüfen lassen (siehe [`deploy/README.md`](deploy/README.md#automatischer-abruf-der-views)).
2. Push-Benachrichtigungen auf dem Handy (Firebase), bisher nur in der App und im Web.
3. Views aus Captures automatisch lesen (Texterkennung), Einstellungen pro Land im Back-Office.
