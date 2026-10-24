import { QueryFailedError } from 'typeorm';

export const PG_UNIQUE_VIOLATION = '23505';

/** True when `err` is a PostgreSQL unique violation whose detail cites `column`. */
export function isUniqueViolationOn(err: unknown, column: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const { code, detail } = err as QueryFailedError & {
    code?: unknown;
    detail?: unknown;
  };
  return (
    code === PG_UNIQUE_VIOLATION &&
    typeof detail === 'string' &&
    detail.includes(`(${column})`)
  );
}
