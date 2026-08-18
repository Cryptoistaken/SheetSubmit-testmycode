# SheetSubmit frontend — standalone SPA (context = ./frontend). No proxy/nginx:
# API calls go directly to the backend public URL baked in via VITE_API_BASE.
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --linker=hoisted
COPY . .
ARG VITE_API_BASE=https://sealbackend.up.railway.app
ENV VITE_API_BASE=$VITE_API_BASE
RUN bunx tsc -b && bunx vite build

FROM oven/bun:1.3.14
WORKDIR /app
COPY server.js ./
COPY --from=build /app/dist ./dist
EXPOSE 80
CMD ["bun", "server.js"]