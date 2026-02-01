# Quick Deploy Script

Run this after SSH is configured and DNS is pointing to your droplet.

## 1) Set Up SSH Key (Already Done)

```bash
ssh-keygen -t ed25519 -C "admin@thecatalyst.dev" -f "$env:USERPROFILE\.ssh\catalyst_capture_dev"
```

Add public key to DigitalOcean.

## 2) Test SSH

```bash
ssh -i "$env:USERPROFILE\.ssh\catalyst_capture_dev" root@167.99.112.163
```

If connected, exit and continue.

## 3) Run Deploy Script

Save this as `deploy-setup.sh` on the droplet:

```bash
#!/bin/bash
set -e

echo "Installing Docker..."
apt update -y
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update -y
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git nginx certbot python3-certbot-nginx

echo "Cloning repo..."
mkdir -p /opt/catalyst
cd /opt/catalyst
read -p "Enter your repo URL (e.g., https://github.com/user/catalyst-capture.git): " REPO_URL
git clone $REPO_URL catalyst-capture || echo "Repo already exists"
cd catalyst-capture

echo "Setting up env..."
cp apps/api/.env.example apps/api/.env
nano apps/api/.env

echo "Building and starting Docker..."
docker compose up -d --build

echo "Configuring Nginx..."
cat > /etc/nginx/sites-available/catalyst-capture << 'EOF'
server {
    listen 80;
    server_name captured.thecatalyst.dev;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
ln -sf /etc/nginx/sites-available/catalyst-capture /etc/nginx/sites-enabled/catalyst-capture
nginx -t && systemctl restart nginx

echo "Setup complete! Test with: curl http://captured.thecatalyst.dev/health"
echo "Run Certbot later: certbot --nginx -d captured.thecatalyst.dev --non-interactive --agree-tos --email admin@thecatalyst.dev --redirect"
```

## 4) Copy and Run

From your local machine:

```bash
ssh -i "$env:USERPROFILE\.ssh\catalyst_capture_dev" root@167.99.112.163 "cat > /root/deploy-setup.sh" < deploy-setup.sh
ssh -i "$env:USERPROFILE\.ssh\catalyst_capture_dev" root@167.99.112.163 "chmod +x /root/deploy-setup.sh && /root/deploy-setup.sh"
```

Or manually copy/paste the script content and run it on the droplet.

## 5) Future Deploys

Just run: `pnpm deploy`
