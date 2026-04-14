// src/prismaClient.js
import { PrismaClient } from "@prisma/client";

// ✅ Create single shared Prisma instance
const prisma = new PrismaClient({
  log: ["error", "warn"],

  datasources: {
    db: {
      // ✅ SAFE DB CONFIG (IMPORTANT)
      // connection_limit=5 → prevents DB overload
      // pool_timeout=30 → wait max 30s for free connection
      // connect_timeout=10 → fail fast if DB sleeping
      url: process.env.DATABASE_URL?.includes("?")
        ? `${process.env.DATABASE_URL}&connection_limit=5&pool_timeout=30&connect_timeout=10`
        : `${process.env.DATABASE_URL}?connection_limit=5&pool_timeout=30&connect_timeout=10`,
    },
  },
});

// ✅ AUTO RECONNECT HANDLER (CRITICAL FIX)
async function connectDB() {
  try {
    await prisma.$connect();
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);

    // Retry after 5 seconds
    setTimeout(connectDB, 5000);
  }
}

// Start connection on app boot
connectDB();

// Optional: handle unexpected crashes gracefully
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

export default prisma;

