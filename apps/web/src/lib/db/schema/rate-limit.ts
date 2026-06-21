import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Fixed-window rate-limit counters. One row per `{bucket}:{id?}:{ip}` key,
 * upserted atomically on each request (see `$lib/server/rate-limit`). Durable
 * (shared across serverless instances, unlike an in-memory Map) and cheap —
 * a single INSERT … ON CONFLICT per call. Expired rows are harmless leftovers;
 * the limiter resets them in place on the next hit, and the cron sweep can
 * prune `expires_at < now()` if the table ever grows.
 */
export const rateLimit = pgTable("rate_limit", {
	key: text("key").primaryKey(),
	count: integer("count").notNull().default(0),
	expiresAt: timestamp("expires_at").notNull(),
});

export type RateLimit = typeof rateLimit.$inferSelect;
