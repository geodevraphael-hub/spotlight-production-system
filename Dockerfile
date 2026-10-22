# Full production image for spotlight.co.tz (container "spotlight-planner", host port 3100).
# Replaces the chain of patch images built from deploy/Dockerfile.*; build from a clean checkout.
FROM node:22.23.2-bookworm

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && update-ca-certificates \
 && test -s /etc/ssl/certs/ca-certificates.crt \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN rm -rf .wrangler/state dist .dev.vars \
 && npm test \
 && npm run build \
 && tar -C public --exclude=downloads -cf - . | tar -C dist/client -xf -

EXPOSE 3000

# Same start command as the live container: secrets arrive as container env vars and are
# written to .dev.vars (mode 600) at start, never baked into the image.
CMD ["sh", "-lc", "umask 077; env | grep -E '^(SESSION_SECRET|ADMIN_PASSWORD|RESEND_API_KEY|WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_VERIFY_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_TEMPLATE_NAME|WHATSAPP_TEMPLATE_LANGUAGE|MSHASTRA_USER|MSHASTRA_PASSWORD|MSHASTRA_SENDER_ID|MSHASTRA_COUNTRY_CODE|AUTOMATION_SECRET|LOCATIONIQ_KEY|LOCATIONIQ_ENV|LOCATIONIQ_PAUSED_REASON)=' > /app/.dev.vars; install -m 600 /app/.dev.vars /app/dist/server/.dev.vars; exec npx --no-install vite preview --host 0.0.0.0 --port 3000"]
