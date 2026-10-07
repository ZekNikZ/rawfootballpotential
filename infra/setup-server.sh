#!/usr/bin/env bash
# One-time setup of a fresh Debian 12/13 or Ubuntu 22.04/24.04 server (VM or privileged LXC) for the RFP stack.
#
#   sudo ./setup-server.sh                      # interactive
#   sudo RFP_TAG=v1.0.0 PUBLIC_URL=https://rawfootballpotential.com ./setup-server.sh
#
# What it does: installs Docker Engine + compose plugin, creates /opt/rfp with docker-compose.yml and a .env that has
# generated secrets, optionally enables a firewall, pulls the images and starts the stack. It never prints secrets.
# Safe to re-run: an existing .env is kept, only missing values are reported.
#
# docker-compose.yml: put it next to this script (or in /opt/rfp) first (`scp docker-compose.yml host:`), or set
# COMPOSE_URL (e.g. the raw GitHub URL on main) if the repository is public.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/rfp}"
RFP_TAG="${RFP_TAG:-latest}"
PUBLIC_URL="${PUBLIC_URL:-https://rawfootballpotential.com}"
WEB_PORT="${WEB_PORT:-8080}"
WEB_BIND="${WEB_BIND:-0.0.0.0}"      # 127.0.0.1 if your reverse proxy runs on this same machine
TZ_NAME="${TZ_NAME:-America/New_York}"
LAN_CIDR="${LAN_CIDR:-}"             # e.g. 192.168.1.0/24: enables ufw, allows SSH + WEB_PORT from there only
COMPOSE_URL="${COMPOSE_URL:-}"
RUNNER_USER="${RUNNER_USER:-}"        # e.g. rfp-runner: create this user for the GitHub self-hosted runner (docs/deploy-runner.md)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -r /etc/os-release ] || die "cannot detect the OS"
. /etc/os-release
case "$ID" in debian | ubuntu) ;; *) die "this script supports Debian and Ubuntu (found: $ID)" ;; esac

log "Base packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg openssl ufw unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine (official apt repository)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
# Keep container logs from filling the disk (the compose file also caps them per service).
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "local",\n  "log-opts": { "max-size": "10m", "max-file": "5" }\n}\n' >/etc/docker/daemon.json
  systemctl restart docker
fi

log "Application folder $APP_DIR"
mkdir -p "$APP_DIR/backups"
if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
  if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then cp "$SCRIPT_DIR/docker-compose.yml" "$APP_DIR/"
  elif [ -f "$SCRIPT_DIR/../docker-compose.yml" ]; then cp "$SCRIPT_DIR/../docker-compose.yml" "$APP_DIR/"
  elif [ -n "$COMPOSE_URL" ]; then curl -fsSL "$COMPOSE_URL" -o "$APP_DIR/docker-compose.yml"
  else die "no docker-compose.yml: copy it to $APP_DIR (or next to this script), or set COMPOSE_URL"; fi
fi

if [ -f "$APP_DIR/.env" ]; then
  log ".env already exists, keeping it"
else
  log "Writing .env with generated secrets (mode 600)"
  umask 077
  cat >"$APP_DIR/.env" <<ENV
RFP_TAG=$RFP_TAG
POSTGRES_USER=rfp
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=rfp
POSTGRES_HOST_PORT=5432
WEB_BIND=$WEB_BIND
WEB_PORT=$WEB_PORT
PUBLIC_URL=$PUBLIC_URL
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
TZ=$TZ_NAME
INGEST_SCHEDULES_ENABLED=true
LOG_LEVEL=info
BACKUP_DIR=./backups
BACKUP_INTERVAL_SECONDS=86400
BACKUP_RETENTION_DAYS=14
S3_BUCKET=
S3_PREFIX=rfp/
S3_ENDPOINT_URL=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
ENV
  chmod 600 "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"

if [ -n "$RUNNER_USER" ]; then
  log "User ${RUNNER_USER} for the GitHub Actions runner (owns $APP_DIR, member of the docker group)"
  id "$RUNNER_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$RUNNER_USER"
  usermod -aG docker "$RUNNER_USER"
  chown -R "$RUNNER_USER:$RUNNER_USER" "$APP_DIR"
  echo "note: members of the docker group are effectively root on this machine; keep this host for this purpose."
fi

if [ -n "$LAN_CIDR" ]; then
  log "Firewall (ufw): SSH and port $WEB_PORT from $LAN_CIDR only"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow from "$LAN_CIDR" to any port 22 proto tcp
  ufw allow from "$LAN_CIDR" to any port "$WEB_PORT" proto tcp
  ufw --force enable
  echo "note: Docker publishes ports around ufw; WEB_BIND=127.0.0.1 (proxy on this host) is what really restricts the web port."
else
  echo "(firewall not changed: set LAN_CIDR=192.168.1.0/24 to enable ufw)"
fi

log "Pulling images ($RFP_TAG)"
cd "$APP_DIR"
if ! docker compose pull; then
  echo
  echo "Pull failed. If the GHCR packages are private: docker login ghcr.io -u <github user>  (token with read:packages), then re-run."
  exit 1
fi

if [ "${SKIP_START:-}" = "1" ]; then
  echo "SKIP_START=1: not starting. Restore the data first (docs/cutover.md section 3), then: cd $APP_DIR && docker compose up -d"
  exit 0
fi

log "Starting"
docker compose up -d
sleep 10
docker compose ps
echo
curl -fsS "http://127.0.0.1:$WEB_PORT/api/healthz" && echo || echo "healthz not answering yet; check: docker compose logs api"

cat <<NEXT

Next (docs/cutover.md):
  1. Data: restore the dump (section 3, path A). Better: run this script with SKIP_START=1, restore, then start.
  2. Owner:  cd $APP_DIR && docker compose run --rm -it api node dist/create-owner.js --email you@example.com --name "Your Name"
  3. Point your reverse proxy / tunnel at http://<this host>:$WEB_PORT and test with a hosts-file override (section 6).
  4. Fill S3_* in $APP_DIR/.env for off-machine backups, then: docker compose up -d
NEXT
