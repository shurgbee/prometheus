"""Upload only voice sources and private configuration, then launch on Brev.

Usage: .venv/bin/python scripts/deploy-voice.py [SSH_HOST]
Requires .env.voice from configure-voice.py. No credentials are printed or put in argv.
"""
import io
from pathlib import Path
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parents[1]
host = sys.argv[1] if len(sys.argv) > 1 else "controversial-tan-flea"
destination = "/home/shadeform/prometheus-voice"
if not (root / ".env.voice").exists():
    raise SystemExit("Run scripts/configure-voice.py first")
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
    for directory in [root / "notifier", root / "infra/voice"]:
        for path in directory.rglob("*"):
            if path.is_file() and not any(part in {"node_modules", "data", "runtime", "__pycache__"}
                                         for part in path.relative_to(directory).parts):
                archive.add(path, arcname=str(path.relative_to(root)))
    archive.add(root / ".dockerignore", arcname=".dockerignore")
    info = tarfile.TarInfo(".env")
    content = (root / ".env.voice").read_bytes()
    info.size, info.mode = len(content), 0o600
    archive.addfile(info, io.BytesIO(content))
subprocess.run(["ssh", host, f"umask 077; mkdir -p {destination}; tar xzf - -C {destination}"],
               input=buffer.getvalue(), check=True)
subprocess.run(["ssh", host, f"cd {destination} && python3 infra/voice/prepare.py && "
               "docker compose --env-file .env -f infra/voice/compose.yml up -d --build && "
               "python3 infra/voice/wait_ready.py"], check=True)
print("Deployed to", host + ":" + destination)
