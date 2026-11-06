const REQUEST_TIMEOUT_MS = 10_000;

export function serviceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Invalid service URL");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("apiUrl must be an HTTP(S) URL without credentials, query, or fragment");
  }
}

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Payment service timeout"));
    }, timeoutMs);
  });
  const request = async (): Promise<unknown> => {
    const response = await fetch(url, {
      method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
      // A redirect must never forward the provider credential to another service.
      redirect: "error",
    });
    if (!response.ok) throw new Error("Payment service error");
    return response.json();
  };
  try {
    // Bound both connection time and response body parsing, even if a client ignores abort.
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}
