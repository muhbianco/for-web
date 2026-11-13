#!/bin/sh
# Prepara o laboratório: chaves só do laboratório em .env e o livekit-client
# (a mesma build com patch que o cliente usa) servido em www/.
set -eu
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  key="lab$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'LAB_LIVEKIT_KEY=%s\nLAB_LIVEKIT_SECRET=%s\n' "$key" "$secret" > .env
  chmod 600 .env
  echo "lab: .env criado (chaves só do laboratório)"
fi

umd=$(ls -d ../../../node_modules/.pnpm/livekit-client@2.20.2*/node_modules/livekit-client/dist/livekit-client.umd.js 2>/dev/null | head -1)
if [ -z "$umd" ]; then
  echo "lab: livekit-client 2.20.2 não encontrado; rode pnpm install na raiz do for-web" >&2
  exit 1
fi
mkdir -p www
cp "$umd" www/livekit-client.umd.js
echo "lab: www/livekit-client.umd.js copiado de $umd"

# Perfil r5: Revolt.toml e config do LiveKit com webhook, com as chaves do laboratório.
. ./.env
cat > Revolt.lab.toml <<TOML
[hosts.livekit]
worldwide = "ws://localhost:8080/livekit"

[api.livekit.nodes.worldwide]
url = "http://livekit:7880"
lat = 0.0
lon = 0.0
key = "$LAB_LIVEKIT_KEY"
secret = "$LAB_LIVEKIT_SECRET"
TOML
cat livekit.yaml > livekit.r5.local.yaml
cat >> livekit.r5.local.yaml <<YAML
webhook:
  api_key: $LAB_LIVEKIT_KEY
  urls:
    - http://voice-ingress:8500/worldwide
YAML
chmod 600 Revolt.lab.toml livekit.r5.local.yaml
echo "lab: Revolt.lab.toml e livekit.r5.local.yaml gerados (perfil r5)"
