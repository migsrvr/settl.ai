// The same paid API as a Next.js route handler (app/api/parse-receipt/route.ts).
// withSettl works with any framework that uses the web-standard Request and Response.
import { withSettl } from "@settl/sdk";

export const POST = withSettl(
  async (request, { receipt }) => {
    const body: unknown = await request.json().catch(() => ({}));
    return Response.json({ merchant: "Mara's Store", total: 120, paidWith: receipt?.txHash, echoed: body });
  },
  {
    provider: "acme-next",
    name: "Receipt OCR (Next.js)",
    price: "2.00",
    url: `${process.env.PUBLIC_URL ?? "http://localhost:3000"}/api/parse-receipt`,
  },
);
