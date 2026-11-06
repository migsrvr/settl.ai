import { accountForEmail, normalizeAccountEmail, type DemoAccount } from "../auth";
import { getDb } from "./db";

/** Public workspace metadata only; never select custodial wallet fields. */
export async function findWorkspaceAccount(value: string): Promise<DemoAccount | null> {
  const known = accountForEmail(value);
  if (known) return known;
  const email = normalizeAccountEmail(value);
  if (!email) return null;
  const org = await getDb().org.findUnique({
    where: { email }, select: { email: true, role: true, name: true, contactName: true },
  });
  if (!org || (org.role !== "buyer" && org.role !== "provider")) return null;
  const name = org.contactName || org.name;
  return {
    email, role: org.role, org: org.name, name,
    home: `/${org.role}`,
    initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
  };
}
