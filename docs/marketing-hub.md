# Marketing CRM intelligence

Marketing Hub is available only to MARKETING accounts. It uses the existing CRM
snapshot and polling; it does not create a second customer database or write
analytics back into customer/order records. Existing accounting order audit and
bill handling remain unchanged.

## Production setup

1. Deploy the committed cPanel assets and restart the Node application.
2. Set a separate random `CRM_API_KEY` in the hosting environment. Never use the
   demo key in production. Restart the application after rotating the key.
3. Expose the API through the site's HTTPS endpoint and configure the external
   Apps Script with:
   - `CRM_EXPORT_URL=https://nvtagency.top/api/leads/export`
   - `CRM_AUTH_HEADER=x-api-key`
   - `CRM_API_KEY` equal to the hosting secret
   - `CRM_EXTRA_FIELDS=course,capital_range,experience,market_interest,main_interest,main_objection,tinh_trang_nhan_tai_lieu`
4. Verify SQL on hosting with `npm run verify:sql`. Local demo storage is RAM and
   does not prove that a production MySQL deployment is configured.

## API contract

`GET /api/leads/export?since=2026-10-01&page=1&limit=500&source=webhook-A`
requires header `x-api-key`. Production returns 503 when no key is configured.
Response: `{data, total, page, limit, next_page_url}`. Follow `next_page_url` with
that same header until it becomes null. Limit is capped at 500. Updated dates
include customer notes, field history and related order updates when available.

`GET /api/customer?phone=0901234567` matches normalized exact phone numbers;
missing phone returns 400, no match 404, duplicate matches 409.

Missing fields retain their keys with null values. `revenue` measures collected
order money after refunds. `deposit_amount` and `first_deposit_at` describe
explicit broker deposit records, never inferred from course purchase totals.
`deposit_currency` accompanies explicit deposits. Extra CRM fields are exposed
under `custom_fields`. Returned timestamps use Vietnam time (`+07:00`).

## Analysis and Telegram

The dashboard and bot share `marketing-hub.js`. L5 is account creation; L6-L10
and L13 indicate historic deposits. L12.2 is excluded. Uncalled and unknown
records do not enter connection-rate denominators. Groups below 10 records are
marked as small samples. IP 4G locations do not produce residence insights.
USD and VND deposits are reported separately.

Available linked-account commands: `/chandung`, `/content`, `/insight`.
Only Marketing and Admin may execute them. The existing Telegram worker invokes
Marketing insight on Monday between 09:00 and 09:10 Vietnam time. A durable
SQL claim prevents duplicate deliveries across worker restarts. This requires
configured MySQL, a running Telegram worker and linked Marketing chat IDs.

Insights currently use local statistical rules, not an external generative AI.
Facebook demographic aggregates, ad titles/body and spend appear only when
real corresponding data exists in the CRM traffic/website collections. This
change does not establish a Meta Ads connector, Google Sheet writer, external
Apps Script deployment or Facebook Pixel event sender. Those systems require
their own credentials and deployment context. The Sales dropdowns are left
unchanged under the user's Marketing-only UI scope; missing persona fields are
shown as missing rather than invented.

## Local demo

Run `npm run demo` and open `http://localhost:4173`.
Marketing demo login: `marketing.demo@local.test` / `MarketingDemo2026!`.
The local API demo key is `crm_secret_marketing_key_2026` and is accepted only
when `DEMO_MODE=1`. Demo figures are samples, not live CRM data.


## Staff and customer analysis API
`GET /api/marketing/staff-ranking` returns read-only staff metrics from CRM. It includes connection, conversion, note coverage, processing-time coverage, and a confidence flag. It requires `x-api-key`. `GET /api/marketing/staff-ranking?ai=1` additionally asks the configured server-side AI provider for a structured narrative; if `OPENAI_API_KEY` is absent, the response explicitly returns `not_configured`.

`GET /api/marketing/customer-analysis?customer_id=...` returns a read-only customer assessment from Sale notes, call evidence, level, conversion and timing. Add `ai=1` for the optional structured AI assessment. Notes are treated as evidence, not instructions; the result includes limitations and does not automatically classify staff performance or change CRM data.

Set `OPENAI_API_KEY`, optionally `OPENAI_MODEL` and `OPENAI_TIMEOUT_MS`, only in the hosting environment. Never put the key in `marketing-hub.js`, the browser, or the API response.
