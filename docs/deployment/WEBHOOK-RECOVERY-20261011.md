# Webhook recovery — 11 October 2026

This release writes each authenticated, parsed webhook to a private durable journal
under `WEBHOOK_DATA_DIR/pending` before querying MySQL. When SQL is unavailable,
the endpoint returns 503 with `received:false, queued:true`. This means queued on
disk, not yet committed to CRM. The sender can safely retry; SQL dedupe keys avoid
duplicating customers or outbox entries. Journal writes that fail return 503 and
must be retried by the sender.

After SQL commits, the pending file is removed. Startup and a 60-second timer
retry pending journal records. Failed records remain for retry; one failure does
not stop subsequent records. A crash after commit but before file removal is safe
because replay does not reinsert the customer or Telegram notice.

Historical inbox recovery is limited to unconfirmed records with a local
`receivedAt` date of `2026-10-11` (override with `WEBHOOK_RECOVERY_DATE`). Older
inbox records are left alone. Recovery calls the writer with `skipAutomatic:true`, then runs assignment only for the newly restored customer;
it does not scan or reassign existing customers. Recovered new leads therefore follow the current webhook routing configuration. Existing matching customers keep their name, phone, notes,
level and ownership; duplicate intake is recorded separately. Notification-only
webhooks are never recovered as customers and need their original sender retry.

Telegram retains the existing durable SQL outbox and delivery lock. If the local
worker is not running, the web process attempts a non-blocking outbox drain after
intake and during recovery ticks. The lock coordinates with any other worker.
SENT notices are not deliberately resent; Telegram delivery remains at-least-once
(a crash after Telegram accepts but before SQL acknowledgement can repeat a send).
A valid bot token, destination chat and Telegram connectivity are still required.

Marketing snapshot reads now always use the passive read path, so opening the
Marketing dashboard cannot expire offers or run automatic assignment. The push
API still merges only its marketing custom fields and updatedAt; it does not
write human notes, Sale, Level, phone or source.

## Deploy

1. Deploy the release through cPanel Git **Update from Remote**, then **Deploy HEAD
   Commit**. The deployment manifest includes `webhook-journal.cjs` in the Node root.
   Deployment paths are resolved from the active cPanel account's `$HOME`; do not
   reuse a `/home/<old-user>/...` path copied from another hosting account.
2. Preserve `WEBHOOK_DATA_DIR` and `WEBHOOK_INBOX_FILE` if configured. The Node user
   needs write permission there. Do not delete or replace existing inbox files.
   If either setting still points to an inaccessible previous cPanel account, the
   server falls back to the active account's `$HOME/webhook-data` and reports
   `webhookStorage.fallback: true` from `/api/health/live`.
3. Keep the backfill date `WEBHOOK_RECOVERY_DATE=2026-10-11`, even if deploying later.
4. Restart the Node app. Public `/api/health/live` should report build
   `20261011-webhook-recovery-2`.
5. Check logs for `[webhook-recovery] Recovered:` and failures. Confirm recovered
   leads appear in CRM and Telegram notices arrive. Do not clear SENT outbox states.

No production SQL migration is needed. This release cannot recover requests that
never reached the application, failed authentication, or were lost by the old
version before any durable write. Retrieve those submissions from the original
landing page/Sheet and resend through its existing authenticated webhook.

Local automated tests use filesystem journals and SQL fixtures; they are not proof
of production restoration. The live health probe before deployment returned the
previous build `20261010-marketing-6`, with local Telegram worker `standby`.

## Follow-up review

- Recovery rotates through batches of at most 100 distinct events so repeated
  failures or notification-only entries cannot indefinitely block later leads.
- Legacy inbox and journal copies of one event are acknowledged together.
- A successful SQL commit invalidates the CRM cache even if journal cleanup fails;
  failed cleanup retains the file for safe replay.
- The Telegram fallback is attempted even if reading the journal fails.
- Duplicate webhook replies preserve the original customer ID and ownership from
  the stored event, including when intake matched an existing customer.
- Marketing audit IDs hash the full request/customer pair rather than truncating
  it, preserving separate audit entries for large request IDs and multi-lead batches.

Validation: 503 automated tests passed; syntax checks passed for 62 tracked JS/CJS
files. Tests use SQL fixtures; no production customers were changed during review.
The public production health probe still returned `20261010-marketing-6`. Deploy
HEAD and restart Node before testing the new recovery build on hosting.

## Multipart intake fix and hosting diagnosis (build 20261011-webhook-recovery-4)

The request Content-Type media type and charset remain case-insensitive, but the
multipart boundary now preserves its original case. Previously lowercasing the
entire header made mixed-case boundaries fail to match the body. Valid forms
could be stored as INVALID events with missing name/phone and no customer row.
A regression test demonstrates the failure before the fix and succeeds after it.
Existing INVALID events are not automatically promoted or reconstructed. If the
original raw fields were lost during decoding, retrieve and resend the original
submission through the configured authenticated webhook.

Webhook intake also invalidates the shared CRM snapshot after the SQL commit.
This avoids retaining a snapshot populated by a concurrent GET while intake was
still in progress. Authentication failures log [webhook-auth] TOKEN_MISMATCH;
validation failures log [webhook-invalid] with event ID and validation problems.
Neither new log contains credentials or submitted contact details.

After updating and restarting, run in cPanel Terminal:

```bash
source "$HOME/nodevenv/crm/18/bin/activate"
cd "$HOME/crm"
node tools/diagnose-webhook.cjs --date 2026-10-11
```

This command runs only SELECT queries and reads the inbox/journal. It does not
prepare schema, resend notifications, distribute customers or alter records.
It omits customer names, phone numbers, email addresses, raw payloads and secrets.
The output includes event status, whether the customer row exists, whether a
customer document marks it deleted, source slugs, pending counts and SQL errors.

Interpretation:

- INVALID plus missing name/phone: inspect the original sender payload and retry
  with corrected parsing/field mapping. Do not invent missing fields.
- Pending journal records plus SQL errors: fix the specific reported SQL error;
  keep pending files for the automatic retry.
- NEW plus customerExists:true: investigate the selected role, date filters,
  ownership scope and frontend refresh; intake has reached SQL.
- No matching recent event in inbox, journal or SQL: check the sender's webhook
  history, exact URL and headers. Health alone cannot prove a form was delivered.
- A repeated phone/email can resolve to an existing customer. A new row is not
  required; original ownership and notes are preserved.

Public probes during this review returned HTTP 200, build
20261011-webhook-recovery-3, MySQL ready, inbox count 898 and token configured.
Earlier connection failures in the local inspection environment were not evidence
that the hosting Node application was down. The command above must run on the
hosting account to confirm the state of individual submissions.

Validation for this follow-up: 512 automated tests passed. Production recovery
and receipt of new submissions still require the hosting diagnostic report.
