import { handleLlmsTxt } from "@/lib/server/discovery";

export function GET(request: Request): Response {
  return handleLlmsTxt(request);
}
