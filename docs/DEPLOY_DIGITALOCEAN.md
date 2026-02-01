# DigitalOcean Deployment (Copy/Paste)

This guide deploys the API on a DigitalOcean Droplet with Docker + Nginx and enables HTTPS for capture.thecatalyst.dev.

## 1) Create Droplet

- Create an Ubuntu LTS Droplet.
- Add your SSH key.
- Note the public IP.

## 2) Point DNS

Create an A record:

- Host: `capture`
- Type: `A`
- Value: `YOUR_DROPLET_IP`
- TTL: `300`

## 3) Connect to the Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

If you’re using a specific key on Windows (example key name: `catalyst_capture_dev`):

1) Add the public key in DigitalOcean → Settings → Security → SSH Keys, name it `capture.thecatalyst.dev`.

2) Connect with the key:

```bash
ssh -i "$env:USERPROFILE\.ssh\catalyst_capture_dev" root@YOUR_DROPLET_IP
```

## 4) Install Docker + Compose

```bash
apt update -y
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update -y
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 5) Clone Repo

```bash
mkdir -p /opt/catalyst
cd /opt/catalyst
# Replace with your repo URL
git clone YOUR_REPO_URL catalyst-capture
cd catalyst-capture
```

## 6) Create API Env

```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

Set these values:

- `NODE_ENV=PRD`
- `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_SSL`
- `ADMIN_API_KEY` (strong random)
- `ALLOWED_ORIGINS=https://capture.thecatalyst.dev`

## 7) Add Docker Compose

Create `docker-compose.yml` in the repo root:

```yaml
version: "3.9"
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    env_file:
      - apps/api/.env
    ports:
      - "4000:4000"
```

## 8) Add Dockerfile

Create `apps/api/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN pnpm install --filter @catalyst-capture/api
COPY . .
EXPOSE 4000
CMD ["pnpm", "--filter", "@catalyst-capture/api", "start"]
```

## 9) Build + Run API

```bash
docker compose up -d --build
```

## 10) Install Nginx

```bash
apt install -y nginx
```

## 11) Configure Nginx

Create `/etc/nginx/sites-available/catalyst-capture`:

```nginx
server {
    listen 80;
    server_name captured.thecatalyst.dev;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/catalyst-capture /etc/nginx/sites-enabled/catalyst-capture
nginx -t
systemctl restart nginx
```

## 12) HTTPS (Let’s Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d capture.thecatalyst.dev
```

## 13) Verify

```bash
curl https://capture.thecatalyst.dev/health
```

Expected:

```json
{ "ok": true }
```

## 14) Updates

```bash
cd /opt/catalyst/catalyst-capture
git pull

docker compose up -d --build
```
