# Backend Docker setup

For local Docker development, create a backend environment file and start the API with PostgreSQL:

```bash
cp .env.example .env
docker compose up --build
```

Compose creates a persistent PostgreSQL volume and applies the Prisma schema before starting the API. The API listens at `http://localhost:3000`. The included PostgreSQL credentials are for local development only.

To run only the API image against an existing database:

```bash
docker build -t tadreeby-backend .
docker run --env-file .env -p 3000:3000 tadreeby-backend
```
