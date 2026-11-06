import dns from "node:dns";
import net from "node:net";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Ensure IPv4 is prioritized in dual-stack environments (e.g. WSL2) to prevent ETIMEDOUT to cloud databases
if (typeof net.setDefaultAutoSelectFamily === "function") net.setDefaultAutoSelectFamily(false);
if (typeof dns.setDefaultResultOrder === "function") dns.setDefaultResultOrder("ipv4first");

const globalForPrisma = globalThis as unknown as { settlPrisma?: PrismaClient };
let client: PrismaClient | undefined;

/** Lazy so static builds can load modules without opening a database connection. */
export function getDb(): PrismaClient {
  if (typeof window !== "undefined") throw new Error("Database access is only available on the server.");
  if (client) return client;
  if (globalForPrisma.settlPrisma) return (client = globalForPrisma.settlPrisma);
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) });
  if (typeof raw.$transaction === "function") {
    const originalTx = raw.$transaction.bind(raw);
    raw.$transaction = ((arg: Parameters<typeof originalTx>[0], options?: Parameters<typeof originalTx>[1]) => {
      return originalTx(arg, { maxWait: 20_000, timeout: 30_000, ...options });
    }) as typeof raw.$transaction;
  }
  client = raw;
  if (process.env.NODE_ENV !== "production") globalForPrisma.settlPrisma = client;
  return client;
}
