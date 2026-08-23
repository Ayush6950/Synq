# Synq

**Synq** is a real-time collaborative project management tool (Trello/Linear-style) built to demonstrate a production-style full-stack architecture.

Teams create Workspaces → Projects → Boards → Tasks, and see changes from teammates live, without refreshing — powered by WebSockets and Redis pub/sub.

## Tech Stack

| Layer | Tech | Purpose |
|---|---|---|
| Frontend | Next.js + TypeScript | Dashboard, boards, drag-and-drop UI |
| API | Express + TypeScript | REST API, auth, business logic |
| ORM | Prisma | Type-safe DB access + migrations |
| Database | PostgreSQL | Source of truth (users, workspaces, tasks...) |
| Cache / Realtime | Redis | Session cache, rate limiting, pub/sub, BullMQ queue backend |
| Background Jobs | BullMQ | Email/notification sending, async work |
| Realtime transport | Socket.io | Live board updates pushed to connected clients |
| Infra | Docker Compose | One-command local environment |

## Architecture

```
apps/
  web/      -> Next.js frontend
  api/      -> Express API (talks to Postgres via Prisma, Redis for cache/pubsub/rate-limit)
  worker/   -> BullMQ worker (background jobs, consumes Redis queue)
packages/
  db/       -> Shared Prisma schema + client used by api & worker
```

### Request flow example: moving a task

1. User drags a task -> optimistic UI update in Next.js
2. `PATCH /api/tasks/:id/move` hits Express
3. Express updates Postgres via Prisma, invalidates Redis cache
4. Express publishes an event to Redis (`board:<id>` channel)
5. Socket.io (subscribed to that channel) pushes the update to every other connected client on that board
6. Everyone's UI updates live, no refresh

## Getting Started

```bash
git clone <your-repo-url>
cd synq
cp .env.example .env
docker-compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:4000
- Postgres: localhost:5432
- Redis: localhost:6379

Run Prisma migrations (first time):
```bash
docker-compose exec api npx prisma migrate dev
```

## Features

- JWT auth (access + refresh tokens), sessions cached in Redis
- Workspaces / Projects / Boards / Tasks (relational schema via Prisma)
- Real-time task updates via WebSockets + Redis pub/sub
- Background job queue (BullMQ) for notifications/emails
- Redis-backed rate limiting
- Full-text task search (Postgres `tsvector`)
- Fully Dockerized (Postgres, Redis, API, worker, web)

## Why this project

Built to demonstrate distributed-systems fundamentals beyond basic CRUD: caching strategy, pub/sub fan-out across server instances, decoupled background processing, and containerized multi-service orchestration.
