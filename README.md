# Tadreeby Team Hub

A team task and collaboration workspace with a NestJS API and a React web app.

## Repository branches

- `main` contains the complete project (`backend/` and `frontend/`) and is the
  branch to use for local development and deployments that build the whole app.
- `backend` contains only the API.
- `frontend` contains only the web app.

You can stay on `main` to work on both apps. The focused branches remain
available for services that deploy the frontend and backend separately.

## Run locally

Requirements: Node.js, npm, and PostgreSQL.

### Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run start:dev
```

Set `DATABASE_URL`, JWT secrets, and `WEB_ORIGIN` in `backend/.env`.

### Frontend

In a second terminal, from the repository root:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

During development, the frontend sends `/api` requests through Vite's proxy to
`http://localhost:3000`, avoiding cross-origin issues between `localhost` and
`127.0.0.1`. Set `VITE_API_URL` to the deployed API URL when building for
production.

## Deployment

Deploy the API and web app as separate services from `main`, or deploy each
focused branch if the hosting provider requires it. Provide a PostgreSQL
database, configure the backend environment variables from
`backend/.env.example`, run `npx prisma migrate deploy`, and set the frontend's
`VITE_API_URL` to the public API URL before running `npm run build` in
`frontend/`.

Never commit `.env` files or production secrets. Use the `.env.example` files
as templates and configure secrets in the hosting provider.
