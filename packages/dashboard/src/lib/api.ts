import { CroquisApiError, CroquisClient } from '@croquis/client';

/** Same-origin client: the dashboard is served by the Worker it talks to (cookie session). */
export const api = new CroquisClient({ baseUrl: '' });

export { CroquisApiError };

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof CroquisApiError) return error.problem.detail ?? error.problem.title;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isStatus(error: unknown, status: number): boolean {
  return error instanceof CroquisApiError && error.status === status;
}
