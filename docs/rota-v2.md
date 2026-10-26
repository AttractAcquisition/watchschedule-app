# Vessel-wide rota model — approved 22 September 2026

This contract supersedes per-lane fairness, disjoint department groups, department-count tier limits, and the old fairness freeze in earlier specifications. The captain approved overlapping department pools and implementation.

- Solo permits 1 active lane, Dual 1–2, Triple 1–3. Each active lane requires a nonempty subset of the four departments. Departments may appear in multiple lanes or none. Every active lane requests one different person per scheduled date.
- Configuration is saved atomically by an authenticated RPC deriving the vessel and subscription from the caller. Direct client lane/configuration writes are revoked. Changes affect the next generation; existing schedules retain their lane snapshots.
- Fairness is per vessel and crew, across all lanes. Opportunities count available scheduled dates ONCE per person, regardless of how many lanes include them. For weekend blocks the person must be available for the complete block. Excluded departments, ineligible crew, pre-joining dates, leave and charter pauses accrue no opportunities.
- Day/block assignment maximizes coverage, then minimizes constraint relaxations (Monday-after-weekend, and from 26 October 2026 the Friday-to-weekend exclusion — at most one of the two is in force on any date), then global opportunity-normalized selection cost. Stable tie-breaking makes input ordering irrelevant. Block duty counts each covered date. Weekday/Friday and weekend selection weights remain distinct. Anchors only affect otherwise-flat initial choices.
- Scores compare weighted burden rates across the entire currently participating crew. Department sections are presentation only. A two-person dedicated lane versus a five-person dedicated lane must show unequal workload; restricted membership can prevent the scheduler from eliminating that inequality. Show direction and workload, not a claim that all constraints can be made equal.
- The legacy engine and lane-ledger records remain for audit. V2 stores one global ledger, dated opportunity snapshots and schedule lane snapshots. Rebuild from seed plus canonical past assignments across ALL schedule versions, including retired lanes. For each historical date use the latest applicable schedule version, never add overlapping versions. New generation replaces only its future and publishes all results atomically with a vessel revision check.
- Legacy schedules lack historical eligibility snapshots. Reconstruct opportunities using available crew/leave and legacy lane information, flag them as estimated, and never present those denominators as exact. Existing seed counts are carried across lanes; legacy seed opportunities use a conservative maximum rather than summed duplicate exposure. New imports deduplicate crew/date and preserve actual dates.
- New imports only replace the imported seed, not generated history. Do not infer an uploaded crew member's old lane from today's department mapping. Ambiguous name matches are reported, never guessed.
- Backend remains the sole writer of schedules and fairness. RLS, subscription authority and deterministic scheduling are preserved. Configuration, crew, leave and charter mutations invalidate an in-flight generation through a shared vessel revision.

Verification covers overlap, constrained matching, tier limits, partial lane usage, unequal pool scoring, history across regrouping, repeated regeneration, leave/charter dates, weekend blocks, seed deduplication, concurrency and tenant isolation.

The fairness score scale uses a gentler vessel-wide standard-deviation factor (K=12) so small integer differences such as 6/7/8 watches in an 11-person season are contextualised rather than presented as catastrophic. The raw count, vessel average, and difference remain visible in the expanded fairness details.

## Implementation and operational trade-offs

`rota_v2.ts` owns pure joint matching and global replay. `rota_data.ts` loads paginated, vessel-scoped history; `generate-schedule` publishes through service-only `publish_rota`. The captain saves the matrix through `save_watch_configuration`; seed imports use service-only `replace_rota_seed`. The browser reads `vessel_fairness`, never computes balances.

Lane and opportunity snapshots live on each immutable schedule version. Legacy opportunity reconstruction is frozen on the first V2 generation and explicitly marked estimated. Legacy lane ledgers remain read-only audit data. The first V2 generation populates vessel-wide scores; deployment itself does not replace a captain's rota.

Matching is bounded to three lanes; retaining the best N candidates per constraint class limits exhaustive matching while preserving its optimum. Replaying all history is simpler and safer than mutable cumulative counters, but grows with vessel history. Revisit checkpointed, versioned ledgers and relational opportunity storage if history size or generation latency becomes material. Revision conflicts fail safely and request a retry instead of publishing stale results.

Verification commands: `deno test supabase/functions/_shared/rota_v2_test.ts`, backend `deno check`, and `npm run build` in `app`. Run `supabase/tests/rota_v2.sql` inside BEGIN/ROLLBACK against the allowlisted project to test configuration, tier limits, publication, and RLS without retaining fixtures.
