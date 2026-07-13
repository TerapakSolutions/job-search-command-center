import { getApiBaseUrl } from './persistence';

/** Dispatched whenever the API rejects a request with 401. */
export const SESSION_EXPIRED_EVENT = 'jobsearch:session-expired';

export class ApiError extends Error {
  readonly status: number;
  /** Raw response body, kept for logging/debugging — never render this directly. */
  readonly body: string;

  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(body: string) {
    super(401, body, 'Your session has expired. Please sign in again.');
    this.name = 'UnauthorizedError';
  }
}

function emitSessionExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

/**
 * Turn an error response into something safe to show a human.
 * The server's raw body (e.g. `{"error":"Unauthorized"}`) is never surfaced verbatim.
 */
function friendlyMessage(status: number, body: string): string {
  let serverMessage = '';
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const raw = parsed.message ?? parsed.error;
    if (typeof raw === 'string') serverMessage = raw.trim();
  } catch {
    // Non-JSON body (HTML error page, proxy error, empty). Ignore it.
  }

  // Don't echo bare status words back at the user.
  if (/^(unauthorized|forbidden|not found|internal server error)$/i.test(serverMessage)) {
    serverMessage = '';
  }

  switch (status) {
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return serverMessage || 'We couldn’t find that item.';
    case 409:
      return serverMessage || 'That change conflicts with the current data. Refresh and try again.';
    case 422:
      return serverMessage || 'Some of the submitted values are invalid.';
    case 429:
      return 'Too many requests. Give it a moment and try again.';
    default:
      break;
  }

  if (status >= 500) {
    return 'The server had a problem handling that. Please try again.';
  }
  return serverMessage || `Request failed (${status}).`;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => '');
  if (res.status === 401) {
    emitSessionExpired();
    return new UnauthorizedError(body);
  }
  return new ApiError(res.status, body, friendlyMessage(res.status, body));
}

/**
 * Single entry point for every authenticated API call.
 * - always sends the session cookie
 * - converts 401 into a session-expired signal the app can act on
 * - never leaks raw server error bodies into the UI
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  } catch {
    throw new ApiError(0, '', 'Could not reach the server. Check your connection.');
  }

  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

/** Same as `apiRequest`, but a 404 resolves to `null` instead of throwing. */
export async function apiRequestOrNull<T>(
  path: string,
  options: RequestInit = {},
): Promise<T | null> {
  try {
    return await apiRequest<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export function isUnauthorized(err: unknown): err is UnauthorizedError {
  return err instanceof UnauthorizedError;
}
