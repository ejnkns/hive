/** @public — REST response contract for queen-bee commands. */

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
