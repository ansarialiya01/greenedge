FROM node:22-slim

RUN apt-get update && apt-get install -y python3 python3-venv && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir flask flask-cors

COPY . .

CMD ["sh", "-c", "/venv/bin/python python/voice_assistance.py & node server.js"]