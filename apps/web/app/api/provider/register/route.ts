import { handleRegister } from "@/lib/server/handlers/register";

// Explicit wrapper: Next passes a route context as the second argument, which must not reach the handler options.
export function POST(request: Request): Promise<Response> {
  return handleRegister(request);
}
