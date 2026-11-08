FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 libnss3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY infra/voice/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY infra/voice/gateway.py .
CMD ["uvicorn", "gateway:app", "--host", "127.0.0.1", "--port", "8002", "--no-access-log"]
