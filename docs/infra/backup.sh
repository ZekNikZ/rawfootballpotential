#!/bin/sh
# Periodic pg_dump with local retention and an optional S3 copy.
#   backup.sh          loop forever (container default)
#   backup.sh once     single backup, e.g. `docker compose run --rm backup once`
# Restore: pg_restore --clean --if-exists -d "$DATABASE_URL" rfp-YYYYMMDD-HHMM.dump
set -eu

run_backup() {
  f="/backups/rfp-$(date +%Y%m%d-%H%M).dump"
  pg_dump -Fc -f "$f.tmp"
  mv "$f.tmp" "$f"
  echo "backup ok: $f ($(du -h "$f" | cut -f1))"

  if [ -n "${S3_BUCKET:-}" ]; then
    endpoint=""
    [ -n "${S3_ENDPOINT_URL:-}" ] && endpoint="--endpoint-url $S3_ENDPOINT_URL"
    # shellcheck disable=SC2086
    aws s3 cp $endpoint "$f" "s3://$S3_BUCKET/${S3_PREFIX:-}$(basename "$f")" --only-show-errors
    echo "uploaded: s3://$S3_BUCKET/${S3_PREFIX:-}$(basename "$f")"
    # Remote retention is handled by a bucket lifecycle rule, not here.
  fi

  find /backups -name 'rfp-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
}

if [ "${1:-}" = "once" ]; then
  run_backup
  exit 0
fi

while true; do
  run_backup || echo "backup FAILED" >&2
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
