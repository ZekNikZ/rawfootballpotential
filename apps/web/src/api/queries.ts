import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getJson, type Params } from "./client";
import {
  blogResponse,
  catalogResponse,
  franchiseProfileResponse,
  franchisesResponse,
  h2hResponse,
  leaguesResponse,
  draftsResponse,
  matchupsResponse,
  picksResponse,
  teamsResponse,
  recordResponse,
  siteResponse,
  standingsResponse,
  transactionsResponse,
  trophiesResponse,
} from "./schemas";

const MINUTE = 60_000;

export const leaguesQuery = () =>
  queryOptions({
    queryKey: ["leagues"],
    queryFn: ({ signal }) => getJson("/leagues", leaguesResponse, {}, signal),
    staleTime: 5 * MINUTE,
  });

export const siteQuery = () =>
  queryOptions({
    queryKey: ["site"],
    queryFn: ({ signal }) => getJson("/site", siteResponse, {}, signal),
    staleTime: 5 * MINUTE,
  });

export const catalogQuery = (league: string) =>
  queryOptions({
    queryKey: ["catalog", league],
    queryFn: ({ signal }) => getJson(`/leagues/${league}/records`, catalogResponse, {}, signal),
    staleTime: 5 * MINUTE,
  });

export const recordQuery = (league: string, id: string, params: Params) =>
  queryOptions({
    queryKey: ["record", league, id, params],
    queryFn: ({ signal }) =>
      getJson(`/leagues/${league}/records/${id}`, recordResponse, params, signal),
    placeholderData: keepPreviousData,
    staleTime: MINUTE,
  });

export const h2hQuery = (league: string, params: Params) =>
  queryOptions({
    queryKey: ["h2h", league, params],
    queryFn: ({ signal }) => getJson(`/leagues/${league}/h2h`, h2hResponse, params, signal),
    placeholderData: keepPreviousData,
    staleTime: MINUTE,
  });

export const trophiesQuery = (league: string) =>
  queryOptions({
    queryKey: ["trophies", league],
    queryFn: ({ signal }) => getJson(`/leagues/${league}/trophies`, trophiesResponse, {}, signal),
    staleTime: MINUTE,
  });

export const franchisesQuery = (league: string) =>
  queryOptions({
    queryKey: ["franchises", league],
    queryFn: ({ signal }) =>
      getJson(`/leagues/${league}/franchises`, franchisesResponse, {}, signal),
    staleTime: 5 * MINUTE,
  });

export const franchiseQuery = (league: string, id: number) =>
  queryOptions({
    queryKey: ["franchise", league, id],
    queryFn: ({ signal }) =>
      getJson(`/leagues/${league}/franchises/${id}`, franchiseProfileResponse, {}, signal),
    staleTime: MINUTE,
  });

export const blogQuery = () =>
  queryOptions({
    queryKey: ["blog"],
    queryFn: ({ signal }) => getJson("/blog", blogResponse, {}, signal),
    staleTime: 10 * MINUTE,
    retry: false,
  });

export const standingsQuery = (seasonId: number, week?: number) =>
  queryOptions({
    queryKey: ["standings", seasonId, week ?? "latest"],
    queryFn: ({ signal }) =>
      getJson(
        `/seasons/${seasonId}/standings`,
        standingsResponse,
        week === undefined ? {} : { week },
        signal
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const matchupsQuery = (seasonId: number, week?: number, players = false) =>
  queryOptions({
    queryKey: ["matchups", seasonId, week ?? "current", players],
    queryFn: ({ signal }) =>
      getJson(
        `/seasons/${seasonId}/matchups`,
        matchupsResponse,
        { ...(week === undefined ? {} : { week }), ...(players ? { players: "true" } : {}) },
        signal
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const teamsQuery = (seasonId: number, rosters: boolean) =>
  queryOptions({
    queryKey: ["teams", seasonId, rosters],
    queryFn: ({ signal }) =>
      getJson(
        `/seasons/${seasonId}/teams`,
        teamsResponse,
        rosters ? { rosters: "true" } : {},
        signal
      ),
    staleTime: 60_000,
  });

export const transactionsQuery = (seasonId: number, params: Params) =>
  queryOptions({
    queryKey: ["transactions", seasonId, params],
    queryFn: ({ signal }) =>
      getJson(`/seasons/${seasonId}/transactions`, transactionsResponse, params, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const draftsQuery = (seasonId: number) =>
  queryOptions({
    queryKey: ["drafts", seasonId],
    queryFn: ({ signal }) => getJson(`/seasons/${seasonId}/draft`, draftsResponse, {}, signal),
    staleTime: 60_000,
  });

export const picksQuery = (league: string) =>
  queryOptions({
    queryKey: ["picks", league],
    queryFn: ({ signal }) => getJson(`/leagues/${league}/picks`, picksResponse, {}, signal),
    staleTime: 60_000,
  });

export const recentTransactionsQuery = (seasonId: number) =>
  transactionsQuery(seasonId, { limit: 8 });
