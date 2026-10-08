import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { FILTER_KEYS } from "../../api/schemas";
import type { Params } from "../../api/client";
import type { FilterValues } from "./filters";

export const DEFAULT_PAGE_SIZE = 10;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A record section's state lives in the URL (shareable links). Several sections share one page, so each section's
 * params are prefixed with its slug: `?single-week-scores.rec=blowout&single-week-scores.scope=playoffs`.
 */
export function useSectionState(key: string) {
  const [search, setSearch] = useSearchParams();
  const prefix = `${key}.`;

  const filters: FilterValues = {};
  for (const f of FILTER_KEYS) {
    const v = search.get(prefix + f);
    if (v) filters[f] = v;
  }
  const rec = search.get(`${prefix}rec`);
  const sort = search.get(`${prefix}sort`) || undefined;
  const dirParam = search.get(`${prefix}dir`);
  const dir: "asc" | "desc" | undefined =
    dirParam === "asc" || dirParam === "desc" ? dirParam : undefined;
  const page = Math.max(1, Number(search.get(`${prefix}page`)) || 1);
  const size = Number(search.get(`${prefix}size`)) || DEFAULT_PAGE_SIZE;

  const update = useCallback(
    (patch: Record<string, string | undefined>, opts: { keepPage?: boolean } = {}) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === "") next.delete(prefix + k);
            else next.set(prefix + k, v);
          }
          if (!opts.keepPage && !("page" in patch)) next.delete(`${prefix}page`);
          return next;
        },
        { replace: true, preventScrollReset: true }
      );
    },
    [prefix, setSearch]
  );

  /** Filter params as the API expects them. */
  const apiParams: Params = { ...filters, ...(sort ? { sort, ...(dir ? { dir } : {}) } : {}) };
  return { rec, filters, apiParams, sort, dir, page, size, update };
}
