import { ApiResponse, GetConfigResponse } from "../types";

export class Api {
  private static async request<T extends ApiResponse<unknown>>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
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
      return await res.json();
    } catch (err) {
      return {
        success: false,
        error: `Unknown error: ${err}`,
      } as T;
    }
  }

  public static async getConfig() {
    return await this.request<GetConfigResponse>("GET", "/config");
  }
}
