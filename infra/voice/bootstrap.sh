#!/usr/bin/env bash
# Run on the Brev host after uploading this directory. Requires Docker + NVIDIA Container Toolkit.
set -euo pipefail
voice_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$voice_root"
sudo install -d -m 0755 /ephemeral/prometheus-kokoro-cache
sudo install -d -m 0775 /ephemeral/prometheus-voice-cache
sudo chown 1000:1000 /ephemeral/prometheus-voice-cache
sudo ufw allow 10000:10100/udp comment 'Finance Hub outbound call media'
printf 'net.core.rmem_max=5000000\nnet.core.wmem_max=5000000\n' | sudo tee /etc/sysctl.d/99-prometheus-voice.conf >/dev/null
sudo sysctl -p /etc/sysctl.d/99-prometheus-voice.conf
python3 infra/voice/prepare.py
docker compose --env-file .env -f infra/voice/compose.yml up -d --build
python3 infra/voice/wait_ready.py
