FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

# Prisma reads the schema and config during client generation in npm lifecycle scripts.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Client generation needs a syntactically valid URL, but does not connect to the database.
ARG DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tadreeby?schema=public
ENV DATABASE_URL=${DATABASE_URL}

RUN npm ci

FROM dependencies AS build

COPY . .
RUN npm run build

FROM build AS database-setup
CMD ["npx", "prisma", "db", "push", "--skip-generate"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 3000
USER node

CMD ["node", "dist/main.js"]
