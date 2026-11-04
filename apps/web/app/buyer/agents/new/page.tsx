import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { NewAgentForm } from "@/components/buyer/new-agent-form";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Create an agent" };

export default function NewAgentPage() {
  return (
    <AppShell role="buyer" active="/buyer" crumbs={[{ href: "/buyer", label: "Agents" }, { label: "New agent" }]}>
      <PageHeader title="Create an agent" lead="Name it and set the limits it must stay within. You’ll load its budget on the next screen." />
      <NewAgentForm />
    </AppShell>
  );
}
