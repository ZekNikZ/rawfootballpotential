import stringHash from "string-hash";
import {
  ApiResponse,
  GetConfigResponse,
  GetLeagueResponse,
  GetNFLResponse,
  LeagueId,
} from "../types";

export class Api {
  private static getFromCache(key: number): object | undefined {
    const cacheValue = localStorage.getItem(`api-${key}`);
    if (cacheValue) {
      return JSON.parse(cacheValue);
    } else {
      return undefined;
    }
  }

  private static putInCache(key: number, value: object) {
    localStorage.setItem(`api-${key}`, JSON.stringify(value));
  }

  private static async request<T extends ApiResponse<unknown>>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    options?: {
      cache?: boolean;
    }
  ): Promise<T> {
    const cacheKey = stringHash(`${method} ${path} ${JSON.stringify(body)}`);
    const cachedValue = this.getFromCache(cacheKey);
    if (options?.cache && cachedValue) {
      return cachedValue as T;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        return {
          success: false,
          error: `${res.status}: ${res.statusText}`,
        } as T;
      }
      const json = await res.json();
      if (options?.cache) {
        this.putInCache(cacheKey, json);
      }
      return json;
    } catch (err) {
      return {
        success: false,
        error: `Unknown error: ${err}`,
      } as T;
    }
  }

  public static async clearCache() {
    // FIXME: make this work
  }

  public static async getConfig() {
    return await this.request<GetConfigResponse>("GET", "/config", undefined, { cache: true });
  }

  public static async getLeague(leagueId: LeagueId) {
    return await this.request<GetLeagueResponse>("GET", `/leagues/${leagueId}`, undefined);
  }

  public static async getNFLData() {
    return await this.request<GetNFLResponse>("GET", "/nfl", undefined);
  }
}
