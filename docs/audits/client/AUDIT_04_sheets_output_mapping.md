# Google Sheets Output Mapping (Client-Facing)

This document describes exactly what you will see and use in the Google Sheet. It focuses only on the sheet output, how it is updated, and how your edits affect the system.

---

## 1) Exact Google Sheets Schema

The system writes a single row per company with **10 columns (A–J)**, in this exact order:

| Column | Column Name | Data Type | Source of Value | How It Is Calculated | Client Editable? | Update Frequency & Rules |
| --- | --- | --- | --- | --- | --- | --- |
| A | `company_id` | Number (integer) | Company ID in the internal database | Direct value from the company record | **No** (should not be edited) | Written once when the row is first appended. Never overwritten afterward. Used as the unique key for updates and feedback. |
| B | `company_name` | String | Company display name from the internal database | Fallback chain: display name → normalized name → “(no name)” | Yes (system does not overwrite) | Written once when the row is first appended. Never updated afterward. |
| C | `resolution` | Enum string | Client feedback | Default `PENDING` when first appended | **Yes (client-controlled)** | Written once when the row is first appended. Never overwritten by the system. Read by the system during feedback processing. |
| D | `max_score` | Decimal (1 place) or empty | Company metric | Highest offer score for the company | No (will be overwritten) | Updated on every sync for existing rows. Empty if no value. |
| E | `strong_offers` | Number (integer) or empty | Company metric | Count of strong offers (score ≥ 6) | No (will be overwritten) | Updated on every sync for existing rows. Empty if no value. |
| F | `unique_offers` | Number (integer) or empty | Company metric | Count of canonical offers | No (will be overwritten) | Updated on every sync for existing rows. Empty if no value. |
| G | `posting_activity` | Number (integer) or empty | Company metric | Activity-weighted offer count (includes reposts) | No (will be overwritten) | Updated on every sync for existing rows. Empty if no value. |
| H | `avg_strong_score` | Decimal (1 place) or empty | Company metric | Average score of strong offers | No (will be overwritten) | Updated on every sync for existing rows. Empty if no value. |
| I | `top_category` | String or empty | Company metric | Human-readable category label for the top offer | No (will be overwritten) | Updated on every sync for existing rows. Empty if no value. |
| J | `last_strong_at` | Date string `YYYY-MM-DD` or empty | Company metric | Date of most recent strong offer | No (will be overwritten) | Updated on every sync for existing rows. Empty if no value. |

Notes:
- Any columns **beyond J** are never modified by the system and are safe for client notes.
- Numeric values for `max_score` and `avg_strong_score` are sent with one decimal place.
- Empty cells indicate the metric is not present (for example, before aggregation has run).

---

## 2) Internal Metrics → Sheets Columns (Mapping Table)

| Internal Metric / Concept | Sheets Column |
| --- | --- |
| Company ID | `company_id` (Column A) |
| Company display name | `company_name` (Column B) |
| Client resolution | `resolution` (Column C) |
| `max_score` | `max_score` (Column D) |
| `strong_offer_count` | `strong_offers` (Column E) |
| `unique_offer_count` | `unique_offers` (Column F) |
| `offer_count` | `posting_activity` (Column G) |
| `avg_strong_score` | `avg_strong_score` (Column H) |
| `top_category_id` (resolved to label) | `top_category` (Column I) |
| `last_strong_at` | `last_strong_at` (Column J) |

---

## 3) Update Behavior Rules

### Columns Never Modified by the System
- `company_id`
- `company_name`
- `resolution`
- Any columns beyond J (extra client columns)

### Columns Updated on Every Sync
- `max_score`, `strong_offers`, `unique_offers`, `posting_activity`, `avg_strong_score`, `top_category`, `last_strong_at`

### Append-Only Behavior
- New companies are appended as new rows.
- Existing company rows are **not re-appended**. Only metric columns are refreshed.

### Columns Controlled 100% by the Client
- `resolution` is treated as client feedback. The system reads it and never overwrites it.

### How the “resolution” Column Behaves
- When a company is first appended, resolution is set to `PENDING`.
- The system **never** overwrites resolution after that.
- Resolution is the **single source of truth** for client feedback.
- The system reads resolution values and applies them to company lifecycle decisions (see next section).

Important operational note for feedback:
- The feedback reader **only reads column A (company_id) and column B (resolution)**. If resolution values are placed in a different column or columns are rearranged, feedback will not be processed.

---

## 4) Lifecycle Explanation (Client Perspective)

When you change `resolution`, the system interprets it as follows:

### Resolved States (Trigger Actions)
- `ACCEPTED`, `REJECTED`, `ALREADY_REVOLUT`

If a company is moved into any of these states:
- All offers for that company are deleted.
- Future offers from that company are ignored.
- All company metrics remain preserved and are **not** modified.

### Active States (Informational Only)
- `PENDING`, `IN_PROGRESS`, `HIGH_INTEREST`

Changes between these states:
- Do **not** trigger offer deletion.
- Do **not** change metrics.
- Only update the company’s resolution.

### Reversal (Resolved → Active)
- If a resolved company is moved back to an active state:
  - The resolution is updated.
  - Previously deleted offers are **not** restored.
  - Future offers can be ingested again.

### Timing
- Resolution processing only runs during the nightly feedback window:
  - **03:00–06:00 Europe/Madrid (start inclusive, end exclusive)**
- Changes made outside this window are applied the next time the window is open.

---

## 5) Example Rows (What Each Cell Means)

### Example 1 – Normal Company (Active, moderate signals)
| Column | Value | Meaning |
| --- | --- | --- |
| A | `101` | Unique company ID in the system |
| B | `Acme Growth SL` | Display name shown to the client |
| C | `PENDING` | Default resolution (no client decision yet) |
| D | `5.0` | Highest offer score is 5.0 |
| E | `0` | No strong offers (score < 6) |
| F | `2` | Two unique canonical offers |
| G | `2` | Two postings total (no reposts) |
| H | `` | No strong offers → average is empty |
| I | `Advertising Platforms` | Top category label for the highest-scoring offer |
| J | `` | No strong offers → no last strong date |

### Example 2 – High Interest Company
| Column | Value | Meaning |
| --- | --- | --- |
| A | `205` | Unique company ID |
| B | `Global Payments Co` | Company name |
| C | `HIGH_INTEREST` | Client indicates strong interest (active state) |
| D | `8.5` | Highest offer score is 8.5 |
| E | `3` | Three strong offers (score ≥ 6) |
| F | `4` | Four unique canonical offers |
| G | `6` | Posting activity includes reposts |
| H | `7.4` | Average score of strong offers |
| I | `Global Payments` | Top category label |
| J | `2026-02-01` | Most recent strong offer date |

### Example 3 – Resolved Company
| Column | Value | Meaning |
| --- | --- | --- |
| A | `309` | Unique company ID |
| B | `Already Revolut LTD` | Company name |
| C | `ALREADY_REVOLUT` | Client marks as resolved |
| D | `9.0` | Last known max score (preserved) |
| E | `2` | Strong-offer count (preserved) |
| F | `5` | Unique offers count (preserved) |
| G | `7` | Posting activity (preserved) |
| H | `8.2` | Average strong score (preserved) |
| I | `Cloud Infrastructure` | Top category (preserved) |
| J | `2026-01-20` | Last strong date (preserved) |

### Example 4 – Company With No Strong Offers
| Column | Value | Meaning |
| --- | --- | --- |
| A | `412` | Unique company ID |
| B | `Local Services SL` | Company name |
| C | `IN_PROGRESS` | Client actively reviewing |
| D | `4.0` | Highest offer score is 4.0 |
| E | `0` | No strong offers |
| F | `1` | One unique canonical offer |
| G | `1` | One posting |
| H | `` | No strong offers → average is empty |
| I | `Cloud Infrastructure` | Top category label |
| J | `` | No strong offers → no last strong date |

---

## 6) Edge Cases Visible to the Client

### Duplicate Company Rows
- If the same `company_id` appears multiple times, only the **first** row is used for feedback processing.
- Duplicate rows are ignored by the system.

### Invalid Resolution Values
- Resolution must be one of: `PENDING`, `IN_PROGRESS`, `HIGH_INTEREST`, `ALREADY_REVOLUT`, `ACCEPTED`, `REJECTED`.
- Invalid values cause the row to be ignored for feedback processing.

### Unknown Company IDs
- If a row contains a `company_id` that does not exist in the system, it is ignored for feedback processing.

### Editing Non-Editable Columns
- Editing `company_id` breaks the row’s link to the system and may cause it to be ignored or treated as unknown.
- Editing metric columns (D–J) will be overwritten on the next sync.
- Editing `company_name` will not be overwritten by the system, but the internal system does not use the edited name.

### Timing (Feedback Window)
- Resolution changes are only applied during **03:00–06:00 Europe/Madrid**.
- Outside that window, changes remain in the sheet but are not processed until the next window.

---

## 7) Guarantees

The system guarantees the following behaviors:
- Resolution changes **never** modify company metrics.
- When a company is resolved, **only offers are deleted**; metrics are preserved.
- The `resolution` column is **never overwritten** by the system.
- Metric updates are deterministic and based on the latest available aggregation at sync time.
- Only the metric columns (D–J) are updated on sync; all other columns are preserved.

---

## 8) Appendix: Full catalog.json

```json
{
  "version": "1.0.0",
  "categories": [
    {
      "id": "cat_cloud_infra",
      "name": "Cloud Infrastructure",
      "tier": 3
    },
    {
      "id": "cat_ads_platforms",
      "name": "Advertising Platforms",
      "tier": 3
    },
    {
      "id": "cat_payments",
      "name": "Global Payments",
      "tier": 3
    },
    {
      "id": "cat_crm",
      "name": "CRM & Marketing Automation",
      "tier": 2
    },
    {
      "id": "cat_analytics",
      "name": "Data & Analytics",
      "tier": 2
    },
    {
      "id": "cat_collaboration",
      "name": "Collaboration Tools",
      "tier": 1
    }
  ],
  "keywords": [
    {
      "id": "kw_aws",
      "categoryId": "cat_cloud_infra",
      "canonical": "AWS",
      "aliases": ["aws", "amazon web services", "ec2", "s3", "lambda"]
    },
    {
      "id": "kw_gcp",
      "categoryId": "cat_cloud_infra",
      "canonical": "GCP",
      "aliases": ["gcp", "google cloud", "google cloud platform"]
    },
    {
      "id": "kw_azure",
      "categoryId": "cat_cloud_infra",
      "canonical": "Azure",
      "aliases": ["azure", "microsoft azure"]
    },
    {
      "id": "kw_google_ads",
      "categoryId": "cat_ads_platforms",
      "canonical": "Google Ads",
      "aliases": ["google ads", "adwords", "google adwords"]
    },
    {
      "id": "kw_meta_ads",
      "categoryId": "cat_ads_platforms",
      "canonical": "Meta Ads",
      "aliases": ["meta ads", "facebook ads", "instagram ads"]
    },
    {
      "id": "kw_tiktok_ads",
      "categoryId": "cat_ads_platforms",
      "canonical": "TikTok Ads",
      "aliases": ["tiktok ads", "tiktok for business"]
    },
    {
      "id": "kw_stripe",
      "categoryId": "cat_payments",
      "canonical": "Stripe",
      "aliases": ["stripe", "stripe payments"]
    },
    {
      "id": "kw_adyen",
      "categoryId": "cat_payments",
      "canonical": "Adyen",
      "aliases": ["adyen"]
    },
    {
      "id": "kw_paypal",
      "categoryId": "cat_payments",
      "canonical": "PayPal",
      "aliases": ["paypal", "braintree"]
    },
    {
      "id": "kw_salesforce",
      "categoryId": "cat_crm",
      "canonical": "Salesforce",
      "aliases": ["salesforce", "sfdc"]
    },
    {
      "id": "kw_hubspot",
      "categoryId": "cat_crm",
      "canonical": "HubSpot",
      "aliases": ["hubspot"]
    },
    {
      "id": "kw_tableau",
      "categoryId": "cat_analytics",
      "canonical": "Tableau",
      "aliases": ["tableau"]
    },
    {
      "id": "kw_powerbi",
      "categoryId": "cat_analytics",
      "canonical": "Power BI",
      "aliases": ["power bi", "powerbi"]
    },
    {
      "id": "kw_slack",
      "categoryId": "cat_collaboration",
      "canonical": "Slack",
      "aliases": ["slack"]
    },
    {
      "id": "kw_jira",
      "categoryId": "cat_collaboration",
      "canonical": "Jira",
      "aliases": ["jira", "atlassian jira"]
    }
  ],
  "phrases": [
    {
      "id": "phrase_usd",
      "phrase": "USD",
      "tier": 3
    },
    {
      "id": "phrase_multicurrency",
      "phrase": "multidivisa",
      "tier": 3
    },
    {
      "id": "phrase_international_payments",
      "phrase": "pagos internacionales",
      "tier": 3
    },
    {
      "id": "phrase_global_expansion",
      "phrase": "expansión internacional",
      "tier": 2
    },
    {
      "id": "phrase_forex",
      "phrase": "foreign exchange",
      "tier": 3
    }
  ]
}
```
