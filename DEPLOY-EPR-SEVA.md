# EPR Seva Shared-State Deployment

This runbook keeps `chat.eprcertificate.online` operational while serving the
same ForgeChat state at `https://chat.eprseva.com` with EPR Seva branding.

## Chosen transition architecture

Use the existing `forgechat` backend as the only owner of PostgreSQL, Redis,
the `forgechat_secrets` encryption keys, uploaded media, queue workers, and
the Meta WhatsApp webhook. Run only an EPR Seva frontend container from this
repository. This preserves the existing users, contacts, conversations,
broadcasts, automations, integrations, and WhatsApp number without copying
state or creating a second webhook consumer.

Do not start the target database, Redis, backend, or Caddy services during the
transition. Do not copy or mount any production volumes into this repository.

## Prerequisites

1. Create a DNS `A` record: `chat.eprseva.com` -> `139.59.67.47`.
2. Keep ports `80` and `443` open on the existing droplet.
3. Have a verified backup of the current production database and Caddy config.
4. Do not modify the Meta callback URL. It remains
   `https://chat.eprcertificate.online/api/webhook/whatsapp` during transition.

## Deploy commands

Run these on the production host only after DNS resolves to the droplet. Review
the generated backend diff before installing it. The update is limited to the
backward-compatible multi-origin CORS support; it does not change database
migrations, secrets, or webhook routes.

```bash
cd /opt/forgechat
git fetch https://github.com/vijay1kawale/Chat-Epr-Seva.git main
git show FETCH_HEAD:backend/src/app.js > /tmp/eprseva-app.js
diff -u backend/src/app.js /tmp/eprseva-app.js
install -m 644 /tmp/eprseva-app.js backend/src/app.js
git show FETCH_HEAD:docker-compose.prod.yml > /tmp/eprseva-compose.prod.yml
diff -u docker-compose.prod.yml /tmp/eprseva-compose.prod.yml
install -m 644 /tmp/eprseva-compose.prod.yml docker-compose.prod.yml
COMPOSE_PROJECT_NAME=forgechat DOMAIN=chat.eprcertificate.online ADDITIONAL_CORS_ORIGINS=https://chat.eprseva.com docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build forgecrm-backend

git clone https://github.com/vijay1kawale/Chat-Epr-Seva.git /opt/eprseva
cd /opt/eprseva
COMPOSE_PROJECT_NAME=eprseva docker compose -f docker-compose.yml -f docker-compose.shared-state.yml up -d --build --no-deps forgecrm-frontend
# Attach only the uniquely named container. Do not declare forgechat_default in
# Compose, which would add the conflicting generic forgecrm-frontend alias.
docker network connect forgechat_default eprseva-forgecrm-frontend-1

grep -q '^chat.eprseva.com {' /opt/forgechat/Caddyfile || cat Caddyfile.eprseva.shared >> /opt/forgechat/Caddyfile
docker exec forgechat-caddy-1 caddy validate --config /etc/caddy/Caddyfile
docker exec forgechat-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

With `ADDITIONAL_CORS_ORIGINS` in the command above, the production backend
receives this exact comma-separated `CORS_ORIGIN` value:

```text
https://chat.eprcertificate.online,https://chat.eprseva.com
```

The EPR Seva compose update retains the existing single-origin default when
`ADDITIONAL_CORS_ORIGINS` is unset.

## Verification and rollback

```bash
curl -fsS https://chat.eprcertificate.online/api/health
curl -fsS https://chat.eprseva.com/api/health
docker ps --format '{{.Names}}\t{{.Status}}'
```

Verify login, contacts, a read-only conversation view, media rendering, and an
existing WhatsApp inbound event on the current Meta callback. Do not send a
test broadcast or alter Meta settings as part of this deployment.

To roll back the EPR Seva route, remove only its `chat.eprseva.com` site block
from `/opt/forgechat/Caddyfile`, reload Caddy, then stop only
`eprseva-forgecrm-frontend-1`. Do not run `docker compose down`, volume
commands, database commands, or Meta changes.
