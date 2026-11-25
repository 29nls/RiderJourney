#!/usr/bin/env bash
# Restores a custom-format dump into an explicitly named database. This is
# destructive to that database. Stop application writers first.
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
if [[ "${RESTORE_CONFIRM:-}" != "RESTORE" ]]; then
  echo "Refusing to restore. Set RESTORE_CONFIRM=RESTORE after stopping writers." >&2
  exit 2
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 2
fi
if [[ -f "$BACKUP_FILE.sha256" ]]; then
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE.sha256")")
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
echo "restore=complete"
echo "next=run migration:status, smoke /health/ready, then reconcile billing through the admin job"
