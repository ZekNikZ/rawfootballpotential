import { ApiResponse } from "../types";

export function makeError(error: string, description?: string): ApiResponse<never> {
  return { success: false, error, description };
}

export function makeResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}
