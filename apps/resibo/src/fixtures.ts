export type ReceiptFixture = "clean" | "blurry" | "wrong_total";

interface DemoReceipt {
  merchant_name: string;
  date: string;
  total: number;
  line_items: { description: string; amount: number }[];
  confidence: number;
}

export const receiptFixtures = {
  clean: {
    merchant_name: "Resibo Demo Store",
    date: "2026-11-05",
    total: 1250.5,
    line_items: [
      { description: "Office supplies", amount: 1000 },
      { description: "Delivery", amount: 250.5 },
    ],
    confidence: 0.98,
  },
  blurry: {
    merchant_name: "Resibo Demo Store",
    date: "2026-11-05",
    total: 1250.5,
    line_items: [
      { description: "Office supplies", amount: 1000 },
      { description: "Delivery", amount: 250.5 },
    ],
    confidence: 0.42,
  },
  wrong_total: {
    merchant_name: "Resibo Demo Store",
    date: "2026-11-05",
    total: 500,
    line_items: [
      { description: "Notebook", amount: 125 },
      { description: "Pen set", amount: 75 },
    ],
    confidence: 0.98,
  },
} satisfies Record<ReceiptFixture, DemoReceipt>;

export const geographySample = {
  country: "Philippines",
  region: "National Capital Region",
  city: "Makati",
  postal_code: "1226",
  latitude: 14.5547,
  longitude: 121.0244,
};
