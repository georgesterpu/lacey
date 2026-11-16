# Collection workflow failures and recovery

The **Parser and delivery checks** workflow compiles and tests the repository.
**Lacey checks and digests** runs collection and email delivery against production.
A failed collection run does not necessarily mean the application build failed.

## Incident: 15 November 2026

Runs `43760268342`, `43775815367` and `43777535280` failed on the same
21RUN checkpoint. After 1,489 products, the catalogue linked SKU `JI2996` as
`adidas-sprintstar-kids-ji2996`, while the product API returned
`adidas-sprintstar-unisex-ji2996`. The identity check correctly rejected it;
the old collector incorrectly made that single listing fatal. Later runs
immediately returned the stored failure instead of resuming.

## Current behaviour

- Conflicting product responses are quarantined, never published or emailed.
  Reports retain the rejection count and up to ten SKU/URL/reason examples.
- A crawl with over 5% rejected products still fails and withholds its snapshot.
  A smaller rejection count publishes verified products with partial coverage.
- Connection failures, interrupted bodies and retailer HTTP 5xx responses retry
  the same checkpoint, with 15/30-second backoff and three attempts total.
  No product is skipped because a request timed out.
- HTTP 401/403/406/429 and robots restrictions remain failures; retailer blocks
  retain the existing 12-hour pause. Retries do not bypass access restrictions.
- GitHub-to-app connection/5xx failures also get bounded retries. Completed
  checkpoints and delivery receipts remain idempotent.

## Recover a checkpoint

After investigating and fixing a failure, open **Lacey checks and digests →
Run workflow**. Select `catalogue_only` and optionally enter `resume_run_id`.
This resumes collection without starting a new scan or sending email. Leaving
the scan ID blank reuses the latest durable scan namespace without starting a source scan.

Only the old identity-mismatch failure and bounded transient failures resume
automatically. Other permanent failures still require investigation. Check
the workflow result and `source_runs` rejection details; a checkpoint advancing
does not prove the entire catalogue has finished. Publication happens only
after the full crawl and the empty/shrink/rejection checks pass.

## Delivery isolation

The workflow now has separate concurrency groups for its delivery and catalogue
jobs. The short delivery job refreshes the smaller feeds, validates matches,
dispatches the digest and saves an encrypted backup. It does not wait for 21RUN.
The catalogue job runs independently after delivery, or directly in catalogue-only
mode. A pending catalogue cannot block the next slot's delivery job.

The catalogue worker checkpoints for at most 90 minutes, then exits successfully
with an explicit continuation message if work remains. Its 100-minute platform
budget leaves room to finish the current request. Actual validation errors still
fail the worker. A later invocation resumes the active cursor across scan slots
instead of throwing away its progress. Fresh published catalogues are eligible
for later digests even when collected under an earlier scan ID; each offer still
has to pass the freshness, source status and pre-send verification checks.

Retailer response latency can make a full crawl much longer than its theoretical
one-request-per-second minimum. An advancing cursor is not full coverage or a
promise of two complete EU crawls per day. Customer records are independent of
these catalogue jobs.
