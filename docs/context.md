# Customer Dashboard — project context

Canonical reference for this project. If this document and the repository disagree, **the
repository wins** — read the file and then fix this document in the same PR.

Scope of this document: the SuiteScript in this repo and the NetSuite configuration it depends
on. It does not describe the wider NetSuite account.

**Last updated:** 1 Oct 2026 (release 2.0, direct links and *Send delivery link*). **Status:** releases 1 and 1.1
passed their Production tests on 30 Sep 2026; releases 1.2 and 1.3 merged; release 2.0 not merged, not deployed.

**2.0.5 (PR #5 amendment 5):** the amount to pay is the system balances only, shown everywhere as
*£x inc VAT (£y ex VAT)*; the `total − deposit` fallback is removed (section 4, *Amount to pay*).

**2.0.4 (PR #5 amendment 4):** the delivery-link email's hero and "Before you book" icons are
constants in `cdb_lib_config.js`, not parameters (Steve, 1 Oct: fixed branding images are constants).

**2.0.3 (PR #5 amendment 3):** customer emails v2 — both emails built to the approved designs
`docs/design/canvas/EmailDeliveryLink.dc.html` and `EmailDigestV2.dc.html` (section 4, *Customer emails v2*).

**2.0.2 (PR #5 amendment 2):** one customer email standard — both emails follow Send Quote 2.2.0's
email card (section 4, *The customer email standard*).

**2.0.1 (PR #5 amendment 1):** `custscript_cdbsend_quote_type_labels` added; the delivery-link email
shows the short type label (*Order SO… · UFH*).

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

13. **Every customer action has its own direct link (2.0).** `?t=<token>&a=<action>&<id>=<value>`
    (today: `a=delivery&so=<sales order>`). Emails link to the action; confirmation pages link back to
    the dashboard. The link's customer is **always the order's opportunity's customer** (the guard's
    rule), never the order's `entity`. Section 4, *Direct links*.

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
| Dashboard Suitelet | 2.0.1 | `cdb_sl_dashboard.js` | Available Without Login: dashboard, delivery form, POST, confirmations | Not deployed |
| Digest Map/Reduce | 2.0.3 | `cdb_mr_digest.js` | The 14-day digest email | Not deployed |
| Sales order User Event (2.0) | 2.0.0 | `cdb_ue_salesorder.js` | beforeLoad, VIEW, UI only: the *Send delivery link* button and its banner | New |
| Send link Suitelet (2.0) | 2.0.5 | `cdb_sl_send_link.js` | Internal, login required: emails the customer a direct delivery link for one order | New |
| Config library | 2.0.5 | `lib/cdb_lib_config.js` | Every script, field and parameter ID; what empty means; the `CDB ` log prefix; the 2.0 email and banner wording; the email standard's constants | Not deployed |
| Token library | 2.0.0 | `lib/cdb_lib_token.js` | Sign and verify the link; `buildLink(customerId, extra)` | Not deployed |
| Dates library | 1.3.2 | `lib/cdb_lib_dates.js` | Pure: working days, earliest date, window, calendar, London today, the customer-facing date (`formatDisplay`) | Not deployed |
| Data library | 2.0.4 | `lib/cdb_lib_data.js` | Reads: customer → opportunities → orders, grouping, the guard, validation; the email recipient, author and AM card data | Not deployed |
| Render library | 2.0.5 | `lib/cdb_lib_render.js` | Pure HTML from the canvas: page, sections, form, confirmations; the email standard's blocks, the digest and the delivery-link email | Not deployed |
| Task library | 1.2.1 | `lib/cdb_lib_task.js` | The Task for the AM/PE | Not deployed |

All paths are relative to `src/FileCabinet/SuiteScripts/NuHeat/Customer Dashboard/`.

---

## 3. Environments — environment-agnostic policy

**This repo represents no single environment.** The same files deploy unchanged to Sandbox and
Production.

| Committable | Never committable |
|---|---|
| Script IDs — `custbody_*`, `custentity_*`, `custrecord_*`, `customrecord_*`, `customlist_*`, `customscript_*`, `customdeploy_*`, `custscript_*`, `custsecret_*` | Internal IDs — list option IDs, status IDs, employee IDs, quote type record IDs, customer IDs |
| NetSuite's standard status codes (`SalesOrd:B`) and text values (`NOTSTART`, `HIGH`) | Account numbers, account-specific URLs, bank details |

**Fixed branding images are constants, not parameters (Steve, 1 Oct 2026, amendment 4).** Parameters
are for values that differ by account or that the business changes (internal IDs). The public image
addresses in `cdb_lib_config.js` — `EMAIL_STANDARD` (Send Quote's image host, footer logo and social
icons), `EMAIL_HERO_URL` and `EMAIL_ICONS` (File Cabinet `media.nl?id=…&c=472052&h=…` URLs) — are a
**stated exception to "no numeric IDs in code"**: the numbers in them are part of a public URL, not
record IDs the code reads or writes.

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
- **The API Secret is "Allow for all scripts"** (2.0 correction). Restricting it to the named scripts
  failed in Production with *"An error occurred while decrypting a secret"*, probably because
  `N/crypto` is called from a library file (`cdb_lib_token.js`) rather than from a script record. It
  is still never restricted by employee.
- **Verify** checks, in order: shape, payload, HMAC (constant-time compare), the customer exists,
  is not inactive, and its version matches. Any failure shows **one** page — *"This link is no
  longer valid. Please contact your account manager"* — and logs `CDB INVALID_LINK` at audit with
  the reason.
- `buildLink(customerId, extra)` is exported for the digest, the *Send delivery link* email and
  future email templates. `extra` is passed through to `url.resolveScript`, which encodes it; with
  no `extra` the link is byte-identical to 1.x. An extra `t` is ignored.

### Direct links (2.0)

**Every customer action gets its own direct link**: `?t=<token>&a=<action>&<id>=<value>`. The token
still names only the customer; the action and its ID are plain parameters, and the dashboard
Suitelet guards them against the token's customer exactly as before. Emails link **to the action**
(the *Send delivery link* email's button is `?t=…&a=delivery&so=<id>`), with a secondary link to the
dashboard; confirmation pages link back to the dashboard.

**The customer for a link is always the order's opportunity's customer** (`data.orderCustomer()`,
the guard's rule), never the order's own `entity`. A link built for any other customer would be
refused by the guard as *another customer*.

### Send delivery link (2.0)

Staff send a customer a *book your delivery* link for **one** sales order. Automatic sending comes
later.

**`cdb_ue_salesorder.js`** — User Event on Sales Order, `beforeLoad`, **VIEW only, internal UI only**
(any other event or execution context does nothing). It adds **Send delivery link** when all five
hold, read from the record's own fields (no search, no parameter, no units): `opportunity` set; the
native `orderstatus` is A, B, D or E (`config.SHIPPABLE_STATUSES`); `custbody_del_date` empty;
`custbody_cust_pay_intent` empty; `custbody_ready_for_delivery` ticked. The button is a convenience,
not the check: a released or excluded order can show it and is then refused by the Suitelet. Clicking
goes to the internal Suitelet with `so=<id>` (URL from `url.resolveScript`, an inline
`window.location.assign` handler, no client script file).

**The banner.** The Suitelet redirects back with `cdbsl=sent|refused|failed` and `cdblt=<ms>`. The
text comes only from `config.SEND_LINK_BANNERS`, a fixed whitelist keyed by the code; an unknown code
shows nothing and nothing from the URL is displayed. It shows for 300 seconds after `cdblt` (60
seconds of clock difference tolerated the other way). The recipient's email is **not** in the
banner: no record holds it, and reading the script log costs a search; it is in `CDB SEND_LINK` and
on the Communication tab.

**`cdb_sl_send_link.js`** — internal Suitelet, **login required, GET only**:

1. `config.load()` — the `custscript_cdbsend_` parameters (below).
2. `data.orderCustomer(so)` (the opportunity's customer), then `data.guardOrder()` for that customer:
   open, ready, not booked, not requested, not released. Refused → back to the order with
   `cdbsl=refused`; `CDB SEND_REFUSED` with the guard's reason. An inactive customer is refused too
   (the link would show the invalid page).
3. Recipient: `data.emailRecipient()` — the dashboard contact's email, else the customer's (the
   digest's rule). Missing or not an email → `refused`; `CDB SEND_NO_RECIPIENT`.
4. Author: `data.emailAuthor()` — the customer's sales rep if active, else the fallback employee (the
   digest's rule, moved to the data library and shared). **Not the user who pressed the button.**
5. The email: `render.deliveryLinkEmail()` with the direct link
   `buildLink(oppCustomer, { a: 'delivery', so })` and the dashboard link `buildLink(oppCustomer)`;
   the extras (description, split reference, type label) as the dashboard reads them. The short type
   label comes from `custscript_cdbsend_quote_type_labels` (2.0.1) with the dashboard's parser and
   fallback: empty or invalid → the quote type's own text, logged once (`CDB PARAMETER_DEFAULT` /
   `CDB TYPE_LABELS_INVALID`), never failing the send.
6. `email.send` with `relatedRecords: { entityId: customer, transactionId: so }` — on both
   Communication tabs. Any failure → `cdbsl=failed`; `CDB SEND_FAILED`.
7. `CDB SEND_LINK`: the order, the customer, the recipient, the author and **the user who pressed**.
8. `redirect.toRecord` to the order with `cdbsl=sent`.

**No record writes.** Sending changes nothing on the order; a resend is just another email.

**The email** (`render.deliveryLinkEmail`, snapshot `test/snapshots/delivery-link-email.html`):
subject *"Your order {SO} is ready to deliver: choose your date"*; the logo; the band *READY TO
DELIVER / Choose your delivery date / Hello {name}*; the intro; one order block (project title, order
title, split reference, *Order SO… · UFH*); the yellow **ARRANGE DELIVERY** button; *Or view all your
projects*; the personal-link line; the AM card (the author); the footer *"You're receiving this
because you have an order with Nu-Heat."* — **no opt-out wording**. Every word is in
`config.DELIVERY_LINK_EMAIL`, so it changes in one place. It is built from the shared email blocks
(below), as the digest is.

### The customer email standard (2.0.2)

**Every customer email from the dashboard — the digest and the delivery link — follows Send Quote
2.2.0's email card** (Steve, 1 Oct 2026), so a customer gets one family of emails. Copied from
`stevenjamesnixon-maker/2026.03-Online-quote` `main` at **commit `4463cfa`** (1 Oct 2026; Send Quote SL
2.3.1, where the 2.2.0 email builder now lives in `nuheat_opp_update_lib.js` 1.1.0 — `emailShell`,
`emailRepCard`, `emailButton`, `checkPhotoUrl`, `resolveFirstName` — moved there byte-identical).
The patterns and constants are copied; the proposal content (hero, *Your quote*, *Why choose
Nu-Heat?*, the Send Quote logo and purple header) is not. Constants: `config.EMAIL_STANDARD`.

- **The document** (`render.emailShell`): a whole HTML document, Send Quote's head (meta, the Outlook
  `OfficeDocumentSettings`, the phone media query, the Outlook font rule), the hidden **preheader**,
  white page, the centred `width="600"` column. Inside it, unchanged in content: our logo
  (`custscript_cdb_logo_url`), our band, the rows, the button(s), the links.
- **The account manager card** (`render.emailRepCard`, replaces 2.0's `emailAmBlock`): a 96 px
  circular photo only when `custentity_employee_photo_link` (trimmed) is an `https://` URL with no
  spaces, quotes or angle brackets — otherwise no photo row at all; *YOUR ACCOUNT MANAGER*; the name;
  phone · email (two lines on phones); **CALL {FIRST}** (`tel:`, digits and + only) and **EMAIL
  {FIRST}** (`mailto:`) side by side, full width and stacked on phones. FIRST is the employee's
  `firstname`, else the first word of the name, else the buttons read *CLICK TO CALL* / *SEND AN
  EMAIL*. A button without its value is left out. No name, phone or email at all: no card.
- **The AM** is the email's author, as before (`data.emailAuthor()`: the customer's rep if active,
  else the fallback employee). The author lookup now also reads `custentity_employee_photo_link` in the
  **same** `search.lookupFields` (`getEmployee(id, true)`); if that lookup throws it is retried once
  without the photo, so a photo problem never costs the author or the send. **The phone** is the
  employee `phone` field, else `mobilephone` (this repo's fallback). Send Quote's card reads the same
  `phone` field (not `officephone`), after an Opportunity override this repo does not have.
- **`CDB AM_PHOTO`**, once per email at audit: *photo used*, or *photo skipped: <why>* (the Send Quote
  pattern, `data.emailAm()`).
- **The footer**: Send Quote's footer — its logo and the five social icons and links (Facebook,
  Instagram, LinkedIn, Twitter, YouTube) from Send Quote's image host — and one line per email. 2.0.3:
  teal `#25847a` as drawn, with the line inside it: the digest's *"You get this update every {N} weeks … reply to this email or call / email /
  contact {AM}."* (the 1.2 wording rules), the delivery link's *"You’re receiving this because you
  have an order with Nu-Heat."*
- **Preheaders**: digest *"Here’s where your Nu-Heat projects are up to."*; delivery link *"Your order
  is ready: choose your delivery date."*

### Customer emails v2 (2.0.3)

Both emails are built to Steve's approved designs (`docs/design/canvas/EmailDeliveryLink.dc.html`,
`EmailDigestV2.dc.html`, merged from `design/emails-v2`), keeping every 2.0.2 rule. Where the drawings
use flex or grid, the emails use table cells. Wording lives in `config.DELIVERY_LINK_EMAIL` and
`config.DIGEST_EMAIL`; colours in `config.EMAIL_STANDARD` (purple `#59315f`, magenta `#a3155f`, panels
`#f4f4f4`, teal `#25847a`).

**Shared.** The AM card's CALL button is filled purple, EMAIL a purple outline (an outer purple cell
round a white one, so the outline survives stripped styles); both bulletproof. **Contact fallback**
(Send Quote's): no phone on the employee → `01404 540604`; no email → `info@nu-heat.co.uk`, in the card's
text and buttons and the "need it sooner" line (`EMAIL_STANDARD.FALLBACK_PHONE` / `FALLBACK_EMAIL`), so
the card always shows both buttons. The personal-link line now sits under the card, as drawn.

**"Book your delivery"** (`render.deliveryLinkEmail`): logo; band *READY TO DELIVER / Your order is
ready, {name} / Choose a delivery date…*; **hero** — `config.EMAIL_HERO_URL`, a constant: 2.0.4 uses
Send Quote 2.2.0's hero (*Order conformation.jpg*), its URL and `width="600" height="337"` copied
exactly from 2026.03-Online-quote `nuheat_send_quote_sl.js` **line 1278** (commit `4463cfa`; the image
host is `EMAIL_IMG`, `nuheat_opp_update_lib.js` line 858), full width, `alt=""`, only for an https
address; **Your order** — the label, the order title, then the facts: *Order* (SO… · UFH), *Project*
(QR… · site address, `guardOrder()` now reads `custbody_opp_site_adress`), *This order* (the split
reference, only when set), *Earliest delivery* (the delivery form's own first allowed date —
`custscript_cdbsend_notice_days`, weekends, the non-delivery dates, the 6-month horizon — shown as on
the form, then *(sooner? call us)*; left out if none or the read fails, `CDB EARLIEST_FAILED`), *Amount
to pay* (`£x inc VAT`, only when the amount is known and the order pays up front — decided as on the
dashboard from `custscript_cdbsend_prepay_terms` and `_pay_account`; 0 reads *Nothing left to pay*);
**CHOOSE MY DELIVERY DATE** and *Or view all your projects*; **How it works** — three numbered steps,
step 1 with *Need it sooner? … call {first} on {phone}* (`tel:`), step 3 worded for pay-up-front or
account; **Before you book** — the grey panel, three tips, each with its icon from `config.EMAIL_ICONS`
(2.0.4: LORRY, PARCEL, PEOPLE — square teal-on-transparent PNGs in the File Cabinet), `width="48"
height="48"`, `alt=""`, URL escaped (`&` → `&amp;`), centred above the tip; a blank or non-https
constant shows the tip as text only; **Questions?** and the AM card; the personal
line; the footer.

**The projects update** (`render.digestEmail`): logo and band as before; **summary tiles**, one equal
cell per non-zero count in one row — ready to book (`#fff5dc`), awaiting payment (`#e3edf7`), in design
(`#efe9f1`, projects), booked (`#e6f2ec`, released or booked orders) — none when all are zero; the
**action box**, only with ready orders: *{n} order(s) ready to deliver*, at most 3 rows (description,
*project · Order SO… · UFH · split reference*, **CHOOSE DATE** to that order's own direct link), then
*and {n} more on your projects page* linked to the dashboard; **Your projects** — one card per project
in the section order (what needs the customer, design, quotes, then what is in hand), with a five-step
**progress bar** (Quote → Ordered → Design → Delivery → Delivered/Booked: current yellow `#ffb500` and
bold, earlier teal, later `#e2ded9`; `render.projectStage()`), and for delivery projects the order rows
with their badges (awaiting BACS: *ref SO… for payment*); **VIEW ALL YOUR PROJECTS** (purple); the AM
card, the personal line, the footer with the digest's wording. Who gets a digest, the subject and the
14-day rule are unchanged. The old callout sentences (`digestCallout()`) are no longer rendered.

**Robustness (Online-quote `AI_AGENT_CONTEXT.md` §9, pitfall 25).** The email must stay centred and
single-column with every `style` attribute and every `<style>` block removed — NetSuite's message view
on the Communication tab is such a viewer. So: layout by tables and attributes (`align`, `width`,
`bgcolor`, `valign` on every structural `table` and `td`), CSS only polishing; no floats and no
percentage-width side-by-side tables (two-up is one row of two `td width="50%"`, stacked on phones);
centred by attribute at every level; the container `width="600"` with `style="width:100%;max-width:600px"`;
**buttons are bulletproof tables with exactly one `[if !mso]` / `[if mso]` pair each** (this replaces
1.1's "plain table cell, no VML": Send Quote's is proven in Outlook; still exactly one visible link per
button in every client), no `display:none` wrappers (the preheader span excepted); colours as
attributes too (`bgcolor`, `<font color>`); every value escaped. A stripped viewer shows the preheader
text at the top — accepted, as in Send Quote. `test/r2-0-2.test.js` checks both emails stripped.

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
`custbodycustbody_sys_bal_incvat` and (2.0.5) `custbody_sys_bal_exvat`. **The main order searches
never gain these columns.** It exists because a custom field that does not apply to sales orders
makes a search throw: here that is caught, logged once as `CDB EXTRAS_FAILED`, and `{}` comes back —
the page renders as in 1.1, with no amount, no split reference and **every order treated as pay up
front**.

### Amount to pay (2.0.5 — the system balances only)

**Field meanings (Steve, 1 Oct 2026):**

| Field | Meaning |
|---|---|
| `custbodycustbody_sys_bal_incvat` | **The amount to pay, including VAT, after any deposits** (doubled prefix: the real ID) |
| `custbody_sys_bal_exvat` | The amount to pay, **excluding VAT**, after deposits |
| `subtotal` | The order total before VAT, discounts and deposits — not read |
| discount, VAT | Separate amounts — not read |

`amountToPay(extras)` (pure) returns `{ incVat, exVat }` or `null`:

- the inc-VAT balance blank (or not a number) → `null` — **no fallback**. The old fallback,
  `total − custbody_deposit_total`, gave inconsistent, wrong figures and is removed; neither field is
  read any more;
- `exVat` is `null` when its field is blank (or negative);
- **0** is a real balance: *Nothing left to pay on this order*;
- **negative** inc VAT → `null`, logged once as `CDB AMOUNT_ODD` (dashboard and send link).

**One text, everywhere an amount shows** (`render.amountText()`): *£1,234.50 inc VAT*, followed by
*(£1,028.75 ex VAT)* when the ex-VAT balance is known; nothing when `null`. The Task shows the same
text (no "basis" wording since 2.0.5).

**Steve's rule: the amount is always shown when a delivery is
being arranged** (PR #3 amendment 1). It is shown to **every** customer, whatever the terms, in:

- section 6 and the aside of the form (an account customer also gets the hint *"Only if you're
  paying by bank transfer. Choose 'Add to my account' and nothing is due now."*);
- the bank panel of the BACS confirmation;
- the card confirmation;
- the *Payment details* panel of an order awaiting payment;
- the Task, whenever the choice is BACS or Card;
- (2.0.3) the delivery-link email's *Amount to pay* row, for pay-up-front orders only.

**An Add-to-account booking shows no amount anywhere** and does not tick *Awaiting customer
payment*; a BACS or Card booking ticks it, whatever the terms. **The digest shows no amounts.**

**The card wording names nobody**: *"We'll call you to take £x inc VAT (£y ex VAT). We never ask for
card details online."* (or *"We'll call you to take payment."* with no amount). Whoever gets the Task makes the
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
extras call (`decorateAll()`), after grouping, so only rows that will be shown are read. A failure
logs `CDB RECENT_FAILED` and the page or digest carries on without them. Since 1.3.2 they are shown
in *Booked deliveries* (below).

### Two delivery sections: what needs you, and what is in hand (1.3.2)

Steve's test showed a booked, released order among orders that need the customer. The page answers
"do I need to do anything?" at a glance. `data.arrangeSections()` (pure, run after `decorateAll()`):

- **Projects for delivery** keeps only orders that **need the customer**: `ready`, `awaiting_payment`,
  `requested`, `needs_info`. A project with none of those leaves the section.
- **Booked deliveries** (last; *"Nothing needed from you. Delivered orders stay here for {N}
  days."*) holds everything **in hand** — `released` (*Being prepared*), `booked` (*Delivery booked*)
  and the recent deliveries (*Delivered*) — grouped by project, *Nothing needed from you* on every
  row, no actions, no amounts, left out when empty. Projects with an upcoming order come first, by
  their soonest upcoming date (the confirmed date when booked, else the ship date; undated last);
  then delivered-only projects, most recent first. Within a project: upcoming ascending, then
  delivered descending. A project can appear in both sections.
- **Both pills count orders.** Before 1.3.2, *Projects for delivery* (and *Recently delivered*)
  counted projects.
- **Whether anything shows, and who gets a digest, are unchanged** (`groups.isEmpty`, decided before
  the split). Booked deliveries count against "nothing to show" on the page. **The digest rule, as in
  1.3.0:** a customer gets one if they have an open quote, design or open order — and booked or
  released orders ARE open orders, so a customer whose only orders are booked or released still gets
  a digest; recent deliveries alone never trigger one.
- **The email** keeps its order — *For delivery* rows first, then design, then quotes — and ends with
  a headed *Booked deliveries* group (last, as on the page, so design and quote rows never sit under
  its heading). The callout still counts only ready and BACS-awaiting orders.

### Customer-facing dates (1.3.2)

One helper, `dates.formatDisplay(key, todayKey)`: *"Fri 30 Oct"* in the current UK year, *"Fri 16 Apr
2027"* otherwise. Used for every customer-facing date on the dashboard, the form (calendar labels and
summary), the confirmations and the email. The Task and the staff change log keep the long form.

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
sentence uses the same rule (*"…or call / email / contact {name}"*); its AM card (2.0.2, the Send
Quote card) shows the phone, the email, or both when both exist, and a CALL / EMAIL button for each. So a customer whose rep is A, with a PE-case opportunity whose PE
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

**The Send delivery link Suitelet's twins (2.0)** — prefix `custscript_cdbsend_`, the same value as
their `custscript_cdb_` original, and **empty means what it means on the dashboard Suitelet**:

| Parameter (Send link Suitelet) | Type | Value | Empty means |
|---|---|---|---|
| `custscript_cdbsend_excluded_statuses` | Free-Form Text, comma list | same as `custscript_cdb_excluded_statuses` | throw |
| `custscript_cdbsend_excluded_quote_types` | Free-Form Text, comma list | same as `custscript_cdb_excluded_quote_types` | throw |
| `custscript_cdbsend_released_statuses` | Free-Form Text, comma list | same as `custscript_cdb_released_statuses` | none: released orders count as excluded, so are refused as not open (the guard refuses them as released when it is set) |
| `custscript_cdbsend_fallback_employee` | List/Record → Employee | same as `custscript_cdb_fallback_employee` | throw |
| `custscript_cdbsend_logo_url` | Free-Form Text, https | same as `custscript_cdb_logo_url` | no logo; audit |
| `custscript_cdbsend_notice_days` (2.0.3) | Integer | same as `custscript_cdb_notice_days` | 3; audit |
| `custscript_cdbsend_prepay_terms` (2.0.3) | Free-Form Text, comma list of `terms` IDs | same as `custscript_cdb_prepay_terms` | everyone pays up front (the amount row shows; step 3 reads pay up front) |
| `custscript_cdbsend_pay_account` (2.0.3) | Integer | same as `custscript_cdb_pay_account` | everyone pays up front |
| `custscript_cdbsend_quote_type_labels` (2.0.1) | Long Text, JSON `{"<quote type id>": "UFH"}` | same as `custscript_cdb_quote_type_labels` | each quote type's own text; audit. Invalid JSON also logs `CDB TYPE_LABELS_INVALID` once. Never fails the send |

The numeric defaults above are the values the brief gives for Production. **Read the IDs off each
account's lists before setting them**; they are not guaranteed to match between accounts.

---

## 5. Standing warnings and deliberate decisions

**Security — do not relax:**

- **No current user.** A no-login Suitelet runs as user −4. `runtime.getCurrentUser()` appears
  nowhere in this repo **except once in the login-required `cdb_sl_send_link.js` (2.0), for its
  `CDB SEND_LINK` log line only** (a node test enforces both). Authors and assignees come from
  records and parameters, never from the current user.
- **The customer is the token's.** The customer ID is never read from a request parameter.
- **Ownership on every write.** The order ID comes from the request, so the guard checks that the
  order's opportunity belongs to the token's customer, on GET and again on POST, and the loaded
  record is re-checked before saving.
- **One generic invalid page.** Tampered, revoked, inactive, missing: the customer sees the same
  sentence, the log sees the reason.
- **Output is escaped.** Every value from a record or a request goes through `esc()`.
- **Almost nothing loads from a third-party host.** Inline CSS. From 1.1 the **pages** load Source
  Sans 3 from Google Fonts (the email does not); otherwise the only external resource is the logo
  from `custscript_cdb_logo_url`. **The emails (2.0.2)** also load Send Quote's footer logo and social
  icons from its image host (`config.EMAIL_STANDARD.IMG_BASE`), the delivery-link email's hero (same host) and its three icons (`EMAIL_ICONS`, the File Cabinet), and, when set, the AM's https photo. The delivery form carries a small inline script (month switching,
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
| `CDB EARLIEST_FAILED` (2.0.3) | audit | The non-delivery dates could not be read for the delivery-link email; it was sent without the earliest date | Check `customrecord_cdb_nondelivery` |
| `CDB AM_PHOTO` (2.0.2) | audit | Once per customer email: the AM's photo used, or skipped and why | Set `custentity_employee_photo_link` to an https URL if a photo is wanted |
| `CDB TYPE_LABELS_INVALID` | audit | `custscript_cdb_quote_type_labels` (or its MR or SEND twin) is not a JSON object; each type shows its own text | Fix the JSON |
| `CDB FIELD_MISSING` | audit | An optional field is not on the loaded sales order; it was skipped and the booking went ahead | Check the field's Applies To and the form |
| `CDB USAGE` | audit | Remaining governance at the end of every request | Should stay well above 800 |
| `CDB DIGEST_INPUT` | audit | Mode, and in LIVE how many are due, sent and left over | — |
| `CDB DIGEST_SENT` / `DIGEST_SKIPPED` | audit | Per customer | — |
| `CDB DIGEST_FAILED` / `DIGEST_STAMP_FAILED` | error | Not sent / sent but not stamped (it will send again next LIVE run) | Stamp by hand if needed |
| `CDB DIGEST_SUMMARY` | audit | Counts per outcome | — |
| `CDB SEND_LINK` (2.0) | audit | A delivery link was emailed: order, customer, recipient, author, the user who pressed | — |
| `CDB SEND_REFUSED` (2.0) | audit | Not sent: the guard's reason, no opportunity, an inactive customer, or a bad request | Expected for a booked, requested, released or not-ready order |
| `CDB SEND_NO_RECIPIENT` (2.0) | audit | Not sent: no dashboard contact email and no valid customer email | Add an email to the customer or the dashboard contact |
| `CDB SEND_FAILED` (2.0) | error | `email.send` (or a read before it) threw; nothing was sent | Read the details; often the author is not a valid employee |
| `CDB UE_FAILED` (2.0) | error | The sales order User Event threw; the order still opened, without the button or banner | Read the details |

---

## 8. Deployment sequence

Steve deploys. Manual File Cabinet upload to `SuiteScripts/NuHeat/Customer Dashboard/`, keeping the
`lib/` subfolder.

**Which list to follow.** The account already has release 1.x installed (section 0: releases 1 and 1.1
passed their Production tests on 30 Sep 2026). **Follow 8.1 to install 2.0.** 8.2 is the first-install
list, kept for a new account only — do not follow it for 2.0: it creates objects that already exist.

**Entering IDs in NetSuite.** NetSuite adds the prefix itself. In each ID field type **only the part
after the prefix**, starting with the underscore:

| Object | Prefix NetSuite adds | You type | Result |
|---|---|---|---|
| Script record | `customscript` | `_cdb_sl_send_link` | `customscript_cdb_sl_send_link` |
| Script deployment | `customdeploy` | `_cdb_sl_send_link` | `customdeploy_cdb_sl_send_link` |
| Script parameter | `custscript` | `_cdbsend_notice_days` | `custscript_cdbsend_notice_days` |

Typing the full ID gives `customscriptcustomscript_…` or an *ID already in use* error, and then the code
cannot find the script or the parameter (`CDB_UNKNOWN_SCRIPT`, `CDB_PARAMETER_MISSING`).

**Check before you create.** Before creating any script record, deployment or parameter, search for its
ID (*Customization › Scripting › Scripts*, filter by ID; for a parameter, open the script record's
*Parameters* subtab). **If it exists, do not create it again**: open it and check its settings against
the list below.

### 8.1 Install release 2.0 on the existing account

**Already in the account — do not create; check only:**

| Object | 2.0 change | What to do |
|---|---|---|
| Customer, sales order and employee fields (`custentity_cdb_*`, `custbody_*`, `custentity_employee_photo_link`) | none | nothing |
| Custom record `customrecord_cdb_nondelivery` | none (2.0 also reads it for the delivery-link email's earliest date) | keep the dates current |
| API Secret `custsecret_cdb_link_key` | **setting only** | open it; set **Allow for all scripts**; do not change its value (that revokes every link) |
| Script record `customscript_cdb_sl_dashboard` and deployment `customdeploy_cdb_sl_dashboard` | file replaced; **no new parameters** | do not create; replace the file (below) |
| Script record `customscript_cdb_mr_digest` and deployment `customdeploy_cdb_mr_digest` | file replaced; **no new parameters** | do not create; replace the file (below) |

**1. Replace the files** in `SuiteScripts/NuHeat/Customer Dashboard/`. Upload each with the same name
and choose to overwrite: the existing script records keep pointing at the file, so nothing else
changes. Libraries first:
- `lib/cdb_lib_config.js`, `lib/cdb_lib_data.js`, `lib/cdb_lib_render.js`, `lib/cdb_lib_token.js`
  (changed); `lib/cdb_lib_dates.js`, `lib/cdb_lib_task.js` (unchanged — re-upload only if unsure);
- then `cdb_sl_dashboard.js` and `cdb_mr_digest.js` (overwrite);
- then the two **new** files, `cdb_sl_send_link.js` and `cdb_ue_salesorder.js`.

**2. The Send link Suitelet — new** (skip any part that already exists; check its settings instead).
- Script record: *Customization › Scripting › Scripts › New*, file `cdb_sl_send_link.js`, type Suitelet.
  ID `_cdb_sl_send_link` → `customscript_cdb_sl_send_link`.
- Parameters on the **script record** (*Parameters* subtab), each ID typed without `custscript`. Set the
  values on the deployment. "Same as" means copy the value from the dashboard Suitelet's deployment:

| You type (ID) | Full ID | Type | Value | Empty means |
|---|---|---|---|---|
| `_cdbsend_excluded_statuses` | `custscript_cdbsend_excluded_statuses` | Free-Form Text | same as `custscript_cdb_excluded_statuses` | the script refuses to run (`CDB PARAMETER_MISSING`) |
| `_cdbsend_excluded_quote_types` | `custscript_cdbsend_excluded_quote_types` | Free-Form Text | same as `custscript_cdb_excluded_quote_types` | refuses to run |
| `_cdbsend_fallback_employee` | `custscript_cdbsend_fallback_employee` | List/Record → Employee | same as `custscript_cdb_fallback_employee` | refuses to run |
| `_cdbsend_released_statuses` | `custscript_cdbsend_released_statuses` | Free-Form Text | same as `custscript_cdb_released_statuses` | none |
| `_cdbsend_prepay_terms` | `custscript_cdbsend_prepay_terms` | Free-Form Text | same as `custscript_cdb_prepay_terms` | everyone pays up front |
| `_cdbsend_pay_account` | `custscript_cdbsend_pay_account` | Integer | same as `custscript_cdb_pay_account` | everyone pays up front |
| `_cdbsend_notice_days` | `custscript_cdbsend_notice_days` | Integer | same as `custscript_cdb_notice_days` | 3 |
| `_cdbsend_quote_type_labels` | `custscript_cdbsend_quote_type_labels` | Long Text | same as `custscript_cdb_quote_type_labels` | each quote type's own text |
| `_cdbsend_logo_url` | `custscript_cdbsend_logo_url` | Free-Form Text | same as `custscript_cdb_logo_url` | no logo |

  Nine parameters, no more: the hero and the icons are constants (2.0.4), not parameters.
- Deployment: ID `_cdb_sl_send_link` → `customdeploy_cdb_sl_send_link`. **Not** Available Without Login.
  Audience: the sales roles. Status Released. Log level Audit.

**3. The sales order User Event — new** (skip any part that already exists).
- Script record: file `cdb_ue_salesorder.js`, type User Event. ID `_cdb_ue_salesorder` →
  `customscript_cdb_ue_salesorder`. No parameters.
- Deployment: ID `_cdb_ue_salesorder` → `customdeploy_cdb_ue_salesorder`. Applies To **Sales Order**.
  Event Type **View**. Audience all roles. Status **Testing** first; **Released** after testing.

**4. Check.** View a ready, unbooked sales order with an opportunity: *Send delivery link* shows.
Press it (testing on a test customer): the green banner, the email on the customer's and the order's
Communication tabs, and `CDB SEND_LINK` in the Suitelet's execution log. A `CDB PARAMETER_MISSING` or
`CDB_UNKNOWN_SCRIPT` entry names the ID to fix. Then the scenarios in section 9 (16–20).

### 8.2 First install on a new account (reference — not for 2.0)

For an account with no customer dashboard at all. On the existing account these all exist already.

1. **The fields.**
   - Customer: `custentity_cdb_link_version` (Integer; empty = 0), `custentity_cdb_dashboard_contact`
     (List/Record → Contact; empty = the customer's email), `custentity_cdb_digest_optout`
     (Checkbox), `custentity_cdb_last_digest` (Date).
   - Sales order: `custbody_cust_pay_intent` → `customlist_cust_pay_intent` (BACS / Card, account
     manager to call), `custbody_cust_booking_req` (Date/Time), `custbody_cdb_awaiting_payment` (Check
     Box). Also read-and-written: `custbody_edd_certainty` → `customlist955` (existing).
2. **The custom record** `customrecord_cdb_nondelivery` (*Non-delivery date*), field
   `custrecord_cdb_nd_date` (Date) plus its name. Add bank holidays and shutdowns for the next year.
3. **The API Secret** `custsecret_cdb_link_key`: a random value of at least 32 characters, set to
   **Allow for all scripts** — **never** restricted by employee. (Restricting it to the two scripts
   failed in Production: *"An error occurred while decrypting a secret"*; section 4.)
4. **Upload the libs, then the scripts.** All six `lib/` files first; then the four scripts.
5. **The dashboard Suitelet** `customscript_cdb_sl_dashboard`, deployment `customdeploy_cdb_sl_dashboard`:
   Available Without Login, Execute As Administrator, Released, log level Audit. Every `custscript_cdb_*`
   parameter in section 4.
6. **The digest Map/Reduce** `customscript_cdb_mr_digest`, deployment `customdeploy_cdb_mr_digest`: Not
   Scheduled, `custscript_cdb_digest_mode` = TEST, test customers set. Every `custscript_cdbmr_*` twin
   **with the same value as its `custscript_cdb_*` original**. Run by hand (Save and Execute), check
   `CDB DIGEST_SUMMARY`, then schedule daily and switch to LIVE when Steve says.
7. **The Send link Suitelet and the sales order User Event**: as 8.1 steps 2 and 3.

---

## 9. Testing

**Node** — `npm test`: dates (the B4 example exactly, a bank holiday, weekends, N = 0, the
six-month limit, London across BST changes), the token (payload, base64url, sign/verify and every
failure, crypto stubbed), stage grouping and order states from fixtures, the addendum's native
status rule (a Billed SO with a blank Record Status is not shown; a Pending Fulfillment SO is),
the C6 recipient, validation, configuration (every throw case), the rendered HTML (escaping, no
third-party URLs; 2.0.2: both emails centred and single-column with every style stripped, one visible link per button, the AM card's photo and buttons), house style (ES5, no current user, versions in
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
| 16 (2.0) | View a ready, unbooked order with an opportunity; then edit it | *Send delivery link* in VIEW only |
| 17 (2.0) | Press it | One email from the rep to the dashboard contact / customer, on the customer's and the order's Communication tabs; the green banner; `CDB SEND_LINK` names you; the button opens the delivery form directly; the secondary link opens the dashboard |
| 18 (2.0) | A released order with the box ticked; a customer with no email | The button shows; pressing gives the warning banner and no email; `CDB SEND_REFUSED` / `SEND_NO_RECIPIENT` |
| 19 (2.0) | Reload the order after 5 minutes | No banner |
| 20 (2.0.2) | Open each email in Outlook (desktop), Gmail (phone) and on the Communication tab's message view | Centred, single column; one of each button; the AM photo only for an https link; CALL / EMAIL the rep's first name; the teal footer with five social icons; on the delivery link the Send Quote hero and the three tip icons |

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
| 2.0: `newRecord.getValue({ fieldId: 'orderstatus' })` in beforeLoad VIEW | Returns the letter (`A`…`H`) | Not verified |
| 2.0: `form.addButton({ functionName: "window.location.assign('…')" })` | The inline expression runs on click, with no client script attached | Not verified; the brief cites the Send Quote pattern. If NetSuite needs a function name, attach a one-line client script |
| 2.0: `redirect.toRecord({ parameters })` then `context.request.parameters` in the order's beforeLoad | The parameters arrive on the VIEW request | Not verified |
| 2.0: `email.send` `relatedRecords.transactionId` = a sales order | The email shows on the order's Communication tab | Documented; not verified here |

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

### Release 2.0 — contradictions and decisions for Steve

1. **"No current user" vs logging who pressed the button.** Section 5 and a node test said
   `getCurrentUser()` appears nowhere in the repo; the brief asks `CDB SEND_LINK` to log the user who
   pressed. The rule exists for the no-login page, so it is kept there and everywhere else; the
   login-required Send link Suitelet reads the user once, for the log only. The style test allows it in
   that one file and checks it is read exactly once.
2. ~~The type label needs a parameter the brief does not list.~~ **Decided (amendment 1, 2.0.1):**
   `custscript_cdbsend_quote_type_labels` added, with the dashboard's parser and fallback.
3. **The recipient's email is not in the banner.** No record holds it and reading the log costs a
   search; the brief allowed leaving it out.
4. ~~The AM block "contact fallback".~~ **Superseded (amendment 2, 2.0.2):** both emails use the Send
   Quote card.
5. **The author.** Moved from the digest to `data.emailAuthor()` unchanged, so both emails use one
   rule (the page's `customerManager()` is the same rule).
6. **The button's five conditions do not include the Record Status**, as briefed (record fields only):
   a released or excluded order with the box ticked shows the button and is then refused, with the
   warning banner.
7. **Apostrophes.** The wording uses the typographic ’ (*you’d*, *don’t*, *You’re*), as the digest does.
8. **A missing `cdbsend_` parameter** sends nothing and redirects with `cdbsl=failed`
   (`CDB PARAMETER_MISSING` names it).

### Release 2.0.3 (amendment 3) — notes for Steve

1. **Four parameters the note did not list were needed** for what it asks, all twins on the send-link
   Suitelet: `custscript_cdbsend_notice_days` (the form's calculation needs the notice days), and
   `custscript_cdbsend_prepay_terms` / `_pay_account` (without them every order counts as pay up front,
   so account customers would see an amount and the pay-up-front step 3). Empty means what it means on
   the dashboard.
2. ~~Icons as parameters.~~ **Decided (amendment 4, 2.0.4):** constants (`EMAIL_ICONS`), File Cabinet
   images Steve supplied; the three `custscript_cdbsend_icon_*` parameters are removed.
3. ~~The hero's height is a guess.~~ **Decided (amendment 4, 2.0.4):** the hero is now Send Quote's own
   image, whose 600 × 337 attributes are copied from Send Quote.
4. **The project title is not in the delivery email**: the drawing shows *Project: QR… · site
   address* only, so the opportunity's name no longer appears there.
5. **Digest badges and order lines stay as today** (the note's rule): *Action needed*, *Delivery
   booked* and the date in the line, where the drawing has *Ready to book* and *Booked · Thu 8 Oct*. The
   line keeps today's detail (requested date, booked date, hold reason) after *Order SO… · UFH*; the
   split reference is its own line as before. The BACS wording is now *ref SO… for payment*.
6. **Card order follows the note** (needs the customer, design, quotes, then booked-only), where the
   drawing shows the booked project second.
7. **The quote card has no date or link**: *Quote sent 12 Sep · View your quote* in the drawing needs
   data the digest does not read. It shows *QR… · Quote sent*.
8. **"Requested" orders** (Add to account) count in no tile: the four tiles have no place for them.
9. **"Ordered" is never current.** No data marks an order placed but not yet in design: a Won
   opportunity is in design (design sub-status) or in delivery (delivery sub-status). No case found.
10. **Step 3** is completed from the drawing: *Pay by bank transfer or card. We book your delivery and
    email you the confirmed date.* / *Choose how you’d like to pay, or add it to your account. We book
    …*. The drawing's step 1 says *from 3 working days’ time*; the email uses the notice-days parameter.

### Release 2.0.2 (amendment 2) — notes for Steve

1. **Send Quote is at 2.3.1, not 2.2.0, and its email builder moved.** `buildEmailBody()` in
   `nuheat_send_quote_sl.js` now supplies copy only; `emailShell`, `emailRepCard`, `emailButton` and the
   constants are in `nuheat_opp_update_lib.js` 1.1.0 (moved byte-identical in 2.3.1, so the 2.2.0
   design). Copied from there, commit `4463cfa`.
2. **The phone field is `phone`, not `officephone`.** Send Quote's card reads the employee `phone`
   field (master proposal `loadSalesRepData`), after an Opportunity override (`custbody_sales_rep_phone`)
   this repo has no equivalent for. `officephone` is what Send Design reads. This repo keeps `phone`,
   else `mobilephone`.
3. ~~Send Quote's fallbacks are not copied.~~ **Decided (amendment 3, 2.0.3):** copied —
   `01404 540604` and `info@nu-heat.co.uk` when the employee has none.
4. **Not carried over:** the Calibri web-font stylesheet link in Send Quote's `<head>` (the emails load
   no web font, as before); Send Quote's own top logo and purple header (our logo parameter and band
   stay). Our logo has a `height` attribute only: it is a parameter of unknown width.
5. **The page background is now white** (Send Quote's), not the grey around a white card.
6. **The digest's footer line can repeat the EMAIL button's target.** With no phone, the 1.2 wording
   is *"…or email {AM} at {address}"* with a mailto link, so the address is linked twice (footer text
   and button). Kept: the note keeps today's wording rules.
7. **Preheader apostrophe.** *Here’s* uses the typographic ’, as the rest of the wording does.

### Release 1.3.2 — notes for Steve

1. **"Projects for delivery" counted projects, not orders**, before 1.3.2 (so did "Recently
   delivered"). Both pills now count orders, as the note asked; this is that report.
2. **Email group order:** the note says the groups follow the page, *For delivery* first, then
   *Booked deliveries*. The email has always put design and quote rows after the delivery rows; placing
   *Booked deliveries* straight after *For delivery* would put those rows under its heading. It goes
   last instead, as on the page.
3. **Undated upcoming orders** (released with no ship date) sort after dated ones.

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
- Confirm in Sandbox that `terms`, `custbody_unique_so_ref`, `custbodycustbody_sys_bal_incvat` and
  (2.0.5) `custbody_sys_bal_exvat` are valid **sales order** search columns (a failure only logs
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

Section 8, plus: keep each `custscript_cdbmr_*` and `custscript_cdbsend_*` equal to its `custscript_cdb_*` original, and
`custscript_cdb_excluded_statuses` equal to the sync's `custscript_opsync_excluded_statuses`.
