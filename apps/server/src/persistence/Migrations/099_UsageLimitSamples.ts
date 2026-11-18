import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_limit_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_key TEXT NOT NULL,
      driver TEXT NOT NULL,
      window_id TEXT NOT NULL,
      window_kind TEXT NOT NULL,
      checked_at_ms INTEGER NOT NULL,
      used_percent REAL NOT NULL,
      resets_at_ms INTEGER
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_usage_limit_samples_checked_at
    ON usage_limit_samples (checked_at_ms)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_usage_limit_samples_account_window
    ON usage_limit_samples (account_key, window_id, checked_at_ms)
  `;
});
