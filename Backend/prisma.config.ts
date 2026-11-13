import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "Database/prisma/schema.prisma",
  migrations: {
    path: "Database/prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
