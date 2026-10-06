import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export type Params = Record<string, string | number | boolean | undefined>;

/** GET a JSON endpoint of our API and validate it. The browser's HTTP cache handles ETags. */
export async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  params: Params = {},
  signal?: AbortSignal
): Promise<z.output<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const query = qs.size ? `?${qs}` : "";
  const res = await fetch(`/api${path}${query}`, { signal: signal ?? null });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON; keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(
      502,
      `Unexpected response from ${path}: ${issue?.path.join(".")} ${issue?.message}`
    );
  }
  return parsed.data;
}
