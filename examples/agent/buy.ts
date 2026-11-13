// An agent that finds a paid service and buys it. Run the sandbox and the provider example first.
// SETTL_MCP_URL and SETTL_AGENT_API_KEY come from the environment; `settl-dev` prints both.
// The landing page shows the region between the snippet markers; a test keeps the two identical.
import { pathToFileURL } from "node:url";
import { connectSettl } from "@settl/client";

export async function buyReceiptOcr() {
  // snippet:agent
  const agent = await connectSettl();
  const { services } = await agent.listServices();
  const ocr = services.find((service) => service.providerName === "acme");
  if (!ocr) throw new Error("No acme service registered yet");

  const result = await agent.callAndWait(ocr.id, { input: { image: "receipt.jpg" }, maxPricePhp: "5.00" });
  if (result.status === "paid") console.log(result.data, result.receipt.txHash);
  // snippet:end

  await agent.close();
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buyReceiptOcr().then((result) => console.log(result.status), (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Purchase failed");
    process.exitCode = 1;
  });
}
