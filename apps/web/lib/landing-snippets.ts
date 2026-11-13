// Shown on the landing page. landing-snippets.test.ts keeps these identical to the runnable
// examples in /examples, which packages/dev/test/examples.test.ts runs against the sandbox.

export const PROVIDER_CODE = `import { settl } from "@settl/sdk";

const ocr = settl({ provider: "acme", name: "Receipt OCR", price: "2.00",
                    url: \`\${PUBLIC_URL}/parse-receipt\` });
app.post("/parse-receipt", ocr, (req, res) => res.json(parseReceipt(req.body)));`;

export const AGENT_CODE = `import { connectSettl } from "@settl/client";

const agent = await connectSettl();
const { services } = await agent.listServices();
const ocr = services.find((service) => service.providerName === "acme");
if (!ocr) throw new Error("No acme service registered yet");

const result = await agent.callAndWait(ocr.id, { input: { image: "receipt.jpg" }, maxPricePhp: "5.00" });
if (result.status === "paid") console.log(result.data, result.receipt.txHash);`;
