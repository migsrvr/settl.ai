#!/usr/bin/env node
import { formatBanner } from "./banner";
import { describeStartupError, parseCliArgs, USAGE } from "./cli-args";

async function main(): Promise<void> {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  // Loaded after argument parsing so --help and bad flags answer instantly.
  const { startSandbox } = await import("./server");
  const sandbox = await startSandbox({
    port: options.port,
    providerUrl: options.providerUrl,
    balancePhp: options.balancePhp,
    autoApprove: options.autoApprove,
    ...(options.providerKey === undefined ? {} : { providerKey: options.providerKey }),
    ...(options.agentKey === undefined ? {} : { agentKey: options.agentKey }),
  });
  console.log(formatBanner({
    url: sandbox.url, mcpUrl: sandbox.mcpUrl, providerKey: sandbox.providerKey, agentKey: sandbox.agentKey,
    providerUrl: sandbox.providerUrl, autoApprove: options.autoApprove, balancePhp: options.balancePhp,
  }));

  const stop = () => { void sandbox.close().finally(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(describeStartupError(error));
  process.exitCode = 1;
});
