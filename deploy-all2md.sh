#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/ubuntu/all2md"
APP_DOMAIN="all2md.icepig.top"
APP_USER="ubuntu"
APP_GROUP="ubuntu"
APP_PORT="3000"
CHROME_PORT="9222"
CHROME_BIN="/usr/bin/google-chrome"
CHROME_PROFILE_DIR="${APP_DIR}/.chrome-profile"
NODE_BIN="/usr/bin/node"
SYSTEMD_CHROME_SERVICE="/etc/systemd/system/all2md-chrome.service"
SYSTEMD_APP_SERVICE="/etc/systemd/system/all2md.service"
NGINX_SITE="/etc/nginx/sites-available/all2md"
TOTAL_STEPS=12
STEP=0

step() {
  STEP=$((STEP + 1))
  echo
  echo "[${STEP}/${TOTAL_STEPS}] $1"
}

step "Checking app directory"
if [ ! -d "$APP_DIR" ]; then
  echo "App directory not found: $APP_DIR"
  exit 1
fi

if [ ! -f "${APP_DIR}/package.json" ]; then
  echo "package.json not found: ${APP_DIR}/package.json"
  echo "Upload the project code first, then rerun this script."
  exit 1
fi

step "Updating apt and installing base packages"
sudo apt update
sudo apt install -y nginx curl unzip build-essential ufw python3-certbot-nginx wget

step "Installing Node.js 22 if missing"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi

step "Installing Google Chrome if missing"
if [ ! -x "$CHROME_BIN" ]; then
  cd /tmp
  wget -O google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt install -y ./google-chrome-stable_current_amd64.deb
fi

step "Preparing runtime directories"
mkdir -p "$CHROME_PROFILE_DIR"
mkdir -p "${APP_DIR}/downloads/images"
sudo chown -R "${APP_USER}:${APP_GROUP}" "$APP_DIR"

step "Installing npm dependencies"
cd "$APP_DIR"
npm install

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
echo "Chrome debug endpoint:"
curl -fsS "http://127.0.0.1:${CHROME_PORT}/json/version" || true
echo
echo "App health endpoint:"
curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" || true
echo

echo
echo "[${TOTAL_STEPS}/${TOTAL_STEPS}] Deployment finished"
echo
echo "Next steps:"
echo "1. Open: http://${APP_DOMAIN}/api/health"
echo "2. If DNS is ready, enable HTTPS:"
echo "   sudo certbot --nginx -d ${APP_DOMAIN}"
echo
echo "Useful logs:"
echo "   journalctl -u all2md -f"
echo "   journalctl -u all2md-chrome -f"
