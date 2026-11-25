#!/usr/bin/env bash
# PostgreSQL logical backup with checksum. Run from a host that already has
# pg_dump. Object storage is versioned separately; this script does not copy bytes.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

FILE="$OUT_DIR/riderjourney-$STAMP.dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$FILE"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$FILE" > "$FILE.sha256"
else
  shasum -a 256 "$FILE" > "$FILE.sha256"
fi

echo "backup=$FILE"
echo "checksum_file=$FILE.sha256"
echo "next=store this dump and checksum in encrypted offsite storage, then verify with ops/restore.sh"
