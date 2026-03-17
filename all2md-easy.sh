#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR"
APP_DOMAIN="${APP_DOMAIN:-all2md.icepig.top}"
APP_USER="${APP_USER:-$(id -un)}"
APP_GROUP="${APP_GROUP:-$(id -gn)}"
APP_PORT="${APP_PORT:-3000}"
CHROME_PORT="${CHROME_PORT:-9222}"
CHROME_BIN="${CHROME_BIN:-/usr/bin/google-chrome}"
CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-${APP_DIR}/.chrome-profile}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
SYSTEMD_CHROME_SERVICE="/etc/systemd/system/all2md-chrome.service"
SYSTEMD_APP_SERVICE="/etc/systemd/system/all2md.service"
NGINX_SITE="/etc/nginx/sites-available/all2md"
TOTAL_STEPS=12
STEP=0

if [ -t 1 ]; then
  C_RESET="$(printf '\033[0m')"
  C_BLUE="$(printf '\033[1;34m')"
  C_GREEN="$(printf '\033[1;32m')"
  C_YELLOW="$(printf '\033[1;33m')"
  C_RED="$(printf '\033[1;31m')"
  C_CYAN="$(printf '\033[1;36m')"
  C_BOLD="$(printf '\033[1m')"
else
  C_RESET=""
  C_BLUE=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
  C_CYAN=""
  C_BOLD=""
fi

print_bar() {
  local current="$1"
  local total="$2"
  local width=28
  local filled=$(( current * width / total ))
  local empty=$(( width - filled ))
  local left right
  left="$(printf '%*s' "$filled" '' | tr ' ' '#')"
  right="$(printf '%*s' "$empty" '' | tr ' ' '-')"
  printf "%b[%s%s]%b" "$C_CYAN" "$left" "$right" "$C_RESET"
}

step() {
  STEP=$((STEP + 1))
  echo
  printf "%b[%d/%d]%b " "$C_BLUE" "$STEP" "$TOTAL_STEPS" "$C_RESET"
  print_bar "$STEP" "$TOTAL_STEPS"
  printf " %b%s%b\n" "$C_BOLD" "$1" "$C_RESET"
}

info() {
  printf "%b==>%b %s\n" "$C_CYAN" "$C_RESET" "$1"
}

warn() {
  printf "%b[warn]%b %s\n" "$C_YELLOW" "$C_RESET" "$1"
}

die() {
  printf "%b[error]%b %s\n" "$C_RED" "$C_RESET" "$1" >&2
  exit 1
}

step "Checking project directory"
[ -d "$APP_DIR" ] || die "Project directory not found: $APP_DIR"
[ -f "${APP_DIR}/package.json" ] || die "package.json not found in ${APP_DIR}. Upload the all2md project folder first."
info "Using app directory: $APP_DIR"
info "Using app user/group: ${APP_USER}:${APP_GROUP}"

step "Updating apt and installing base packages"
sudo apt update
sudo apt install -y nginx curl unzip build-essential ufw python3-certbot-nginx wget

step "Installing Node.js 22 if missing"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
else
  info "Node already installed: $(node -v)"
fi

step "Installing Google Chrome if missing"
if [ ! -x "$CHROME_BIN" ]; then
  cd /tmp
  wget -O google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt install -y ./google-chrome-stable_current_amd64.deb
else
  info "Chrome already installed: $CHROME_BIN"
fi

step "Preparing runtime directories"
mkdir -p "$CHROME_PROFILE_DIR"
mkdir -p "${APP_DIR}/downloads/images"
sudo chown -R "${APP_USER}:${APP_GROUP}" "$APP_DIR"

step "Installing npm dependencies"
cd "$APP_DIR"
export PUPPETEER_SKIP_DOWNLOAD=true
npm install --registry=https://registry.npmmirror.com

step "Writing Chrome systemd service"
sudo tee "$SYSTEMD_CHROME_SERVICE" >/dev/null <<EOF
[Unit]
Description=All2MD Chrome Debug Browser
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
ExecStart=${CHROME_BIN} \\
  --headless=new \\
  --remote-debugging-address=127.0.0.1 \\
  --remote-debugging-port=${CHROME_PORT} \\
  --user-data-dir=${CHROME_PROFILE_DIR} \\
  --no-first-run \\
  --no-default-browser-check \\
  --disable-dev-shm-usage \\
  --no-sandbox \\
  about:blank
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

step "Writing app systemd service"
sudo tee "$SYSTEMD_APP_SERVICE" >/dev/null <<EOF
[Unit]
Description=All2MD Web App
After=network-online.target all2md-chrome.service
Wants=network-online.target
Requires=all2md-chrome.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=PUPPETEER_BROWSER_URL=http://127.0.0.1:${CHROME_PORT}
Environment=PUPPETEER_EXECUTABLE_PATH=${CHROME_BIN}
Environment=MARKDOWN_IMAGE_MODE=remote
ExecStart=${NODE_BIN} ${APP_DIR}/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

step "Configuring firewall"
sudo ufw allow OpenSSH || true
sudo ufw allow 'Nginx Full' || true
sudo ufw --force enable || true

step "Writing nginx reverse proxy config"
sudo tee "$NGINX_SITE" >/dev/null <<EOF
server {
    listen 80;
    server_name ${APP_DOMAIN};

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 180s;
    }
}
EOF

if [ ! -L "/etc/nginx/sites-enabled/all2md" ]; then
  sudo ln -s "$NGINX_SITE" /etc/nginx/sites-enabled/all2md
fi

if [ -L "/etc/nginx/sites-enabled/default" ]; then
  sudo rm -f /etc/nginx/sites-enabled/default
fi

step "Reloading systemd and starting services"
sudo systemctl daemon-reload
sudo systemctl enable --now all2md-chrome
sudo systemctl enable --now all2md

step "Validating and reloading nginx"
sudo nginx -t
sudo systemctl reload nginx

step "Running local health checks"
sleep 3
info "Chrome debug endpoint:"
curl -fsS "http://127.0.0.1:${CHROME_PORT}/json/version" || warn "Chrome debug endpoint check failed"
echo
info "App health endpoint:"
curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" || warn "App health endpoint check failed"
echo

echo
printf "%b[%d/%d]%b " "$C_GREEN" "$TOTAL_STEPS" "$TOTAL_STEPS" "$C_RESET"
print_bar "$TOTAL_STEPS" "$TOTAL_STEPS"
printf " %bDeployment finished%b\n" "$C_GREEN" "$C_RESET"
echo
printf "%bNext steps%b\n" "$C_BOLD" "$C_RESET"
echo "1. Open: http://${APP_DOMAIN}/api/health"
echo "2. If DNS is ready, enable HTTPS:"
echo "   sudo certbot --nginx -d ${APP_DOMAIN}"
echo
printf "%bUseful logs%b\n" "$C_BOLD" "$C_RESET"
echo "   journalctl -u all2md -f"
echo "   journalctl -u all2md-chrome -f"
