uv sync --python 3.13 --extra dev
cd finhub
npm ci
cd ../notifier
npm install
cd ..
uv run python scripts/dev.py
