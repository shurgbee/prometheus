#!/usr/bin/env bash
# Private local notifier access and reverse delivery callbacks. Run on your workstation.
set -euo pipefail
voice_host="${VOICE_SSH_HOST:-controversial-tan-flea}"
voice_socket="${TMPDIR:-/tmp}/prometheus-voice-$(id -u).sock"
if [[ "${1:-}" == "close" ]]; then
  exec ssh -S "$voice_socket" -O exit "$voice_host"
fi
if ssh -S "$voice_socket" -O check "$voice_host" 2>/dev/null; then
  echo "Voice tunnel is already running."
  exit 0
fi
ssh -M -S "$voice_socket" -fNT -o ControlMaster=yes -o ControlPersist=no \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:8001:127.0.0.1:8001 \
  -L 127.0.0.1:8002:127.0.0.1:8002 \
  -R 127.0.0.1:18000:127.0.0.1:8000 "$voice_host"
echo "Voice tunnel ready: local 8001/8002 → Brev; Brev 18000 → local backend 8000."
