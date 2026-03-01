FROM python:3.11-slim

WORKDIR /app

# Install system deps for Playwright
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium

COPY scraper.py .

# Auth state persisted via volume mount
VOLUME ["/app/.auth"]

ENTRYPOINT ["python3", "scraper.py", "--json"]
