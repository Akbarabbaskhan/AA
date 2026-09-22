import { z } from 'zod';

/** "Cursor pagination on every list (?cursor=&limit=, default 50, max 200)." */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const paginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type Pagination = z.infer<typeof paginationSchema>;

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

/**
 * Turns an over-fetched result set into a page.
 *
 * Callers ask for `limit + 1` rows; if the extra one came back there is another page, and
 * its id is the cursor. No count query — counting 2,000 students on every list request is
 * exactly the kind of thing that blows the 300ms p95 budget.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: items.at(-1)?.id ?? null };
}

/** The `cursor`/`skip`/`take` trio Prisma needs for keyset pagination. */
export function cursorArgs(pagination: Pagination) {
  return {
    take: pagination.limit + 1,
    ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
  };
}
