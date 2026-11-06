import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { settlPrisma?: PrismaClient };
let client: PrismaClient | undefined;

/** Lazy so static builds can load modules without opening a database connection. */
export function getDb(): PrismaClient {
  if (typeof window !== "undefined") throw new Error("Database access is only available on the server.");
  if (client) return client;
  if (globalForPrisma.settlPrisma) return (client = globalForPrisma.settlPrisma);
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.settlPrisma = client;
  return client;
}
