import { handleAiCatalog, handleDiscoveryOptions } from "@/lib/server/discovery";

export function GET(request: Request): Response {
  return handleAiCatalog(request);
}

export function OPTIONS(): Response {
  return handleDiscoveryOptions();
}
