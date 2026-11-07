import { accountForEmail, normalizeAccountEmail, type DemoAccount } from "../auth";
import { getDb } from "./db";
import { cache } from "react";

/** Shared only within one React request/render; contains public metadata only. */
export const loadWorkspaceOrganization = cache((email: string) => getDb().org.findUnique({
  where: { email }, select: { id: true, email: true, role: true, name: true, contactName: true, walletPublic: true },
}));

/** Public workspace metadata only; never select custodial wallet fields. */
export async function findWorkspaceAccount(value: string): Promise<DemoAccount | null> {
  const known = accountForEmail(value);
  if (known) return known;
  const email = normalizeAccountEmail(value);
  if (!email) return null;
  const org = await loadWorkspaceOrganization(email);
  if (!org || (org.role !== "buyer" && org.role !== "provider")) return null;
  const name = org.contactName || org.name;
  return {
    email, role: org.role, org: org.name, name,
    home: `/${org.role}`,
    initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
  };
}
