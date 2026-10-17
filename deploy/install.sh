#!/usr/bin/env bash
# Instala ou atualiza o RLight num container Debian 12 (ADR-0001).
# Rode como root DENTRO do container. Idempotente: rodar de novo atualiza.
# Não toca em nada fora do container. Não lê nem pede segredos: o token da
# Cloudflare é gravado à parte, por quem administra, em /etc/rlight/cloudflare.env.
set -euo pipefail

REPO=https://github.com/willianrupert/rlight-pendant.git
APP=/opt/rlight/app
ARCH=$(dpkg --print-architecture)   # amd64 ou arm64

echo "== pacotes do sistema"
apt-get update -qq
apt-get install -y -qq git ca-certificates curl nodejs npm >/dev/null

echo "== usuários de serviço"
id rlight >/dev/null 2>&1 || useradd --system --home /opt/rlight --shell /usr/sbin/nologin rlight
id caddy  >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy

echo "== código"
mkdir -p /opt/rlight
chown rlight:rlight /opt/rlight
# O Git roda como o dono do repositório (como root, ele recusa: "dubious ownership").
as_rlight() { runuser -u rlight -- "$@"; }
if [ -d "$APP/.git" ]; then
  chown -R rlight:rlight "$APP"
  as_rlight git -C "$APP" fetch -q origin main
  as_rlight git -C "$APP" reset -q --hard origin/main
else
  as_rlight git clone -q "$REPO" "$APP"
fi
echo "   versão: $(as_rlight git -C "$APP" log --oneline -1)"

echo "== dependências e build do app"
cd "$APP"
as_rlight npm ci --no-audit --no-fund --loglevel=error
as_rlight npm run build -w web --silent

echo "== Caddy com o módulo DNS da Cloudflare (build oficial de caddyserver.com)"
if [ ! -x /usr/local/bin/caddy ] || ! /usr/local/bin/caddy list-modules 2>/dev/null | grep -q dns.providers.cloudflare; then
  curl -fsSL -o /tmp/caddy "https://caddyserver.com/api/download?os=linux&arch=${ARCH}&p=github.com/caddy-dns/cloudflare"
  install -m 0755 /tmp/caddy /usr/local/bin/caddy
  rm -f /tmp/caddy
fi

echo "== configuração"
mkdir -p /etc/rlight
[ -f /etc/rlight/rlight.env ] || install -m 0644 "$APP/deploy/rlight.env.example" /etc/rlight/rlight.env
install -m 0644 "$APP/deploy/Caddyfile" /etc/rlight/Caddyfile
if [ ! -f /etc/rlight/cloudflare.env ]; then
  install -m 0600 -o caddy -g caddy /dev/null /etc/rlight/cloudflare.env
fi

echo "== serviços"
install -m 0644 "$APP/deploy/rlight-server.service" /etc/systemd/system/rlight-server.service
install -m 0644 "$APP/deploy/rlight-caddy.service" /etc/systemd/system/rlight-caddy.service
systemctl daemon-reload
systemctl enable --now rlight-server.service
systemctl restart rlight-server.service

if grep -q '^CF_API_TOKEN=.' /etc/rlight/cloudflare.env; then
  systemctl enable --now rlight-caddy.service
  systemctl restart rlight-caddy.service
  echo "== pronto: https://$(. /etc/rlight/rlight.env; echo "$RLIGHT_DOMAIN")"
else
  echo
  echo "Falta o token da Cloudflare para o certificado. Quem administra grava com:"
  echo "  read -rsp 'Token: ' T && printf 'CF_API_TOKEN=%s\n' \"\$T\" > /etc/rlight/cloudflare.env && unset T"
  echo "  systemctl enable --now rlight-caddy"
fi
systemctl --no-pager --lines=0 status rlight-server.service | head -3
