import { httpApi } from "./http";
import { mockApi } from "./mock/mockApi";
import type { FinanceApi } from "./interface";

/**
 * Browser mocks are opt-in. The default uses the integrated backend.
 * Set NEXT_PUBLIC_USE_MOCKS=false (and BACKEND_URL) to talk to the real backend.
 */
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export const api: FinanceApi = USE_MOCKS ? mockApi : httpApi;

export { ApiError } from "./http";
export type { FinanceApi } from "./interface";
export * from "./types";
