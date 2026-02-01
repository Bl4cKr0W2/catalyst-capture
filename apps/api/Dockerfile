FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN pnpm install --filter @catalyst-capture/api
COPY . .
EXPOSE 4000
CMD ["pnpm", "--filter", "@catalyst-capture/api", "start"]
