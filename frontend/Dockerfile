FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine

# Allow the upstream backend host:port to be overridden at build time so the
# same image can target a non-default deployment (e.g. an isolated test stack
# whose backend container is named differently and listens on a different
# port). Defaults match the standard self-hosted single-droplet compose where
# the backend service is `forgecrm-backend` on port 3011.
ARG BACKEND_HOST=forgecrm-backend
ARG BACKEND_PORT=3011

COPY --from=builder /app/dist /usr/share/nginx/html
# Git checkouts created under a restrictive umask can preserve unreadable
# public-file modes through Vite into this image. Nginx serves as a non-root
# user, so normalize static directory and file permissions at image build time.
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} + \
 && find /usr/share/nginx/html -type f -exec chmod 644 {} +
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i "s|forgecrm-backend:3011|${BACKEND_HOST}:${BACKEND_PORT}|g" /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
