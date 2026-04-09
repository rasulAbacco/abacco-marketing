// src/prismaClient.js
import { PrismaClient } from "@prisma/client";

// ✅ Single shared instance for the entire app.
// Previously smtpMailerRoutes.js and accounts.js each called `new PrismaClient()`
// which opened 3 separate connection pools — exhausting Render's free-tier limit.
const prisma = new PrismaClient({
  log: ["error", "warn"],
  datasources: {
    db: {
      // Cap connections to 5 total so we stay well under Render's 20-connection limit.
      // pool_timeout: give up waiting for a free connection after 30s (instead of hanging)
      // connect_timeout: fail fast if DB is sleeping/unreachable (10s instead of default 5s)
      url: process.env.DATABASE_URL?.includes("?")
        ? `${process.env.DATABASE_URL}&connection_limit=15&pool_timeout=30&connect_timeout=10`
        : `${process.env.DATABASE_URL}?connection_limit=15&pool_timeout=30&connect_timeout=10`,
    },
  },
});

export default prisma;