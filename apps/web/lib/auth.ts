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
  { email: "geoph@example.com", name: "GeoPH Team", org: "GeoPH", role: "provider", home: "/provider", initials: "GP" },
  { email: "juan@example.com", name: "Juan dela Cruz", org: "Juan’s Accounting", role: "buyer", home: "/buyer", initials: "JC" },
  { email: "acme@example.com", name: "Carlos Mendez", org: "Acme AI Corp", role: "buyer", home: "/buyer", initials: "CM" },
];

export function normalizeAccountEmail(value: string): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(email) ? email : null;
}

export function accountForEmail(email: string): DemoAccount | null {
  const normalized = normalizeAccountEmail(email);
  return normalized ? DEMO_ACCOUNTS.find((a) => a.email === normalized) ?? null : null;
}

export function resolveDemoAccount(email: string): DemoAccount | null {
  return accountForEmail(email);
}

export function accountFor(role: Role): DemoAccount {
  return DEMO_ACCOUNTS.find((a) => a.role === role)!;
}

/** Demo identity only. API/data access must independently verify the stored org role. */
export function resolveSession(cookieValue: string | undefined): { email: string; role: Role } | null {
  if (!cookieValue || cookieValue.length > 1024) return null;
  let value: string;
  try { value = decodeURIComponent(cookieValue).trim().toLowerCase(); }
  catch { return null; }
  if (value === "buyer" || value === "provider") {
    return { email: accountFor(value).email, role: value };
  }
  const separator = value.indexOf(":");
  if (separator !== -1) {
    const role = value.slice(0, separator);
    const email = normalizeAccountEmail(value.slice(separator + 1));
    if ((role !== "buyer" && role !== "provider") || !email) return null;
    const known = accountForEmail(email);
    if (known && known.role !== role) return null;
    return { email, role };
  }
  const account = accountForEmail(value);
  return account ? { email: account.email, role: account.role } : null;
}
