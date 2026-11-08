FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY backend ./backend
RUN pip install --no-cache-dir .
RUN useradd --create-home finance && mkdir /data && chown finance /data
USER finance
ENV CHECKPOINT_SQLITE_PATH=/data/checkpoints.db
ENV DATABASE_URL=sqlite+aiosqlite:////data/finance.db
EXPOSE 8000
CMD ["uvicorn", "finance_hub.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
