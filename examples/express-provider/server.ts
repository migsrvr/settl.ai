// A paid API in Express. Run the sandbox first (`npx settl-dev`), then this file.
// The landing page shows the region between the snippet markers; a test keeps the two identical.
import { pathToFileURL } from "node:url";
import express from "express";
import { settl } from "@settl/sdk";

function parseReceipt(_body: unknown) {
  return { merchant: "Mara's Store", total: 120, confidence: 0.97 };
}

/** SETTL_API_URL and SETTL_PROVIDER_KEY come from the environment; `settl-dev` prints both. */
export function createApp({ publicUrl: PUBLIC_URL }: { publicUrl: string }) {
  const app = express();
  app.use(express.json());

  // snippet:provider
  const ocr = settl({ provider: "acme", name: "Receipt OCR", price: "2.00",
                      url: `${PUBLIC_URL}/parse-receipt` });
  app.post("/parse-receipt", ocr, (req, res) => res.json(parseReceipt(req.body)));
  // snippet:end

  // Optional: list the service now instead of on the first request, so agents can find it at once.
  return { app, ready: ocr.register() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  const { app, ready } = createApp({ publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}` });
  app.listen(port, () => {
    console.log(`Provider listening on port ${port}`);
    ready.then(
      (endpointId) => console.log(`Registered with Settl as ${endpointId}`),
      () => console.error("Could not register with Settl yet. It will retry on the first request."),
    );
  });
}
