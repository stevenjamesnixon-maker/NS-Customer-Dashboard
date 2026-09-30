# Customer Dashboard — project context

Canonical reference for this project. If this document and the repository disagree, **the
repository wins** — read the file and then fix this document in the same PR.

Scope of this document: the SuiteScript in this repo and the NetSuite configuration it depends
on. It does not describe the wider NetSuite account.

**Last updated:** 30 Sep 2026 (release 1, PR #1). **Status:** not deployed.

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
| Dashboard Suitelet | 1.0.0 | `cdb_sl_dashboard.js` | Available Without Login: dashboard, delivery form, POST, confirmations | Not deployed |
| Digest Map/Reduce | 1.0.0 | `cdb_mr_digest.js` | The 14-day digest email | Not deployed |
| Config library | 1.0.0 | `lib/cdb_lib_config.js` | Every script, field and parameter ID; what empty means; the `CDB ` log prefix | Not deployed |
| Token library | 1.0.0 | `lib/cdb_lib_token.js` | Sign and verify the link; `buildLink(customerId)` | Not deployed |
| Dates library | 1.0.0 | `lib/cdb_lib_dates.js` | Pure: working days, earliest date, window, calendar, London today | Not deployed |
| Data library | 1.0.0 | `lib/cdb_lib_data.js` | Reads: customer → opportunities → orders, grouping, the guard, validation | Not deployed |
| Render library | 1.0.0 | `lib/cdb_lib_render.js` | Pure HTML: page, sections, form, confirmations, email | Not deployed |
| Task library | 1.0.0 | `lib/cdb_lib_task.js` | The Task for the AM/PE | Not deployed |

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

1. A linked opportunity: the native `opportunity` field, `mainline = T`. Not `createdfrom`.
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

### Order row states, first match wins

1. `custbody_del_date` set → **Delivery booked**, with that date.
2. `custbody_cust_pay_intent` set → **Awaiting payment**, *Requested <ship date>, <time>*, and a
   *Payment details* disclosure: the bank panel for BACS, *your account manager will call* for Card.
3. `custbody_ready_for_delivery` ticked → **Ready to deliver**, yellow **Arrange delivery**.
4. Otherwise → **Needs information**, `custbody_delivery_hold_reason`, *Your account manager will
   be in touch*.

The row is named after the quote type's text, with the SO number.

### The account manager (brief C6)

`resolveRecipient(opp)`: `custbody_pe` when `custbody_value_proposition` is in
`custscript_cdb_pe_valueprops` **and** the PE is set; otherwise `salesrep`; otherwise the fallback
employee. The Task goes to that employee. The page header shows the same rule applied to the
first opportunity in delivery, else design, else to-order order; with no opportunity at all, the
customer's sales rep, else the fallback.

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
   `custbody_cust_booking_req` (now). Save with `ignoreMandatoryFields`. `CDB SO_UPDATED` logs every
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
- **Nothing loads from a third-party host.** Inline CSS, no script, no Google Fonts. The only
  external resource is the logo from `custscript_cdb_logo_url`.
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
- **The calendar is server-rendered** radio buttons, not a native date input. It works without
  script; the server validates regardless.

---

## 6. Known issues and limitations

- **Readiness is only as current as the sync keeps it.** The nightly refresh (brief C3) is
  NS-Opportunity-SO-Sync PR #8, **not merged** at the time of writing. Until it is deployed, an
  order's *ready* flag only refreshes when someone saves the opportunity or the order, so a stale
  *ready* can offer *Arrange delivery*.
- **Two POSTs at the same instant** could both pass the guard and create two Tasks. The window is
  the few hundred milliseconds between the guard's search and the save.
- **The selected calendar day is highlighted with CSS `:has()`.** Browsers without it still select
  and submit correctly; they just don't colour the chosen day.
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

### NetSuite configuration tasks for Steve

Section 8, plus: keep each `custscript_cdbmr_*` equal to its `custscript_cdb_*` original, and
`custscript_cdb_excluded_statuses` equal to the sync's `custscript_opsync_excluded_statuses`.
