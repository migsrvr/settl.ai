import { handleDiscoveryOptions, handleServerCard } from "@/lib/server/discovery";

// SEP-2127 reserves <streamable-http-url>/server-card for the MCP server card.
export function GET(request: Request): Response {
  return handleServerCard(request);
}

export function OPTIONS(): Response {
  return handleDiscoveryOptions();
}
