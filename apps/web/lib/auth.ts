export type Role = "provider" | "buyer";

export type DemoAccount = {
  email: string;
  name: string;
  org: string;
  role: Role;
  home: string;
  initials: string;
};

export const SESSION_COOKIE = "settl_demo";

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "mara@example.com", name: "Mara Santos", org: "ResiboAI", role: "provider", home: "/provider", initials: "MS" },
  { email: "juan@example.com", name: "Juan dela Cruz", org: "Juan’s Accounting", role: "buyer", home: "/buyer", initials: "JC" },
];

export function resolveDemoAccount(email: string): DemoAccount | null {
  const normalized = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((a) => a.email === normalized) ?? null;
}

export function accountFor(role: Role): DemoAccount {
  return DEMO_ACCOUNTS.find((a) => a.role === role)!;
}
