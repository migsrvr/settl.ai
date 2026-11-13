import { readFileSync } from "node:fs";
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../apps/web/lib/generated/prisma/client";

export interface SandboxDatabase {
  prisma: PrismaClient;
  close(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Boot an in-process Postgres (PGlite), create the Settl tables and return a Prisma client for it.
 * The pool is limited to one connection: PGlite is single-connection, and its socket multiplexer
 * drops connections when Prisma opens several. Code must therefore use the transaction client
 * inside a transaction, never the global one, or it would wait on itself.
 */
export async function startSandboxDatabase(): Promise<SandboxDatabase> {
  const pglite = await PGlite.create();
  await pglite.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const port = await freePort();
  const server = new PGLiteSocketServer({ db: pglite, port, host: "127.0.0.1" });
  await server.start();

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 1 }),
  });
  // Calls queue behind one connection, so give transactions the same generous waits as production.
  const originalTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = ((arg: Parameters<typeof originalTransaction>[0], options?: Parameters<typeof originalTransaction>[1]) =>
    originalTransaction(arg, { maxWait: 20_000, timeout: 30_000, ...options })) as typeof prisma.$transaction;

  return {
    prisma,
    async close() {
      await prisma.$disconnect();
      await server.stop();
      await pglite.close();
    },
  };
}
