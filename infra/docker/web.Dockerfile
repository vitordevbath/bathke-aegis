FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY tools/aegis-mcp/package.json tools/aegis-mcp/
RUN npm ci --workspace @aegis/web --include-workspace-root
COPY packages/domain packages/domain
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build -w @aegis/domain && npm run build -w @aegis/contracts && npm run build -w @aegis/web

FROM nginx:1.27-alpine
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
