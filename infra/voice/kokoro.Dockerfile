FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng libsndfile1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install --no-cache-dir 'kokoro==0.9.4' 'transformers==4.51.3' 'huggingface-hub==0.36.0' 'soundfile==0.13.1' 'fastapi==0.162.2' 'uvicorn==0.54.0' 'python-multipart==0.0.22'
RUN pip install --no-cache-dir --retries 5 'https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl?download=1'
COPY infra/voice/tts_server.py .
CMD ["uvicorn", "tts_server:app", "--host", "0.0.0.0", "--port", "9000", "--no-access-log"]
