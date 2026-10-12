# Team Workspace

A task and collaboration workspace for the Tadreeby development team.

This repository uses separate branches for the two applications:

- `backend` contains the NestJS API and Prisma database schema.
- `frontend` contains the React and Vite web application.

## Backend

Requires Node.js, npm, and PostgreSQL. From the `backend` branch:

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run start:dev
```

The API defaults to `http://localhost:3000/api`. Set `DATABASE_URL`, JWT secrets,
and `WEB_ORIGIN` in `backend/.env` for your local environment.

## Frontend

From the `frontend` branch:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

The web app defaults to `http://localhost:5173` and uses
`VITE_API_URL=http://localhost:3000/api` unless overridden.

Never commit `.env` files or production credentials. Use the `.env.example`
files as templates and provide real values through local configuration.
