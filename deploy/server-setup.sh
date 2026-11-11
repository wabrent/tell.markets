# === Tell: установка на чистый VPS (Ubuntu 22.04/24.04) ===
# 1) В строке ниже замени tell.markets на свой домен (если другой).
# 2) Скопируй ВЕСЬ этот файл и вставь в окно SSH, нажми Enter.
#    Пока домена нет — DOMAIN=none: сайт откроется по IP сервера через http.
DOMAIN=${DOMAIN:-tell.markets}

set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl gpg debian-keyring debian-archive-keyring apt-transport-https

# Docker
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

# Caddy (сам получает HTTPS-сертификат)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# Код
if [ -d /opt/tell ]; then cd /opt/tell && git pull; else git clone https://github.com/wabrent/tell.markets /opt/tell && cd /opt/tell; fi
[ -f .env ] || cp .env.example .env
if [ "$DOMAIN" = none ]; then
  IP=$(hostname -I | awk '{print $1}')
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=http://$IP|" .env
else
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" .env
fi

# Сборка и запуск
docker build -t tell .
docker rm -f tell 2>/dev/null || true
docker run -d --name tell --restart unless-stopped --env-file .env -p 127.0.0.1:3000:3000 -v tell-data:/app/data tell

# Домен -> сайт. Каждый проект — свой файл в /etc/caddy/sites/, другие проекты не затираются.
mkdir -p /etc/caddy/sites
grep -q 'import /etc/caddy/sites/\*' /etc/caddy/Caddyfile 2>/dev/null || echo 'import /etc/caddy/sites/*.caddy' > /etc/caddy/Caddyfile
if [ "$DOMAIN" = none ]; then
  printf ':80 {\n  reverse_proxy localhost:3000\n}\n' > /etc/caddy/sites/tell.caddy
else
  printf '%s, www.%s {\n  reverse_proxy localhost:3000\n}\n' "$DOMAIN" "$DOMAIN" > /etc/caddy/sites/tell.caddy
fi
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo
if [ "$DOMAIN" = none ]; then echo "Готово. Сайт: http://$IP"; else echo "Готово. Сайт: https://$DOMAIN  (если домен уже смотрит на этот сервер)"; fi
echo "Ключ DeepSeek: nano /opt/tell/.env  -> вписать -> Ctrl+O, Enter, Ctrl+X"
echo "Потом применить: cd /opt/tell && docker rm -f tell && docker run -d --name tell --restart unless-stopped --env-file .env -p 127.0.0.1:3000:3000 -v tell-data:/app/data tell"
