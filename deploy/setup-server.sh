#!/bin/sh
# One-time setup of a fresh Ubuntu 24.04 VPS. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/I-Rachade/Viewzo/main/deploy/setup-server.sh | sh -s -- "<public SSH key for GitHub Actions>"
set -eu
DEPLOY_KEY="${1:?pass the public SSH key used by GitHub Actions}"

apt-get update
apt-get install -y ca-certificates curl ufw unattended-upgrades
curl -fsSL https://get.docker.com | sh

# Deploy user that GitHub Actions logs in as.
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -o deploy -g deploy /opt/viewzo /opt/viewzo/certs

# Only SSH and web traffic.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Done. Next: put .env and the Cloudflare origin certificate into /opt/viewzo (see deploy/README.md)."
