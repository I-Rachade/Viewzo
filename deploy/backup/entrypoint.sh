#!/bin/sh
# Runs backup.sh on BACKUP_CRON (default: every day at 03:00 UTC).
set -eu
echo "${BACKUP_CRON:-0 3 * * *} /usr/local/bin/backup.sh" > /etc/crontabs/root
# Forward the container env to cron jobs.
export -p > /etc/backup.env
exec crond -f -l 6
