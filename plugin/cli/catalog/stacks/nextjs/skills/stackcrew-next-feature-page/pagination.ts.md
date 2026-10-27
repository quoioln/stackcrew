Goes to `src/shared/pagination.ts`.

```ts
// Default location: src/shared/pagination.ts
import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Bounds `skip`: past this, use keyset pagination (a cursor) instead of a page number. */
export const MAX_PAGE = 1000;

/**
 * `?page=` and `?size=` of every list: strings in the URL, bounded integers here. A route handler answers 400 on a bad
 * value; a page falls back to the first page (pageQueryOrDefault), because a hand-edited URL must not break it.
 */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** One page of DTOs: what a loader returns, a route handler answers and a page renders. */
export type PageDto<T> = {
  readonly items: readonly T[];
  readonly page: number;
  readonly size: number;
  readonly total: number;
};

export function pageQueryOrDefault(params: unknown): PageQuery {
  const parsed = pageQuerySchema.safeParse(params);
  return parsed.success ? parsed.data : pageQuerySchema.parse({});
}

/** `take` and `skip` for a TypeORM find. */
export function pageWindow(query: PageQuery): { take: number; skip: number } {
  return { take: query.size, skip: (query.page - 1) * query.size };
}

export function pageOf<T>(items: readonly T[], query: PageQuery, total: number): PageDto<T> {
  return { items, page: query.page, size: query.size, total };
}

export function lastPage(page: PageDto<unknown>): number {
  return Math.max(1, Math.ceil(page.total / page.size));
}
```
