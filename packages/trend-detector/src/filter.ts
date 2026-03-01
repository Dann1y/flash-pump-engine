import { sql } from "drizzle-orm";
import { createLogger, getDb, trends, tokens } from "@flash-pump/shared";
import { MAX_TREND_AGE_MS } from "./constants";

const log = createLogger("filter");

/** Check if a similar keyword was already launched in the last 24 hours */
async function checkDuplicate(keyword: string): Promise<boolean> {
  const db = getDb();
  const lowerKeyword = keyword.toLowerCase();

  // Check trends table: same/similar keyword launched in last 24h
  const recentTrends = await db
    .select({ id: trends.id })
    .from(trends)
    .where(
      sql`LOWER(${trends.keyword}) ILIKE ${"%" + lowerKeyword + "%"}
          AND ${trends.status} = 'launched'
          AND ${trends.detectedAt} > NOW() - INTERVAL '24 hours'`,
    )
    .limit(1);

  if (recentTrends.length > 0) {
    log.info({ keyword }, "Duplicate trend found in trends table (24h)");
    return true;
  }

  // Check tokens table: token with similar name already exists
  const existingTokens = await db
    .select({ id: tokens.id })
    .from(tokens)
    .where(
      sql`(LOWER(${tokens.name}) ILIKE ${"%" + lowerKeyword + "%"}
           OR LOWER(${tokens.ticker}) ILIKE ${"%" + lowerKeyword + "%"})
          AND ${tokens.status} NOT IN ('failed')
          AND ${tokens.launchedAt} > NOW() - INTERVAL '24 hours'`,
    )
    .limit(1);

  if (existingTokens.length > 0) {
    log.info({ keyword }, "Duplicate trend found in tokens table (24h)");
    return true;
  }

  return false;
}

/** Check if a trend is too old (late entry prevention) */
function checkTiming(detectedAt: Date): boolean {
  const age = Date.now() - detectedAt.getTime();
  if (age > MAX_TREND_AGE_MS) {
    log.debug({ ageMs: age, maxMs: MAX_TREND_AGE_MS }, "Trend too old, skipping");
    return false;
  }
  return true;
}

/** Apply all filters to a trend. Returns true if the trend should proceed. */
export async function applyFilters(
  keyword: string,
  detectedAt: Date,
): Promise<boolean> {
  // Timing check (fast, no DB)
  if (!checkTiming(detectedAt)) {
    return false;
  }

  // Duplicate check (DB queries)
  const isDuplicate = await checkDuplicate(keyword);
  if (isDuplicate) {
    return false;
  }

  return true;
}
