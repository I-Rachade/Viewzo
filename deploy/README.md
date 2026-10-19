# Deployment auf einem VPS

Die Web-App und die API laufen mit Docker Compose auf einem eigenen Server. Cloudflare steht davor (Domain, DNS, CDN, Angriffsschutz), Datenbank-Backups landen täglich in Cloudflare R2. Die Mobile-Apps laufen nicht auf dem Server, sie gehen in den App Store und Play Store und sprechen nur mit der API.

```
Browser / App ──▶ Cloudflare ──HTTPS──▶ Caddy ──▶ web (Next.js, :3000)   viewzo.app
                                              └─▶ api (NestJS, :3001)    api.viewzo.app
                                                      │
                                                  postgres ◀── backup ──▶ R2 (täglich)
```

| Datei | Zweck |
| --- | --- |
| `docker-compose.yml` | Stack auf dem Server: Postgres, API, Web, Caddy, Backup |
| `Caddyfile` | HTTPS und Weiterleitung `DOMAIN` → Web, `api.DOMAIN` → API |
| `backup/` | Image, das per Cron `pg_dump` nach R2 hochlädt |
| `.env.example` | Alle Einstellungen und Secrets für den Server |
| `setup-server.sh` | Einmalige Einrichtung eines frischen Ubuntu-Servers |
| `../.github/workflows/deploy.yml` | Baut die Images und deployt per SSH |

## So läuft ein Deploy

1. Bei jedem Pull Request baut GitHub Actions die drei Images (API, Web, Backup) zur Kontrolle, ohne sie zu veröffentlichen.
2. Bei jedem Push auf `main` werden sie nach GitHub Container Registry (`ghcr.io/i-rachade/viewzo-*`) gepusht.
3. Erst wenn die Repository-Variable `DEPLOY_HOST` gesetzt ist, verbindet sich Actions per SSH mit dem Server, kopiert `docker-compose.yml` und `Caddyfile` nach `/opt/viewzo`, zieht die neuen Images und startet neu. Die API wendet beim Start offene Datenbank-Migrationen an (`prisma migrate deploy`).

Ohne `DEPLOY_HOST` wird also nie etwas auf einen Server gespielt. Wer jeden Deploy einzeln freigeben will, trägt sich unter *Settings → Environments → production → Required reviewers* ein.

## Einmalige Einrichtung

### 1. Server mieten

Zum Beispiel Hetzner Cloud, Ubuntu 24.04, 4 GB RAM (CX22 oder CAX11), Standort nach Wahl. Beim Anlegen den eigenen SSH-Schlüssel hinterlegen und die öffentliche IPv4 notieren.

### 2. Schlüssel für GitHub Actions erzeugen

Auf dem eigenen Rechner:

```bash
ssh-keygen -t ed25519 -f viewzo-deploy -N "" -C github-actions
```

`viewzo-deploy.pub` kommt auf den Server, `viewzo-deploy` (privat) als Secret zu GitHub.

### 3. Server vorbereiten

```bash
ssh root@<SERVER-IP>
curl -fsSL https://raw.githubusercontent.com/I-Rachade/Viewzo/main/deploy/setup-server.sh -o setup-server.sh
sh setup-server.sh "$(cat <<'KEY'
<Inhalt von viewzo-deploy.pub>
KEY
)"
```

Das Skript installiert Docker, legt den Benutzer `deploy` an, öffnet in der Firewall nur SSH, 80 und 443 und erstellt `/opt/viewzo`.

### 4. Cloudflare

1. Domain zu Cloudflare hinzufügen und die Nameserver beim Registrar umstellen.
2. DNS: drei `A`-Einträge auf die Server-IP, alle **Proxied** (orange Wolke): `@`, `www`, `api`.
3. *SSL/TLS → Overview*: Modus **Full (strict)**.
4. *SSL/TLS → Origin Server → Create Certificate*: Hostnames `viewzo.app, *.viewzo.app`, Gültigkeit 15 Jahre. Zertifikat und Schlüssel auf dem Server speichern:

   ```bash
   sudo -u deploy nano /opt/viewzo/certs/origin.pem       # Origin Certificate
   sudo -u deploy nano /opt/viewzo/certs/origin-key.pem   # Private Key
   chmod 644 /opt/viewzo/certs/origin.pem
   chmod 600 /opt/viewzo/certs/origin-key.pem
   ```

   Caddy liefert damit HTTPS zwischen Cloudflare und Server aus; ein Erneuern ist erst in 15 Jahren nötig.

### 5. R2 für Backups

1. *R2 → Create bucket*: `viewzo-backups` (zweiter Bucket für Medien und Screenshots kommt später).
2. Im Bucket unter *Settings → Object lifecycle rules*: Objekte mit Präfix `postgres/` nach 30 Tagen löschen.
3. *R2 → Manage API tokens → Create API token*: Berechtigung *Object Read & Write*, nur für diesen Bucket. Access Key ID, Secret Access Key und Account ID notieren.

### 6. `.env` auf dem Server

```bash
sudo -u deploy nano /opt/viewzo/.env   # Inhalt von deploy/.env.example einfügen und ausfüllen
chmod 600 /opt/viewzo/.env
```

Pflicht: `DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `OTP_SECRET` (je `openssl rand -hex 32`), `DIDIT_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

### 7. GitHub

Unter *Settings → Secrets and variables → Actions*:

| Art | Name | Wert |
| --- | --- | --- |
| Secret | `DEPLOY_SSH_KEY` | Inhalt von `viewzo-deploy` (privater Schlüssel) |
| Secret (optional) | `DEPLOY_KNOWN_HOSTS` | Ausgabe von `ssh-keyscan <SERVER-IP>`, sonst wird der Host-Schlüssel beim ersten Deploy übernommen |
| Variable | `DOMAIN` | z. B. `viewzo.app` (die Web-App ruft damit `https://api.viewzo.app` auf) |
| Variable | `DEPLOY_HOST` | Server-IP. **Erst setzen, wenn Schritt 1 bis 6 erledigt sind**, denn ab dann deployt jeder Push auf `main`. |

Den ersten Deploy startet man unter *Actions → Deploy → Run workflow*.

### 8. Mobile-Apps

Release-Builds mit der Produktions-API bauen:

```bash
flutter build appbundle --dart-define=API_URL=https://api.viewzo.app   # Play Store
flutter build ipa       --dart-define=API_URL=https://api.viewzo.app   # App Store
```

## Betrieb

```bash
ssh deploy@<SERVER-IP>
cd /opt/viewzo
docker compose ps                    # Status
docker compose logs -f api           # Logs der API
docker compose exec backup backup.sh # Backup sofort auslösen
```

### Backup zurückspielen

```bash
cd /opt/viewzo
docker compose exec backup sh -c 'aws s3 ls s3://$R2_BUCKET/postgres/ --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com'
docker compose exec backup sh -c 'aws s3 cp s3://$R2_BUCKET/postgres/<DATEI>.dump /tmp/restore.dump --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
  && pg_restore --clean --if-exists --no-owner -d viewzo /tmp/restore.dump'
```

### Version zurückrollen

Jedes Image ist auch mit dem Commit-Hash getaggt:

```bash
IMAGE_TAG=<commit-sha> docker compose up -d
```
