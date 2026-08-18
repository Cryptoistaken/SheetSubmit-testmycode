# SheetSubmit frontend — nginx serving the built SPA + proxying /api to the backend
# (standalone, context = ./frontend).
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --linker=hoisted
COPY . .
RUN bunx tsc -b && bunx vite build

FROM nginx:alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
