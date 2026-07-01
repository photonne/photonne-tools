FROM python:3.12-slim

# Instalar rsync y exiftool (las herramientas que vamos a invocar)
RUN apt-get update && apt-get install -y --no-install-recommends \
        rsync \
        libimage-exiftool-perl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app /app

# Directorio para BD y logs (se monta como volumen externo)
RUN mkdir -p /data /data/logs

ENV PHOTONNE_TOOLS_DB=/data/photonne-tools.db \
    PHOTONNE_TOOLS_LOGS=/data/logs

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
