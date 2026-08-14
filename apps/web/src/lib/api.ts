import type { ApiErrorBody, AuthResponse, ErrorCode } from "@yu-book/shared";

const BASE_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3333").replace(/\/$/, "");

/**
 * O access token vive em memória, não em localStorage: um XSS não consegue
 * lê-lo de um recarregamento para outro, e a sessão se restaura pelo cookie
 * httpOnly de refresh.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues: { path: string; message: string }[];

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.issues = body.error.issues ?? [];
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(
    response.status,
    body ?? { error: { code: "INTERNAL_ERROR", message: "Falha na comunicação com a API" } },
  );
}

async function rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Yu-Book-Client", "web");
  if (init.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include", // envia o cookie de refresh
  });
}

/**
 * Single-flight: várias chamadas que tomam 401 ao mesmo tempo esperam um único
 * refresh em vez de disparar N rotações concorrentes (que se invalidariam).
 */
let refreshInFlight: Promise<AuthResponse | null> | null = null;

export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await rawRequest("/auth/refresh", { method: "POST" });
      if (!response.ok) {
        setAccessToken(null);
        return null;
      }
      const session = (await response.json()) as AuthResponse;
      setAccessToken(session.accessToken);
      return session;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await rawRequest(path, init);

  // 401 numa rota autenticada: tenta renovar uma vez e repete.
  if (response.status === 401 && accessToken) {
    const session = await refreshSession();
    if (!session) throw await toApiError(response);
    response = await rawRequest(path, init);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
