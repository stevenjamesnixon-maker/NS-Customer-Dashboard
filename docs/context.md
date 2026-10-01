# Customer Dashboard — project context

Canonical reference for this project. If this document and the repository disagree, **the
repository wins** — read the file and then fix this document in the same PR.

Scope of this document: the SuiteScript in this repo and the NetSuite configuration it depends
on. It does not describe the wider NetSuite account.

**Last updated:** 1 Oct 2026 (release 1.3, `feat/dashboard-r1-3`). **Status:** releases 1 and 1.1 passed their Production
tests on 30 Sep 2026; release 1.2 merged; release 1.3 not deployed.

**Versions:** every amendment to an open release PR bumps the patch version (1.3.1, 1.3.2…) of
every file it changes. Steve tells deployed copies apart by version.

**Design source:** `docs/design/canvas/` (read its README). Release 1.1 builds `Main`, `Mobile`,
`Delivery`, `ConfirmBacs`, `ConfirmCard` and `Email`. `Order` and `Update` are release 2.

---

## 0. Read this first

1. **This page is public.** The Suitelet is Available Without Login and runs as Administrator.
   The only thing between the internet and a customer's orders is the signed link and the
   ownership check. Section 5 lists the rules that keep it that way. Do not relax any of them.

2. **Parameter IDs differ between the two scripts.** A script parameter is a custom field, and
   custom field IDs are unique across the account, so the Map/Reduce cannot reuse the Suitelet's
   IDs. Its copies are prefixed `custscript_cdbmr_` and **must hold the same values** as their
   `custscript_cdb_` originals. Nothing in NetSuite links them. See section 4.

3. **No internal IDs in code.** Statuses, list values, employees and quote types come from
   parameters. The `SalesOrd:A/B/D/E` status codes are NetSuite's own and the same in every
   account; they are the one set of status values in the code.

4. **The dashboard never writes `custbody_del_date` or `custbody_finance_status`.** A person
   confirms the date after payment; a workflow runs from it. The customer's requested date goes
   in `custbody_defaultshipdate`.

5. **Field IDs are used exactly as they exist in the account.** `custbody_opp_site_adress` has
   one `d`. It is the real ID. Do not correct it.

6. **Upload the libraries before the scripts.** Both scripts fail at load time without them.

7. **Opportunity searches reject `mainline`.** The opportunity search type has no `mainline`
   filter (*"An nlobjSearchFilter contains invalid search criteria: mainline"*) and already
   returns one row per opportunity. Sales order searches accept it and keep it. Found in
   Production on the first TEST digest run, fixed in 1.0.1.

8. **The quote description is read via the `createdFrom` join.** `custbody_quote_description` is
   confirmed on the **Estimate** only. The sales order searches read it as
   `{ name: 'custbody_quote_description', join: 'createdFrom' }` — the order's originating quote.
   **Never add it as an unjoined sales order column**: if the field does not apply to sales
   orders, an unjoined column can make the whole search throw.

9. **`getField` before writing optional fields.** `custbody_cdb_awaiting_payment` and
   `custbody_edd_certainty` are written only when `so.getField({ fieldId })` finds them on the
   loaded record; otherwise `CDB FIELD_MISSING` and the booking goes ahead. A missing optional
   field must never cost the customer their booking.

10. **`custbodycustbody_sys_bal_incvat` has a doubled prefix on purpose.** It is the real field ID
    in the account (the balance including VAT). Do not "fix" it: the corrected ID does not exist
    and the amount would silently disappear.

11. **New sales order columns go in the extras search, never in the main searches.**
    `getOrderExtras()` is a separate, fail-safe search (section 4). A custom field that does not
    apply to sales orders makes a search throw; in the extras search that costs amounts and split
    references, in a main search it would cost the whole page.

12. **The released exception is the dashboard's only.** An order whose Record Status is in
    `custscript_cdb_released_statuses` counts as open although that status is also in the excluded
    list (section 4). NS-Opportunity-SO-Sync's excluded list is **unchanged** and still means "don't
    evaluate readiness". Do not "tidy" the two lists into one.

---

## 1. What this solves

Customers ask their account manager where their order is, and delivery is arranged over the
phone. The dashboard gives each customer a stable, signed link to a page that shows their
projects by stage — to order, in design, for delivery — and lets them arrange delivery for an
order that is ready to ship: date, time, address, vehicle, unloading, contact on site, special
requests, and how they will pay. The request lands on the sales order and as a Task for the
account manager (or PE), who confirms the date once payment is in.

A Map/Reduce emails each customer with something open a digest of the same information every
14 days, with one button to the page.

---

## 2. Components and versions

> **Indicative.** Read the `VERSION` constant and the JSDoc `@version` header in the file to
> confirm. The two are kept in step with each other and with this table.

| Component | Version | File | Purpose | Status |
|---|---|---|---|---|
| Dashboard Suitelet | 1.3.1 | `cdb_sl_dashboard.js` | Available Without Login: dashboard, delivery form, POST, confirmations | Not deployed |
| Digest Map/Reduce | 1.3.1 | `cdb_mr_digest.js` | The 14-day digest email | Not deployed |
| Config library | 1.3.0 | `lib/cdb_lib_config.js` | Every script, field and parameter ID; what empty means; the `CDB ` log prefix | Not deployed |
| Token library | 1.0.0 | `lib/cdb_lib_token.js` | Sign and verify the link; `buildLink(customerId)` | Not deployed |
| Dates library | 1.0.0 | `lib/cdb_lib_dates.js` | Pure: working days, earliest date, window, calendar, London today | Not deployed |
| Data library | 1.3.1 | `lib/cdb_lib_data.js` | Reads: customer → opportunities → orders, grouping, the guard, validation | Not deployed |
| Render library | 1.3.0 | `lib/cdb_lib_render.js` | Pure HTML from the canvas: page, sections, form, confirmations, email | Not deployed |
| Task library | 1.2.0 | `lib/cdb_lib_task.js` | The Task for the AM/PE | Not deployed |

All paths are relative to `src/FileCabinet/SuiteScripts/NuHeat/Customer Dashboard/`.

---

## 3. Environments — environment-agnostic policy

**This repo represents no single environment.** The same files deploy unchanged to Sandbox and
Production.

| Committable | Never committable |
|---|---|
| Script IDs — `custbody_*`, `custentity_*`, `custrecord_*`, `customrecord_*`, `customlist_*`, `customscript_*`, `customdeploy_*`, `custscript_*`, `custsecret_*` | Internal IDs — list option IDs, status IDs, employee IDs, quote type record IDs, customer IDs |
| NetSuite's standard status codes (`SalesOrd:B`) and text values (`NOTSTART`, `HIGH`) | Account numbers, account-specific URLs, bank details |

Everything variable is a script parameter set on the deployment, so each account carries its
own values. The bank details are parameters too: they are not secret, but they are not code.

---

## 4. Architecture — the agreed design

### The link

```
payload = c<customerId>.v<version>
token   = base64url(payload) + '.' + base64url(HMAC-SHA256(payload))
url     = url.resolveScript({ scriptId: 'customscript_cdb_sl_dashboard',
                              deploymentId: 'customdeploy_cdb_sl_dashboard',
                              returnExternalUrl: true, params: { t: token } })
```

- **Stable, no expiry.** `version` is `custentity_cdb_link_version`, empty = 0. Incrementing it
  revokes every link that customer has.
- **The key** is the API Secret `custsecret_cdb_link_key`, through `N/crypto`:
  `createSecretKey({ secret, encoding: UTF_8 })` → `createHmac({ algorithm: HashAlg.SHA256, key })`
  → `update({ input, inputEncoding: UTF_8 })` → `digest({ outputEncoding: BASE_64 })`.
  `encoding` on `createSecretKey` says how the secret's clear text is read; it defaults to HEX,
  and UTF_8 lets the secret be any random string.
- **Verify** checks, in order: shape, payload, HMAC (constant-time compare), the customer exists,
  is not inactive, and its version matches. Any failure shows **one** page — *"This link is no
  longer valid. Please contact your account manager"* — and logs `CDB INVALID_LINK` at audit with
  the reason.
- `buildLink(customerId)` is exported for the digest and future email templates.

### Stages (`cdb_lib_data.groupProjects`, pure)

Opportunities where `entity` = the customer and `entitystatus` is not Lost.

| Section | Rule | Row |
|---|---|---|
| Projects to order | status not Won (and not Lost) | Title, site address, *Quote sent*. No actions in R1 |
| Projects in design | Won, sub-status in the design list | Title, address, *We need information* (sub-status in the needs-info list) or *Designing your system*. No actions in R1 |
| Projects for delivery | Won, sub-status in the delivery list, at least one **open** order | The opportunity, then one row per open order |

A Won opportunity at any other sub-status (Delivery complete, say) is not shown. Empty sections
are hidden.

### What "open" means for a sales order — one definition, everywhere

1. A linked opportunity: the sales order's native `opportunity` field is set. Not `createdfrom`.
   (The sales order search filters `mainline = T`; the opportunity searches must not — §0, 7.)
2. **Native status** in `SalesOrd:A` Pending Approval, `SalesOrd:B` Pending Fulfillment,
   `SalesOrd:D` Partially Fulfilled, `SalesOrd:E` Pending Billing/Partially Fulfilled (addendum
   of 30 Sep). Fully fulfilled, billed, closed and cancelled orders (F, G, H, C) are never shown or
   offered. **These match the input filter of `opsync_mr_readiness.js` in NS-Opportunity-SO-Sync
   (PR #8).** They are applied as a *search filter*; a result's `status` column does not return
   these codes, so never compare a column value against them.
3. **Record Status** `custbody_finance_status` blank or not in `custscript_cdb_excluded_statuses`
   — the same rule as the sync (brief C10).
4. **Quote type** `custbody_quote_type` not in `custscript_cdb_excluded_quote_types` (Parts, FOC).
   A blank quote type is not excluded.

1 and 2 are in the search (`openOrderFilters()`); 3 and 4 are in `isOpenOrder()`.

### The fail-safe extras search (1.2)

`getOrderExtras(orderIds)` is **one** sales order search, run **once per request** for every order
already on the page (`mainline T`, `internalid anyof`), reading `terms`, `custbody_unique_so_ref`,
`custbodycustbody_sys_bal_incvat`, `total` and `custbody_deposit_total`. **The main order searches
never gain these columns.** It exists because a custom field that does not apply to sales orders
makes a search throw: here that is caught, logged once as `CDB EXTRAS_FAILED`, and `{}` comes back —
the page renders as in 1.1, with no amount, no split reference and **every order treated as pay up
front**.

### Amount to pay (1.2)

`amountToPay(extras)` (pure): `balance` when set (0 is real) → basis `balance`; else `total −
(deposit || 0)` → basis `total_less_deposit`; else `null`. A negative result is `null` and logs
`CDB AMOUNT_ODD`. Shown as `£1,234.50` (`render.formatMoney`), or *Nothing left to pay on this order*
at 0, and left out entirely when `null`. **Steve's rule: the amount is always shown when a delivery is
being arranged** (PR #3 amendment 1). It is shown to **every** customer, whatever the terms, in:

- section 6 and the aside of the form (an account customer also gets the hint *"Only if you're
  paying by bank transfer. Choose 'Add to my account' and nothing is due now."*);
- the bank panel of the BACS confirmation;
- the card confirmation;
- the *Payment details* panel of an order awaiting payment;
- the Task, whenever the choice is BACS or Card.

**An Add-to-account booking shows no amount anywhere** and does not tick *Awaiting customer
payment*; a BACS or Card booking ticks it, whatever the terms. **The digest shows no amounts.**

**The card wording names nobody**: *"We'll call you to take £x. We never ask for card details
online."* (or *"We'll call you to take payment."* with no amount). Whoever gets the Task makes the
call, and on a PE-case opportunity that is not the rep in the header.

### Pay up front or add to account (1.2)

`isPrepay(customerTermsId, extras, cfg)` (amendment 2): **the customer and the order must both say
account.** A sales order copies the customer's terms when it is created and keeps them, so a
customer moved off credit terms (customer 215781, 1 Oct 2026) would otherwise still be offered *Add
to my account* on old orders. The customer's current terms come from `terms` in `getCustomer()`'s
`lookupFields` (a standard field).

| Customer `terms` | Order `terms` | Result |
|---|---|---|
| In `custscript_cdb_prepay_terms` | anything | pay up front |
| Blank | anything | pay up front (fail closed) |
| Credit (not in the list) | In the list | pay up front (staff made this order pay up front) |
| Credit | Credit or blank | **account** |

On top of the table: an empty `custscript_cdb_pay_account` or `custscript_cdb_prepay_terms`, or a
failed extras search, means pay up front. Every doubt means pay up front, which offers less. The
server-side check of the posted choice uses the same rule, and `CDB SO_UPDATED` and
`CDB TASK_CREATED` record both term IDs (*terms: customer X, order Y -> account*). Pay up front is offered **BACS or Card**; an
account order **BACS or Add to my account**. The server checks the choice against the order: a
tampered `CARD` from an account order or `ACCOUNT` from a pay-up-front one is a field error and
nothing is written. An account booking writes the account intent, **does not tick** *Awaiting
customer payment*, and writes EDD certainty as usual. Its state is **`requested`** (badge *Delivery
requested*, `b-work`), on the dashboard and in the email.

### Released orders stay visible (1.3)

Steve, 1 Oct 2026: when payment arrives, staff set the Record Status to **Release to Warehouse**
("Delivery arranged, awaiting shipment"). That status is in the excluded list, so the moment a
customer paid, their order vanished from the dashboard. `custscript_cdb_released_statuses` (and its
twin) names the statuses that stay **open although excluded**; every other rule of "open" still
applies (opportunity link, native A/B/D/E, quote type). It is applied in `isOpenOrder()` and in
`recordStatusFilter()` — the digest's input search, the only search that filters Record Status
(the main searches decide it in `isOpenOrder()`). Empty keeps released orders hidden. A released
order is shown but **never bookable**: the guard refuses it (`order is released…`). **This exception
is the dashboard's only**: the readiness sync's excluded list is unchanged.

### Recently delivered (1.3)

`getRecentlyDelivered()`, one more search per page: sales orders on **the customer's opportunities**
(`opportunity anyof` the IDs `getProjects()` already loaded — the same rule as every other section,
not the order's own `entity`; 1.3.1), native **F or G** (fully fulfilled), quote type not excluded, and a delivery date in the
last `custscript_cdb_recent_days` days (default 7) up to today (UK). The **delivery date** is
`custbody_del_date` if set, otherwise `custbody_defaultshipdate` (`deliveryDateKey()`); the search
ORs the two and `groupRecent()` decides each row; neither date → not shown. **No opportunities → no
search and no section.** It **does not apply the
excluded list** — shipped orders usually carry a completed Record Status — only
`custscript_cdb_recent_hidden_statuses` (the account's test statuses). Its order IDs join the one
extras call (`decorateAll()`), after grouping, so only rows that will be shown are read. The section *Recently delivered* (*Delivered in the last N days*)
comes last, grouped by project, badge *Delivered*, *Delivered {date}*, no actions, no amounts, and
is left out when empty; it counts against "nothing to show" on the page, **but not for the digest**:
recent deliveries alone send no email. In a digest that is sent it is a group at the end, outside the
callout. A failure logs `CDB RECENT_FAILED` and the page or digest carries on without it.

### Order row states, first match wins

1. `custbody_del_date` set → **Delivery booked**, with that date.
2. (1.3) Record Status in `custscript_cdb_released_statuses` → **Being prepared** (`b-ready`),
   *We're preparing your delivery for {ship date, time}* (or without the date), nothing needed, and
   **no payment panel** even if *Awaiting customer payment* is ticked.
3. (1.2) `custbody_cust_pay_intent` = `custscript_cdb_pay_account` → **Delivery requested**,
   *Requested <ship date>, <time>*, no payment panel.
4. `custbody_cust_pay_intent` set (otherwise) → **Awaiting payment**, *Requested <ship date>, <time>*, and a
   *Payment details* disclosure: the bank panel for BACS, *your account manager will call* for Card.
5. `custbody_ready_for_delivery` ticked → **Ready to deliver**, yellow **Arrange delivery**.
6. Otherwise → **Needs information**, `custbody_delivery_hold_reason`, *Your account manager will
   be in touch*.

**1.2:** the description is shown **in full** (no clamp, no tooltip). Under it, when set,
`custbody_unique_so_ref` (cleaned like the description, medium weight, text colour: it says what this
part of a split order contains), then the muted *Order SO… · UFH*. The short label comes from
`custscript_cdb_quote_type_labels`, else the quote type's own text; it is not repeated when the
main line already fell back to it. The paragraph below describes 1.1.

The row's main line is the **quote description** (`custbody_quote_description` on the originating
quote, through the `createdFrom` join — §0, 8), clamped to two lines with the full text in `title`,
and under it, muted, *Order SO… · <quote type>*. An empty description falls back to the quote type,
and both empty to *Your order* (`render.orderTitle()`, the one definition). The description is
cleaned as Send Quote does — decode entities (named, `&#nnn;`, `&#xhh;`) → strip tags → collapse
whitespace — in `data.cleanDescription()`, and escaped once when rendered. Decode before stripping,
never after.

### The account manager (brief C6)

`resolveRecipient(opp)`: `custbody_pe` when `custbody_value_proposition` is in
`custscript_cdb_pe_valueprops` **and** the PE is set; otherwise `salesrep`; otherwise the fallback
employee. **The Task goes to that employee** — per opportunity, unchanged in 1.2.

**The person the customer sees is a different rule (1.2).** The page header and footer, the
delivery form and the confirmations show the **customer's own sales rep** (`customer.salesrep`), or
the fallback employee when the rep is empty or inactive (`customerManager()` in the Suitelet). That
is the same person the digest sends from, so the email and the page agree. `headerOpportunity()`
is no longer used for the header.

**How to reach them (amendment 2), `render.contactParts()` / `questionsLine()`:** a phone gives
*"Questions? Call {name} on {phone}"* (`tel:`); no phone but an email gives *"Questions? Email {name}
at {email}"* (`mailto:`); neither gives *"Questions? Contact {name}"*; no name leaves the line out.
The page footer, the delivery header and the main header (*name · phone*, else *name · email*) all
use it, and on phones the round button calls or, with no phone, emails. The email's opt-out
sentence uses the same rule (*"…or call / email / contact {name}"*); its AM block shows the phone,
the email, or both when both exist. So a customer whose rep is A, with a PE-case opportunity whose PE
is B, sees A on every page, and the Task still goes to B.

### The delivery form and the guard

`GET ?t=&a=delivery&so=` and the POST both run `guardOrder(customerId, soId)` first. The customer
ID is the **token's**; the order ID is the request's. The guard refuses unless:

- the order is found by the open-order search (rules 1 and 2 above);
- the order's opportunity's `entity` is **this** customer;
- rules 3 and 4 hold;
- `custbody_del_date` is empty;
- `custbody_cust_pay_intent` is empty — otherwise *"already requested"*;
- `custbody_ready_for_delivery` is ticked.

A refusal shows the dashboard with a short notice and logs `CDB GUARD_REFUSED` with the reason.

**Fields.** Date: a **server-rendered month calendar** (the brief's preferred option), every day of
the window with the allowed ones as radio buttons. Time, vehicle, unloading: the parameter lists, in
parameter order, with names read from the custom lists. Address: the customer's address book lines,
value = line internal ID, defaulting to the order's `shipaddresslist`. Contact: prefilled from the
order. Special requests: up to 1,000 characters. Payment: BACS or Card.

**Allowed dates** (`cdb_lib_dates.js`, pure, node-tested). Today is Europe/London's today. A working
day is Monday to Friday and not a `customrecord_cdb_nondelivery` date. With notice N, the next N
working days after today are skipped and the first allowed date is the working day after them —
Tue 29 Sep 2026, N = 3 → Mon 5 Oct. Allowed dates are working days from there to today + 6 months,
inclusive.

### The POST

1. The guard again; then server-side validation of every value (allowed date; each list ID in its
   parameter list; the address line on this customer; name and phone required; email optional and
   email-shaped; lengths). On failure the form re-renders with the input kept and the error beside
   the field. `CDB FORM_REJECTED`.
2. `record.load` the order (standard mode), re-check `custbody_del_date` and
   `custbody_cust_pay_intent` on the loaded record, then set:
   `custbody_defaultshipdate`, `custbody_del_time_per`, `shipaddresslist`, `custbody_delivery_veh`,
   `custbody_unload_req`, `custbody_del_contact`, `custbody_delivery_con_num`,
   `custbody_delivery_con_email`, `custbody_special_requests`, `custbody_cust_pay_intent`,
   `custbody_cust_booking_req` (now), and from 1.1, each only if `getField` finds it (§0, 9):
   `custbody_cdb_awaiting_payment` = true (*Awaiting customer payment*) and `custbody_edd_certainty`
   = `custscript_cdb_edd_definite_value` (*EDD certainty*; not written, `CDB EDD_SKIPPED`, when the
   parameter is empty). Save with `ignoreMandatoryFields`. `CDB SO_UPDATED` logs every
   field old → new.
3. **After** the save, the Task: title `Delivery requested: <tranid> – <customer>`, `assigned` per
   C6, `company` = customer, `transaction` = the **opportunity**, `message` = the changed fields old
   → new plus payment and special requests, status `NOTSTART`, priority `HIGH`, due today,
   `sendemail` true. If it fails the order change stands, `CDB TASK_FAILED` is logged at ERROR and
   the customer still sees the confirmation.
4. Confirmation. BACS: bank name, sort code, account, **reference = the SO `tranid`** highlighted,
   *we'll book your delivery once payment reaches us*, no amount. Card: *Your account manager,
   <name>, will call you to take payment. We never ask for card details online.* Both: *Back to your
   projects*.

Refreshing or resubmitting is safe: the guard fails once `custbody_cust_pay_intent` is set.

### The digest (`cdb_mr_digest.js`)

- **TEST:** exactly `custscript_cdb_digest_test_customers`, whatever else applies (no opt-out,
  last-digest or cap check).
- **LIVE:** active customers, not opted out, `custentity_cdb_last_digest` empty or at least
  `digest_days` ago, with an email or a dashboard contact, **and** an open opportunity (not Lost;
  not Won, or Won at a design or delivery sub-status) **or** an open order (all four rules; grouped
  by the order's own `entity`). Never-sent first, then oldest; `digest_cap` per run; the rest are
  logged and wait for the next run.
- **Per customer:** recipient = the dashboard contact's email, else the customer's `email`; author
  = the customer's `salesrep` if active, else the fallback employee; the same sections as the page,
  one line each with a badge and what's needed, a banner when any order is ready; one button
  **VIEW YOUR PROJECTS**; the AM card (the author); the footer *You get this update every <n> days
  … To stop these updates, reply to this email.* `email.send` with `relatedRecords.entityId`, then
  `custentity_cdb_last_digest` = today.
- **Skips** — not found, inactive, no recipient email, nothing to show — log `CDB DIGEST_SKIPPED`.

### Parameters — IDs per script

**A missing parameter whose empty value would remove a restriction throws.** `load()` throws once
and names every missing parameter.

| Parameter (Suitelet) | Map/Reduce twin | Type | Empty means |
|---|---|---|---|
| `custscript_cdb_won_statuses` | `custscript_cdbmr_won_statuses` | Text, comma list of `entitystatus` IDs | throw |
| `custscript_cdb_lost_statuses` | `custscript_cdbmr_lost_statuses` | Text, comma list | throw |
| `custscript_cdb_design_substatus` | `custscript_cdbmr_design_substatus` | Text — brief default `1,4,5,13` | throw |
| `custscript_cdb_needinfo_substatus` | `custscript_cdbmr_needinfo_substatus` | Text — brief default `1` (Awaiting Design Info). **Not in the brief**, see section 10 | throw |
| `custscript_cdb_delivery_substatus` | `custscript_cdbmr_delivery_substatus` | Text — brief default `8,11` | throw |
| `custscript_cdb_excluded_statuses` | `custscript_cdbmr_excluded_statuses` | Text. **The twin of the sync's `custscript_opsync_excluded_statuses`** — the same Record Statuses | throw |
| `custscript_cdb_excluded_quote_types` | `custscript_cdbmr_excluded_quote_types` | Text: `customrecord16` IDs for Parts and FOC | throw — empty would show Parts/FOC orders to customers |
| `custscript_cdb_pay_bacs` | `custscript_cdbmr_pay_bacs` | Integer: `customlist_cust_pay_intent` ID | throw |
| `custscript_cdb_pay_card` | `custscript_cdbmr_pay_card` | Integer | throw |
| `custscript_cdb_fallback_employee` | `custscript_cdbmr_fallback_employee` | Employee | throw |
| `custscript_cdb_logo_url` | `custscript_cdbmr_logo_url` | Text, https only | no logo; audit |
| `custscript_cdb_time_values` | — | Text: `customlist_del_time_per` IDs in display order (`2,5,3`) | throw |
| `custscript_cdb_vehicle_values` | — | Text (`1,2,3,4,5,6`; never *Nu-Heat to deliver*) | throw |
| `custscript_cdb_unload_values` | — | Text (`1,2,3`) | throw |
| `custscript_cdb_pe_valueprops` | — | Text (`2,3`) | none: always the sales rep; audit |
| `custscript_cdb_notice_days` | — | Integer | 3; audit |
| `custscript_cdb_bank_name`, `_bank_sort`, `_bank_account` | — | Text | throw |
| `custscript_cdb_option_hints` (1.1) | — | Long Text: JSON `{"vehicle": {"<id>": "<hint>"}, "unload": {"<id>": "<hint>"}}` | no hints; invalid JSON also logs `CDB OPTION_HINTS_INVALID` once per request. Never fails the page |
| `custscript_cdb_released_statuses` (1.3) | `custscript_cdbmr_released_statuses` | Free-Form Text: Record Status IDs that stay open although excluded | released orders stay hidden (fails closed) |
| `custscript_cdb_recent_days` (1.3) | `custscript_cdbmr_recent_days` | Integer: days of *Recently delivered* | 7 |
| `custscript_cdb_recent_hidden_statuses` (1.3) | `custscript_cdbmr_recent_hidden_statuses` | Free-Form Text: Record Statuses never shown in *Recently delivered* | hide none |
| `custscript_cdb_prepay_terms` (1.2) | — (nothing in the digest reads it) | Free-Form Text: comma list of `terms` IDs that pay up front | everyone pays up front |
| `custscript_cdb_pay_account` (1.2) | `custscript_cdbmr_pay_account` | Integer: the `customlist_cust_pay_intent` ID of *Add to account* | the account option is never offered; everyone pays up front |
| `custscript_cdb_quote_type_labels` (1.2) | `custscript_cdbmr_quote_type_labels` | Long Text: JSON `{"<quote type id>": "UFH"}` | each quote type's own text; invalid JSON also logs `CDB TYPE_LABELS_INVALID` once. Never fails the page |
| `custscript_cdb_edd_definite_value` (1.1) | — | Integer: the `customlist955` ID for *Customer Definite* | EDD certainty not written; `CDB EDD_SKIPPED` per booking |
| — | `custscript_cdb_digest_mode` | `TEST` \| `LIVE` | throw |
| — | `custscript_cdb_digest_test_customers` | Text, comma list of customer IDs | throw when the mode is TEST |
| — | `custscript_cdb_digest_days` | Integer | 14; audit |
| — | `custscript_cdb_digest_cap` | Integer | 200; audit |

The numeric defaults above are the values the brief gives for Production. **Read the IDs off each
account's lists before setting them**; they are not guaranteed to match between accounts.

---

## 5. Standing warnings and deliberate decisions

**Security — do not relax:**

- **No current user.** A no-login Suitelet runs as user −4. `runtime.getCurrentUser()` appears
  nowhere in this repo (a node test enforces it). Authors and assignees come from records and
  parameters.
- **The customer is the token's.** The customer ID is never read from a request parameter.
- **Ownership on every write.** The order ID comes from the request, so the guard checks that the
  order's opportunity belongs to the token's customer, on GET and again on POST, and the loaded
  record is re-checked before saving.
- **One generic invalid page.** Tampered, revoked, inactive, missing: the customer sees the same
  sentence, the log sees the reason.
- **Output is escaped.** Every value from a record or a request goes through `esc()`.
- **Almost nothing loads from a third-party host.** Inline CSS. From 1.1 the **pages** load Source
  Sans 3 from Google Fonts (the email does not); otherwise the only external resource is the logo
  from `custscript_cdb_logo_url`. The delivery form carries a small inline script (month switching,
  the live summary); the form works and submits without it.
- Responses carry `Cache-Control: no-store`, `X-Frame-Options: DENY`, `robots noindex` and
  `referrer no-referrer` so the token is not cached, framed, indexed or leaked in a Referer.

**Deliberate decisions — do not reverse without Steve:**

- **Stable links.** One link per customer, no expiry; revoke by incrementing the version.
- **The dashboard never writes the confirmed date or the status.** `custbody_del_date` and
  `custbody_finance_status` are never set. The customer's date goes in `custbody_defaultshipdate`.
- **No amount shown** in release 1.
- **Release 1 has no actions outside delivery.** Quotes and designs are shown, not actionable.
- **The earliest date follows the brief's example** (skip N working days, then the next working day),
  not its prose. See section 10.
- **The calendar is server-rendered** radio buttons, not a native date input. Without script every
  month renders stacked; with it, one month at a time. The server validates regardless.
- **`custbody_cdb_awaiting_payment` is only ever set true.** Staff release and bill the order and it
  stays ticked. Nothing in this repo may untick it; a node test scans the source for it.
- **EDD certainty is set to Customer Definite on every booking, whatever it was**: the customer has
  chosen a date. An empty parameter writes nothing (fails closed).
- **Canvas actions release 1.1 does not have are left out**: *Start a new project*, *Place order*,
  *Tell us where you're up to*, *Add design information*, *Provide information*, *Request design
  changes*, and *View quote* / *View design* (no URL is read). No button goes nowhere.

---

## 6. Known issues and limitations

- **Readiness is only as current as the sync keeps it.** The nightly refresh (brief C3) is
  NS-Opportunity-SO-Sync PR #8, **not merged** at the time of writing. Until it is deployed, an
  order's *ready* flag only refreshes when someone saves the opportunity or the order, so a stale
  *ready* can offer *Arrange delivery*.
- **Two POSTs at the same instant** could both pass the guard and create two Tasks. The window is
  the few hundred milliseconds between the guard's search and the save.
- **The option and payment cards highlight the chosen card with CSS `:has()`.** Browsers without it
  still show the checked radio and submit correctly. (The calendar and time segments use a sibling
  selector and need no `:has()`.)
- **A dashboard contact without an email** counts towards the LIVE cap and is then skipped, when
  the customer has no email either. The input search cannot read the contact's email.

---

## 7. Audit log keys

Every title starts `CDB `.

| Key | Level | Meaning | What to do |
|---|---|---|---|
| `CDB PARAMETER_MISSING` / `CONFIG_FAILED` | error | A required parameter is empty or invalid; the details name them | Set them on the deployment |
| `CDB PARAMETER_DEFAULT` | audit | A defaulted or none parameter is empty | Nothing, unless it should be set |
| `CDB INVALID_LINK` | audit | A link failed; the reason is in the details | A version bump or a customer made inactive is expected; a signature mismatch repeatedly from one customer is worth a look |
| `CDB GUARD_REFUSED` | audit | The guard refused an order | *another customer* means someone edited the URL |
| `CDB FORM_REJECTED` | audit | Validation failed; the errors are in the details | — |
| `CDB SO_UPDATED` | audit | The order was written; every field old → new | — |
| `CDB TASK_CREATED` | audit | The Task, its assignee and whether `sendemail` was set | — |
| `CDB TASK_FAILED` | error | The order was written but the Task was not | Create the Task by hand |
| `CDB LIST_VALUE_MISSING` | audit | A parameter ID is not in its list, so is not offered | Fix the parameter |
| `CDB REQUEST_FAILED` | error | Something of ours threw; the customer saw the error page | Read the stack |
| `CDB OPTION_HINTS_INVALID` | audit | `custscript_cdb_option_hints` is not valid JSON of the right shape; options show titles only | Fix the JSON |
| `CDB EDD_SKIPPED` | audit | `custscript_cdb_edd_definite_value` is empty, so EDD certainty was not written | Set the parameter |
| `CDB RECENT_FAILED` | audit | The 1.3 recently delivered search threw; the page or digest carries on without the section | Check the search in `getRecentlyDelivered()` |
| `CDB EXTRAS_FAILED` | audit | The 1.2 extras search threw; the page shows no amounts or split references and treats every order as pay up front | Check the field IDs in `getOrderExtras()` against the account |
| `CDB AMOUNT_ODD` | audit | An amount to pay came out negative, so it is not shown | Check the order's balance, total and deposit |
| `CDB TYPE_LABELS_INVALID` | audit | `custscript_cdb_quote_type_labels` (or its MR twin) is not a JSON object; each type shows its own text | Fix the JSON |
| `CDB FIELD_MISSING` | audit | An optional field is not on the loaded sales order; it was skipped and the booking went ahead | Check the field's Applies To and the form |
| `CDB USAGE` | audit | Remaining governance at the end of every request | Should stay well above 800 |
| `CDB DIGEST_INPUT` | audit | Mode, and in LIVE how many are due, sent and left over | — |
| `CDB DIGEST_SENT` / `DIGEST_SKIPPED` | audit | Per customer | — |
| `CDB DIGEST_FAILED` / `DIGEST_STAMP_FAILED` | error | Not sent / sent but not stamped (it will send again next LIVE run) | Stamp by hand if needed |
| `CDB DIGEST_SUMMARY` | audit | Counts per outcome | — |

---

## 8. Deployment sequence

Steve deploys. Manual File Cabinet upload to
`SuiteScripts/NuHeat/Customer Dashboard/`, keeping the `lib/` subfolder.

**Account objects checklist, in this order:**

1. **The fields.**
   - Customer: `custentity_cdb_link_version` (Integer; empty = 0), `custentity_cdb_dashboard_contact`
     (List/Record → Contact; empty = the customer's email), `custentity_cdb_digest_optout`
     (Checkbox), `custentity_cdb_last_digest` (Date).
   - Sales order (Steve has created these): `custbody_cust_pay_intent` → `customlist_cust_pay_intent`
     (BACS / Card, account manager to call), `custbody_cust_booking_req` (Date/Time).
   - Sales order, 1.1 (Steve has created it): `custbody_cdb_awaiting_payment` (Check Box). Also
     read-and-written: `custbody_edd_certainty` → `customlist955` (existing).
2. **The custom record** `customrecord_cdb_nondelivery` (*Non-delivery date*), field
   `custrecord_cdb_nd_date` (Date) plus its name. Add bank holidays and shutdowns for the next year.
3. **The API Secret** `custsecret_cdb_link_key`: a random value of at least 32 characters,
   restricted to `customscript_cdb_sl_dashboard` and `customscript_cdb_mr_digest` — **never** by
   employee.
4. **Upload the libs, then the scripts.** All six `lib/` files first; then `cdb_sl_dashboard.js`
   and `cdb_mr_digest.js`.
5. **The Suitelet** `customscript_cdb_sl_dashboard`, deployment `customdeploy_cdb_sl_dashboard`:
   Available Without Login, Execute As Administrator, Released, log level Audit. Define and set every
   `custscript_cdb_*` parameter in section 4.
6. **The Map/Reduce** `customscript_cdb_mr_digest`, deployment `customdeploy_cdb_mr_digest`: Not
   Scheduled, `custscript_cdb_digest_mode` = TEST, test customers set. Define every
   `custscript_cdbmr_*` twin **with the same value as its `custscript_cdb_*` original**.
7. **A run by hand** (Save and Execute). Check `CDB DIGEST_SUMMARY` and the test customer's
   Communication tab.
8. **Then schedule it daily**, and switch to LIVE when Steve says.

---

## 9. Testing

**Node** — `npm test`: dates (the B4 example exactly, a bank holiday, weekends, N = 0, the
six-month limit, London across BST changes), the token (payload, base64url, sign/verify and every
failure, crypto stubbed), stage grouping and order states from fixtures, the addendum's native
status rule (a Billed SO with a blank Record Status is not shown; a Pending Fulfillment SO is),
the C6 recipient, validation, configuration (every throw case), the rendered HTML (escaping, no
third-party URLs, no `display:none` in the email), house style (ES5, no current user, versions in
step), and the Suitelet and digest end to end against an in-memory stub.

**Sandbox / Production, digest in TEST mode:**

| # | Scenario | Expected |
|---|---|---|
| 1 | Open the link for a test customer with one of each (quote, in design, ready SO, not-ready SO) | Three sections; SO states correct; Parts/FOC SOs not shown |
| 2 | A tampered token; then the version bumped on the customer | The generic invalid page; `CDB INVALID_LINK` |
| 3 | Arrange delivery with a date before the first allowed date, or a weekend (edit the POST) | Rejected, form re-rendered with input kept |
| 4 | A valid booking, BACS | Each B5 field set; `custbody_del_date` and `custbody_finance_status` **unchanged**; Task to the right person; BACS confirmation with the SO number |
| 5 | The same SO: refresh / POST again | *Already requested*; no second Task |
| 6 | A Card booking on a PE-case opportunity | Task to the PE; card confirmation |
| 7 | An SO of another customer's opportunity in the URL | Refused; `CDB GUARD_REFUSED` *another customer* |
| 8 | Save the opportunity afterwards (Won, Design Complete) | `custbody_defaultshipdate` **not** overwritten (sync Phase 5). Repeat at *Partially delivered* — see section 10 |
| 9 | Digest, TEST mode | One email to the recipient, from the sales rep, on the Communication tab; the link works; last digest stamped |
| 10 | Clear the mode, or the test customers in TEST | Throws, naming the parameter; nothing sent |
| 11 | Clear `excluded_quote_types` | Throws, on the Suitelet (error page, `CDB PARAMETER_MISSING`) and in the digest |
| 12 | Governance | `CDB USAGE` after GET and POST, both well under 1,000 used |
| 13 | A **Billed** SO with a blank Record Status on a delivery-stage opportunity | Not shown; its delivery URL refused |
| 14 | A **Pending Fulfillment** SO | Shown |
| 15 | Mobile width; email with images and styles off | Usable; readable |

---

## 10. Open items

### Unverified in the account — check in Sandbox

| API | What the code assumes | Source |
|---|---|---|
| `crypto.createSecretKey({ secret, encoding })` | `secret` takes the API Secret's script ID; `encoding` UTF_8 reads it as text | Oracle help *crypto.createSecretKey(options)* (from its search summary — the page itself could not be fetched from this session) and the community typings. Not run |
| `createHmac` / `update` / `digest({ outputEncoding: BASE_64 })` | As written | Same |
| Task `sendemail` | A settable body field (*Notify Assignee by Email*) | Records Browser naming; set in a try/catch, logged in `CDB TASK_CREATED` |
| Task `transaction` = an opportunity | Accepted | Not verified |
| `shipaddresslist` set on a record loaded in standard mode | Selects the address book line; the ship address re-sources from it | Not verified. It may also re-source shipping and tax on the order |
| Address book sublist fields `id`, `label`, `addressbookaddress_text` | As named | Not verified; `internalid` is read as a fallback for `id` |
| POST to an Available Without Login Suitelet's external URL | Body fields arrive in `request.parameters` | Standard, not verified here |
| 1.1: `{ name: 'custbody_quote_description', join: 'createdFrom' }` on a sales order search | Returns the originating estimate's description; blank when the order was not created from an estimate (or was created from an opportunity) | Not verified. The node stub models it; the brief says the field is confirmed on the Estimate |
| 1.1: `record.getField({ fieldId })` on a record loaded in standard mode | Returns `null` for a field the record does not carry | Documented behaviour; not verified here |
| 1.1: `getText` on `custbody_edd_certainty` after `setValue` in standard mode | Returns the new option's text, for the change log | Falls back to `ID <n>` if not |
| Search type = a custom list's script ID (`customlist_del_time_per`), column `name` | Returns the options | Not verified |

### Contradictions in the brief — for Steve

1. **Parameters "on both scripts" cannot share IDs.** Custom field IDs are account-unique;
   NS-Opportunity-SO-Sync hit this. The Map/Reduce has `custscript_cdbmr_*` twins.
2. **The earliest date: prose vs example.** "The Nth working day after today" gives Fri 2 Oct for
   Tue 29 Sep, N = 3; the example gives Mon 5 Oct. The example is implemented and tested.
3. **The design badge needs sub-status 1, which cannot be committed.** Added
   `custscript_cdb_needinfo_substatus` (and its twin), throws when empty.
4. **Phase 5 protects by Record Status, not sub-status.** `custscript_opsync_no_shipdate_statuses`
   holds `custbody_finance_status` values (Design Complete, Redraw Required). *Partially delivered*
   (11) is in the delivery list and unmapped in the sync, so the sync copies
   `custbody_opp_del_date` over `custbody_defaultshipdate` unless the order's **own** Record Status
   is in that list. An order whose Record Status has moved past Design Complete without reaching an
   excluded status would lose the customer's date on the next opportunity save.
   (NS-Opportunity-SO-Sync PR #7, not merged, stops an *empty* opportunity date clearing it.)
5. **Brief C3's nightly refresh is PR #8, not merged**, and the addendum cites the same PR for the
   status codes. Section 6.
6. **The page header's AM uses C6, which is per opportunity**, while the digest's author and AM card
   use the customer's sales rep. A customer with a PE-case opportunity sees the PE on the page and
   the rep in the email.
7. **"One row per project" in the digest** cannot carry several order states; the delivery section
   has one row per order.
8. **A missing bank parameter takes down the whole Suitelet**, not only the BACS confirmation,
   because `load()` throws for every missing parameter.
9. **C6 does not say what happens when the PE or rep is inactive.** The Task goes to them; the
   fallback is used only when the employee cannot be read.
10. **The B4 guard does not check the opportunity's stage.** A ready, open order whose opportunity
    is in design (so not shown) can be booked by URL. Readiness's design gate normally prevents it.

### Release 1.3 — contradictions and decisions for Steve

1. **The brief says to apply the released exception in "the search filter", but the main order
   searches have no Record Status filter** — `isOpenOrder()` decides it. The filter
   (`recordStatusFilter()`) is used by the digest's LIVE input search, the only search that filters
   Record Status.
2. **A released order is open, so the guard would have let it be booked by URL** when it is ready
   and has no payment intent. Not in the brief: the guard now refuses released orders.
3. ~~Recently delivered uses the order's own `entity`.~~ **Decided (1.3.1):** it goes through the
   customer's opportunities, like every other section.
4. **The released meta uses `custbody_defaultshipdate`** (the customer's requested date) for
   "We're preparing your delivery for …", as briefed.

### Needs Steve (1.3)

- Set `custscript_cdb_released_statuses` and its twin to the **Release to Warehouse** ID, and the
  hidden statuses to the test statuses, in each account.
- A Sandbox check of the recent search: `opportunity anyof`, `status anyof SalesOrd:F,SalesOrd:G` and the two
  `within` date filters on sales orders.

### Release 1.2 — contradictions and decisions for Steve

1. ~~The card confirmation names the customer's rep, but the Task goes to the PE.~~ **Decided
   (amendment 1):** the card wording is neutral and names nobody; the card confirmation no longer
   shows the account manager block.
2. ~~An account customer who chooses BACS sees bank details with no amount.~~ **Decided
   (amendment 1):** the amount is shown to everyone arranging a delivery; see *Amount to pay*.
3. ~~`custscript_cdbmr_prepay_terms` is added but not used.~~ **Decided (amendment 1):** removed.
4. **Line 3 is "Order SO… · UFH" except when line 1 already fell back to the label**, so the label is
   not shown twice.
5. **At an amount of 0 the card wording reads "Nothing left to pay on this order. We'll be in touch
   to confirm your delivery."** rather than "take £0.00". Wording to confirm.
6. **The account order's tip in section 6** reads "If you pay by bank transfer, we book your delivery
   once payment reaches us. Either way, we'll email you to confirm the date." New wording, to confirm.

### Needs Steve (1.2)

- Add *Add to account* to `customlist_cust_pay_intent` and set its ID on both scripts
  (`custscript_cdb_pay_account`, `custscript_cdbmr_pay_account`).
- Replace `custscript_cdb_logo_url` / `custscript_cdbmr_logo_url` with the **coloured** logo.
- Confirm in Sandbox that `terms`, `total`, `custbody_unique_so_ref`, `custbodycustbody_sys_bal_incvat`
  and `custbody_deposit_total` are valid **sales order** search columns (a failure only logs
  `CDB EXTRAS_FAILED`, but then nobody is offered the account option).

### Release 1.1 — contradictions and decisions for Steve

1. **§3 asks for the description in the Task title and body, but the Task logic and
   `cdb_lib_task.js` are out of scope.** Not done: the Task is unchanged (`Delivery requested:
   <tranid> – <customer>`). Adding it is a one-line change in the Suitelet plus a title format change
   in `cdb_lib_task.js`, once the scope allows it.
2. **`custbody_cdb_awaiting_payment` is never cleared, so it can't tell paid from unpaid.** Once a
   booking is made it stays ticked through payment, release and billing, so *waiting for payment*
   (feedback 5) is true of every booked order forever. Staff need another signal (payment received,
   or `custbody_del_date` set) to read it, or something outside this repo must untick it.
3. **ConfirmBacs shows *Amount to pay*.** Release 1 decided no amount; left out.
4. **ConfirmBacs labels the first row *Account name*;** the parameter is `custscript_cdb_bank_name`
   (a bank name in release 1). Labelled *Bank name*. If the payee name is wanted, change the parameter
   value and the label together.
5. **The canvas's *Projects to order* sub-line** ("Not ready to order yet? A quick update helps us
   plan.") invites the release 2 *Update* action. Replaced with "Quotes we've sent you".
6. **Header:** the brief describes the Main header. The canvas gives Delivery a *Questions? Call …*
   header and the confirmations a logo-only header; each page follows its artboard. The canvas's
   AM **photo** (Main, ConfirmCard, Email) has no source, so it is left out everywhere.
7. **Email footer wording is fixed at "every 2 weeks" in the brief**, but the interval is
   `custscript_cdb_digest_days`. Rendered from the parameter: "every 2 weeks" at 14.
8. **Email button:** a bulletproof padded table cell, not a VML roundrect, so the CTA URL appears
   once (brief test 13). Outlook desktop shows it with square corners.
9. **Email rows:** "one row per project", but a delivery project's orders each have their own
   state, so there is one row per order there (as release 1). The email's badge wording follows
   its artboard (*Action needed*, *In design*, *Quote stage*), not the dashboard's.
10. **Email callout:** also shown when the only thing to do is a bank transfer. An order awaiting a
    card payment is not counted: the customer has nothing to do.
11. **Release 1's "nothing from third-party hosts" rule is relaxed** by this brief for Google Fonts
    on the pages. Recorded in section 5.

### Needs Steve (1.1)

- **Workflows that write `custbody_edd_certainty`.** Nothing in this repo or NS-Opportunity-SO-Sync
  writes it (searched on every branch). A workflow on the sales order could overwrite *Customer
  Definite* after the booking saves; check the workflows on the sales order record.
- **Workflows or scripts that read `custbody_cdb_awaiting_payment`**, given point 2 above.
- Set `custscript_cdb_edd_definite_value` and `custscript_cdb_option_hints` (section 4), and add
  `custbody_cdb_awaiting_payment` to the sales order forms staff use.

### NetSuite configuration tasks for Steve

Section 8, plus: keep each `custscript_cdbmr_*` equal to its `custscript_cdb_*` original, and
`custscript_cdb_excluded_statuses` equal to the sync's `custscript_opsync_excluded_statuses`.
