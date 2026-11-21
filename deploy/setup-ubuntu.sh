#!/usr/bin/env bash
# MoriGraphy — cài trên VPS Ubuntu/Debian mới.
# Cách dùng (trong thư mục MoriGraphy trên VPS):   sudo bash deploy/setup-ubuntu.sh tenmiencuaban.com
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then echo "Cách dùng: sudo bash deploy/setup-ubuntu.sh tenmiencuaban.com"; exit 1; fi
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#www.}"; DOMAIN="${DOMAIN%/}"
cd "$(dirname "$0")/.."

echo "==> 1/4 Cài Docker (nếu chưa có)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> 2/4 Mở tường lửa cổng 80, 443 (nếu dùng ufw)"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 443/udp
fi

echo "==> 3/4 Ghi tên miền vào .env: $DOMAIN"
echo "DOMAIN=$DOMAIN" > .env
mkdir -p data/uploads
chown -R 1000:1000 data          # container chạy bằng user node (uid 1000)

echo "==> 4/4 Build và chạy"
docker compose -f docker-compose.public.yml up -d --build

echo
echo "Xong. Mở https://$DOMAIN  ·  Admin: https://$DOMAIN/admin.html"
echo "Mã thiết lập admin (lần đầu):"
sleep 3
docker compose -f docker-compose.public.yml logs morigraphy | grep -A2 -i "THIẾT LẬP" || docker compose -f docker-compose.public.yml logs morigraphy | tail -n 20
