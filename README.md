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


## Features

- JWT auth (access + refresh tokens), sessions cached in Redis
- Workspaces / Projects / Boards / Tasks (relational schema via Prisma)
- Real-time task updates via WebSockets + Redis pub/sub
- Background job queue (BullMQ) for notifications/emails
- Redis-backed rate limiting
- Full-text task search (Postgres `tsvector`)
- Fully Dockerized (Postgres, Redis, API, worker, web)

