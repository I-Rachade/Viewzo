#!/bin/sh
# Dumps the database and uploads it to Cloudflare R2.
# Old dumps are removed by an R2 lifecycle rule (see deploy/README.md).
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env

name="viewzo-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

pg_dump --format=custom --no-owner --file="/tmp/$name"
aws s3 cp "/tmp/$name" "s3://${R2_BUCKET}/postgres/$name" --endpoint-url "$endpoint" --only-show-errors
rm -f "/tmp/$name"
echo "$(date -u) backup uploaded: postgres/$name"
