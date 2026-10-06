import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { ApiError } from "../api/client";

/** Calls /api/admin/* (cookie session, same origin). Responses are validated; errors carry the server's message. */
export async function apiRequest<T extends z.ZodType>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  schema: T,
  body?: unknown,
  signal?: AbortSignal
): Promise<z.output<T>> {
  return request(method, url, schema, body, signal);
}

export const adminRequest = <T extends z.ZodType>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  schema: T,
  body?: unknown,
  signal?: AbortSignal
) => request(method, `/api/admin${path}`, schema, body, signal);

async function request<T extends z.ZodType>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  schema: T,
  body?: unknown,
  signal?: AbortSignal
): Promise<z.output<T>> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : body instanceof FormData ? body : JSON.stringify(body),
    signal: signal ?? null,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return schema.parse({});
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

export const adminQuery = <T extends z.ZodType>(key: unknown[], path: string, schema: T) =>
  queryOptions({
    queryKey: ["admin", ...key],
    queryFn: ({ signal }) => adminRequest("GET", path, schema, undefined, signal),
    staleTime: 10_000,
  });

/** A write that toasts the outcome and refreshes the admin queries it touched. */
export function useAdminMutation<TVars, TOut>(
  run: (vars: TVars) => Promise<TOut>,
  opts: {
    success?: string | ((out: TOut) => string);
    invalidate?: string[][];
    onDone?: (out: TOut) => void;
  } = {}
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (out) => {
      if (opts.success)
        notifications.show({
          color: "green",
          message: typeof opts.success === "function" ? opts.success(out) : opts.success,
        });
      for (const key of opts.invalidate ?? [])
        await qc.invalidateQueries({ queryKey: ["admin", ...key] });
      opts.onDone?.(out);
    },
    onError: (err) =>
      notifications.show({
        color: "red",
        title: "That didn't work",
        message: err instanceof Error ? err.message : "Unknown error",
      }),
  });
}

/** Runs a zod schema as a Mantine form `validate` function. */
export function zodValidate<S extends z.ZodType>(schema: S) {
  return (values: unknown): Record<string, string> => {
    const parsed = schema.safeParse(values);
    if (parsed.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!(key in errors)) errors[key] = issue.message;
    }
    return errors;
  };
}
