/**
 * cdb_lib_data.js
 *
 * Reads for the dashboard and the digest: customer -> opportunities -> sales orders, grouped into
 * the three stages; the guard on an order the customer wants to book; the delivery form's
 * choices; and the server-side validation of what the customer submitted.
 *
 * READ-ONLY, apart from three writes (2.2) that each touch exactly what their name says, and only after
 * the caller's guard: writeProjectDetails() (the opportunity's title and site address; 2.2.1), addToAddressBook() (one line on
 * the customer's address book) and writeDeliveryAddress() (custbody_cdb_delivery_address). Each one
 * throws on failure; the Suitelet catches, logs, and says so in the Task.
 *
 * WHAT "OPEN" MEANS FOR A SALES ORDER — every one of these, and the same everywhere:
 *   1. a linked opportunity: the sales order's native opportunity field is set. (The SALES ORDER
 *      search filters mainline T. Opportunity searches must never: they reject mainline.)
 *   2. its native status is one that can still ship: config.SHIPPABLE_STATUSES (addendum). This
 *      is a SEARCH FILTER, never a comparison against a column value, because the status column
 *      does not return the SalesOrd:X codes;
 *   3. its Record Status (custbody_finance_status) is blank or not in the excluded list — the same
 *      definition as NS-Opportunity-SO-Sync, with this repo's own twin of the list;
 *   4. its quote type is not an excluded one (Parts, FOC). A blank quote type is not excluded.
 * 1 and 2 are in the search; 3 and 4 are in isOpenOrder(), which is pure and node-tested.
 *
 * THE QUOTE DESCRIPTION (1.1) is read from the sales order's ORIGINATING QUOTE through the
 * createdFrom join: { name: 'custbody_quote_description', join: 'createdFrom' }. The field is
 * confirmed on the Estimate only; an unjoined sales order column could make the search throw.
 * cleanDescription() turns the stored HTML-ish value into plain text; render escapes it once.
 *
 * THE EXTRAS (1.2) — terms, the split reference, and (2.0.5) the two system balances — come
 * from ONE SEPARATE search, getOrderExtras(), run once per request for every order on the page.
 * The main order searches never gain these columns: a custom field that does not apply to sales
 * orders makes a search throw, and that must not take the dashboard down. If the extras search
 * fails it logs CDB EXTRAS_FAILED and returns {}: no amount, no split reference, and every order
 * treated as PAY UP FRONT (fail closed: the account option is offered to nobody).
 *
 * PAY UP FRONT vs ACCOUNT (1.2, amendment 2), isPrepay(): BOTH the customer and the order must say
 * account. An order copies the customer's terms when it is created and keeps them, so a customer
 * moved off credit terms would otherwise still be offered "Add to my account" on old orders. The
 * account option needs the CUSTOMER's current terms set and not in custscript_cdb_prepay_terms, AND
 * the ORDER's terms blank or not in that list. Every doubt — either parameter empty, the extras
 * search failed, blank customer terms — means pay up front.
 *
 * THE RELEASED EXCEPTION (1.3, Steve 1 Oct 2026) — THE DASHBOARD'S ONLY. When payment arrives,
 * staff set the Record Status to "Release to Warehouse", which is in the excluded list, so a just-paid
 * order vanished from the dashboard. An order whose Record Status is in custscript_cdb_released_statuses
 * counts as open EVEN THOUGH it is also excluded; every other rule (opportunity link, native status,
 * quote type) still applies. NS-Opportunity-SO-Sync's excluded list is NOT changed by this and still
 * means "don't evaluate readiness". Applied in isOpenOrder() and in recordStatusFilter().
 *
 * RECENTLY DELIVERED (1.3): getRecentlyDelivered() is one more search per page, for shipped orders
 * (native F/G) delivered in the last custscript_cdb_recent_days days. Like every other section it
 * works through the CUSTOMER'S OPPORTUNITIES (1.3.1), not the order's own entity: the opportunity
 * IDs getProjects() already loaded. No opportunities, no search. It deliberately does NOT apply
 * the excluded list — shipped orders usually carry a completed Record Status — only the optional
 * custscript_cdb_recent_hidden_statuses. A failure logs CDB RECENT_FAILED and returns no rows.
 *
 * EMAILS TO THE CUSTOMER (2.0) share two rules, so the customer sees the same person and the same
 * inbox everywhere: emailRecipient() — the dashboard contact's email, else the customer's email —
 * and emailAuthor() — the customer's sales rep if active, else the fallback employee. The digest
 * and the Send delivery link Suitelet both use them. 2.0.2: emailAuthor() also reads the author's
 * firstname and custentity_employee_photo_link in the SAME lookup, and emailAm() turns the author
 * into the email card's account manager — the Send Quote 2.2.0 card — logging CDB AM_PHOTO once per
 * email (photo used, or skipped and why). orderCustomer() gives the customer an order
 * belongs to for links: its OPPORTUNITY's customer (the guard's rule), never the order's entity.
 *
 * The pure functions — isOpenOrder, orderState, groupProjects, resolveRecipient,
 * validateDelivery, amountToPay, isPrepay, decorateOrder — take plain rows and are node-tested (test/grouping.test.js,
 * test/validation.test.js). The search functions only fetch and shape.
 *
 * "TELL US WHERE YOU'RE UP TO" (2.1, release 2.1 part B): guardOpportunity() — the opportunity is
 * the token's customer's and neither Won nor Lost — and the pure parts of the update action:
 * validateUpdate(), stageOptions(), lostStatusFor(), versionAtLeast(). Still read-only: the writes go
 * through the Online-quote Update Opportunity library, called from the Suitelet.
 *
 * RELEASE 2.2: the project name — validateUpdate() also takes projectName (trimmed, control characters
 * stripped, <= 60, blank never clears, a change only when it differs) and writeProjectName() writes the
 * title alone, ITSELF (title is not one of the Online-quote library's FIELDS, and the library is not
 * extended: its FIELDS feed the Send Quote and Update Opportunity pages). And "Add a new address…" —
 * validateDelivery() takes address=new with addr1, addr2, city, county and zip (normalisePostcode() for
 * the UK format), matchAddress() finds the same address already in the book (line 1 and postcode,
 * normalised), addToAddressBook() adds it, and writeDeliveryAddress() keeps it on the opportunity.
 *
 * 2.2.1 (PR #8 amendment 1): "Your project details" — validateUpdate() takes siteAddress beside projectName,
 * with the same rules (<= 300), only when the page offered it; writeProjectName() becomes
 * writeProjectDetails(oppId, { title, siteAddress }), ONE submitFields of the changed ones of title and
 * custbody_opp_site_adress and never anything else. siteAddressLine() is the stored address as one line
 * (newlines -> ", "), the form's prefill and what a post is compared with.
 *
 * 2.2.2 (PR #8 amendment 2): the site address is always offered. custbody_opp_site_adress is Long Text
 * (confirmed in Production, 2 Oct 2026), so 2.2.1's runtime type check — siteAddressFieldType(),
 * isTextFieldType() and the opportunity load behind them — is gone.
 *
 * 2.2.3 ("Request an update" part A): customersWithOpenOpportunity() and customersWithOpenOrder() — the
 * digest's LIVE input searches, moved here UNCHANGED from cdb_mr_digest.js so the link backfill's OPEN
 * scope uses the same definition of an open customer and the two cannot drift.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * 2.3.0 (release 2.3, "Tell us about your property"): the design information page's reads and writes.
 *   guardDesignInfo()     one lookupFields: the token's customer's, Won, sub-status NEEDINFO (edit) or DESIGN
 *                         (view), FC not none. Not guardOpportunity(), which refuses Won.
 *   loadRegistry()        the registry CSV from the File Cabinet (file.load by path, once per execution).
 *   loadDesignInfo()      ONE record.load (dynamic, read-only, never saved: getSelectOptions() needs it) that
 *                         discovers each registry field's type and reads its current value; a missing field is
 *                         omitted, a mismatched one read-only; nothing is ever written to an unverified field.
 *   validateDesignInfo()  pure: every posted answer and file, before anything is written.
 *   writeDesignInfo()     ONE submitFields of the changed, non-empty, allowed fields (+ the state); blank never
 *                         clears. saveUpload() / attachUpload(): the customer's files.
 *   getOpportunityExtras() the fail-safe extras search for the card states (CDB OPP_EXTRAS_FAILED);
 *                         decorateDesign() turns it into each design row's card.
 *   designInfoRequest()   the request button's and the Send design information Suitelet's one lookup and checks.
 * dateInputError() is the update page's date rule, shared (validateUpdate() calls it; its behaviour is unchanged).
 *
 * 2.3.1 (amendment 2): a CHECKBOX yesno reads an unticked box as "no" (a real answer), so a "No" is remembered and a
 * required checkbox question can be done; RICHTEXT is no longer a target type (customer text there would render as
 * HTML for staff: such a row is now a type mismatch, read-only and reported); the request rule reads FC_MAP only
 * (designinfo.parseFcMapOnly()), so the User Event needs no other map.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 2.3.1
 */
define(['N/search', 'N/record', 'N/format', 'N/log', 'N/file', './cdb_lib_config', './cdb_lib_dates',
    './cdb_lib_designinfo'],
    function (search, record, format, log, file, config, dates, designinfo) {

    'use strict';

    var VERSION = '2.3.1';

    var OPP = config.FIELDS.OPPORTUNITY;
    var SO = config.FIELDS.SALES_ORDER;
    var CUST = config.FIELDS.CUSTOMER;
    var NEW_ADDRESS = config.NEW_ADDRESS;

    var STATES = {
        BOOKED: 'booked',
        AWAITING_PAYMENT: 'awaiting_payment',
        REQUESTED: 'requested',
        RELEASED: 'released',
        DELIVERED: 'delivered',
        READY: 'ready',
        NEEDS_INFO: 'needs_info'
    };

    /**
     * The design rows' card states. groupProjects() sets the first and last from the sub-status; 2.3.0's
     * decorateDesign() widens them from the state JSON (cdb_lib_designinfo.cardState()).
     */
    var DESIGN_BADGES = {
        NEEDS_INFO: 'needs_info',
        INFO_PARTIAL: 'info_partial',
        INFO_SENT: 'info_sent',
        DESIGNING: 'designing'
    };

    var PAYMENT = { BACS: 'BACS', CARD: 'CARD', ACCOUNT: 'ACCOUNT' };

    /** Why the guard refused. The customer sees a short notice, never these. */
    var GUARD = {
        NOT_FOUND: 'order not found, or its native status cannot ship',
        NOT_YOURS: 'order belongs to another customer',
        NOT_OPEN: 'order is not open (Record Status or quote type excluded, or no opportunity)',
        BOOKED: 'delivery already confirmed (custbody_del_date set)',
        ALREADY_REQUESTED: 'delivery already requested (custbody_cust_pay_intent set)',
        NOT_READY: 'order is not ready for delivery',
        RELEASED: 'order is released to the warehouse (Record Status in custscript_cdb_released_statuses)'
    };

    /** 2.1: why guardOpportunity() refused. The customer sees a short notice, never these. */
    var GUARD_OPP = {
        NOT_FOUND: 'opportunity not found',
        NOT_YOURS: 'opportunity belongs to another customer',
        WON: 'opportunity is Won (WON_STATUSES)',
        LOST: 'opportunity is Lost (LOST_STATUSES)'
    };

    /** 2.3.0: why guardDesignInfo() refused. Logged; the customer sees a short page, never these. */
    var GUARD_DI = {
        NOT_FOUND: 'opportunity not found',
        NOT_YOURS: 'opportunity belongs to another customer',
        NOT_WON: 'opportunity is not Won (WON_STATUSES)',
        SUBSTATUS: 'sub-status in neither NEEDINFO_SUBSTATUS nor DESIGN_SUBSTATUS',
        FC_NONE: 'FC maps to none in FC_MAP (nothing needed from the customer)'
    };

    /** 2.1: the two update-page modes posted as `mode`. */
    var UPDATE_MODE = { UPDATE: 'update', NOT_GOING: 'notgoing' };

    // ---------------------------------------------------------------- pure

    /** Named entities the quote description is known to carry, plus the common ones. */
    var NAMED_ENTITIES = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', pound: '\u00a3',
        euro: '\u20ac', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', lsquo: '\u2018',
        rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022', middot: '\u00b7',
        deg: '\u00b0', times: '\u00d7', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
        frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', sup2: '\u00b2', sup3: '\u00b3'
    };

    /** A code point as a string, surrogate pairs included (ES5 has no fromCodePoint). */
    function fromCodePoint(code) {
        if (!(code > 0 && code <= 0x10FFFF) || (code >= 0xD800 && code <= 0xDFFF)) {
            return '';
        }
        if (code <= 0xFFFF) {
            return String.fromCharCode(code);
        }
        code -= 0x10000;
        return String.fromCharCode(0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF));
    }

    /**
     * Pure: decodes HTML entities ONCE — named, &#nnn; and &#xhh;. An unknown named entity is
     * left as it is.
     */
    function decodeEntities(text) {
        return String(text).replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
            function (whole, body) {
                if (body.charAt(0) === '#') {
                    return fromCodePoint(body.charAt(1) === 'x' || body.charAt(1) === 'X' ?
                        parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10));
                }
                return NAMED_ENTITIES.hasOwnProperty(body) ? NAMED_ENTITIES[body] : whole;
            });
    }

    /**
     * Pure: the quote description as plain text, as Send Quote cleans it:
     * decode entities -> strip tags -> collapse whitespace. DECODE BEFORE STRIPPING, never after:
     * "&lt;b&gt;" must become "<b>" and then be stripped, not survive as text. The result is NOT
     * escaped; the renderer escapes it exactly once.
     *
     * @param {*} raw
     * @returns {string}
     */
    function cleanDescription(raw) {
        if (raw === null || raw === undefined) {
            return '';
        }
        return decodeEntities(String(raw))
            .replace(/<[^>]*>/g, ' ')
            .replace(/[\s\u00a0]+/g, ' ')
            .replace(/^ +| +$/g, '');
    }

    function trim(value) {
        return String(value === null || value === undefined ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    /**
     * Pure (2.2): one line of text a customer typed — every control character (C0, DEL, C1: tabs and
     * newlines included) becomes a space, then the ends are trimmed. Counted against its limit after this.
     */
    function cleanLine(value) {
        return trim(String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' '));
    }

    /**
     * @param {string[]} list
     * @param {*} id
     * @returns {boolean}
     */
    function contains(list, id) {
        var needle = trim(id);
        var i;
        if (needle === '') {
            return false;
        }
        for (i = 0; i < (list || []).length; i++) {
            if (String(list[i]) === needle) {
                return true;
            }
        }
        return false;
    }

    /**
     * Rules 1, 3 and 4 of "open" (rule 2 is the search filter). Pure.
     *
     * @param {Object} order - { opportunityId, recordStatus, quoteType }
     * @param {Object} cfg
     * @returns {boolean}
     */
    function isOpenOrder(order, cfg) {
        if (trim(order.opportunityId) === '') {
            return false;
        }
        // 1.3: a released Record Status stays open although it is in the excluded list.
        if (contains(cfg.EXCLUDED_STATUSES, order.recordStatus) && !isReleased(order, cfg)) {
            return false;
        }
        if (contains(cfg.EXCLUDED_QUOTE_TYPES, order.quoteType)) {
            return false;
        }
        return true;
    }

    /**
     * The state of an open order's row, in the brief's order. Pure.
     *
     * @param {Object} order - { confirmedDateKey, payIntent, ready }
     * @returns {string} one of STATES
     */
    /** Pure (1.3): is the order's Record Status a released one? */
    function isReleased(order, cfg) {
        return !!cfg && contains(cfg.RELEASED_STATUSES, order.recordStatus);
    }

    /**
     * Pure. Precedence (1.3): booked (confirmed date) -> released (Record Status) -> requested
     * (Add to account) -> awaiting payment (any other intent) -> ready -> needs info. The state never
     * comes from custbody_cdb_awaiting_payment: a released or booked order shows no payment panel.
     */
    function orderState(order, cfg) {
        if (trim(order.confirmedDateKey) !== '') {
            return STATES.BOOKED;
        }
        if (isReleased(order, cfg)) {
            return STATES.RELEASED;
        }
        // 1.2: an Add-to-account booking has nothing to pay; it is requested, not awaiting payment.
        if (cfg && trim(cfg.PAY_ACCOUNT) !== '' && trim(order.payIntent) === String(cfg.PAY_ACCOUNT)) {
            return STATES.REQUESTED;
        }
        if (trim(order.payIntent) !== '') {
            return STATES.AWAITING_PAYMENT;
        }
        if (order.ready === true) {
            return STATES.READY;
        }
        return STATES.NEEDS_INFO;
    }

    /**
     * Groups a customer's opportunities and orders into the three sections. Pure.
     *
     * @param {Object[]} opps - { id, title, siteAddress, status, subStatus, ... }
     * @param {Object[]} orders - { id, opportunityId, recordStatus, quoteType, ... }
     * @param {Object} cfg
     * @returns {{toOrder: Object[], inDesign: Object[], forDelivery: Object[], anyReady: boolean,
     *            isEmpty: boolean}}
     *   inDesign rows carry badge (DESIGN_BADGES); forDelivery rows are
     *   { opp, orders: [{ order, state }] }
     */
    function groupProjects(opps, orders, cfg) {
        var result = { toOrder: [], inDesign: [], forDelivery: [], anyReady: false, isEmpty: true };
        var ordersByOpp = {};
        var i;
        var j;
        var opp;
        var order;
        var rows;
        var state;

        for (i = 0; i < (orders || []).length; i++) {
            order = orders[i];
            if (!isOpenOrder(order, cfg)) {
                continue;
            }
            if (!ordersByOpp[order.opportunityId]) {
                ordersByOpp[order.opportunityId] = [];
            }
            ordersByOpp[order.opportunityId].push(order);
        }

        for (i = 0; i < (opps || []).length; i++) {
            opp = opps[i];
            if (contains(cfg.LOST_STATUSES, opp.status)) {
                continue;
            }
            if (!contains(cfg.WON_STATUSES, opp.status)) {
                result.toOrder.push(opp);
                continue;
            }
            if (contains(cfg.DESIGN_SUBSTATUS, opp.subStatus)) {
                result.inDesign.push({
                    opp: opp,
                    badge: contains(cfg.NEEDINFO_SUBSTATUS, opp.subStatus) ?
                        DESIGN_BADGES.NEEDS_INFO : DESIGN_BADGES.DESIGNING
                });
                continue;
            }
            if (contains(cfg.DELIVERY_SUBSTATUS, opp.subStatus) && ordersByOpp[opp.id]) {
                rows = [];
                for (j = 0; j < ordersByOpp[opp.id].length; j++) {
                    state = orderState(ordersByOpp[opp.id][j], cfg);
                    if (state === STATES.READY) {
                        result.anyReady = true;
                    }
                    rows.push({ order: ordersByOpp[opp.id][j], state: state });
                }
                result.forDelivery.push({ opp: opp, orders: rows });
            }
            // Any other won opportunity (delivered, or a sub-status in neither list) is not shown.
        }

        result.isEmpty = !result.toOrder.length && !result.inDesign.length &&
            !result.forDelivery.length;
        return result;
    }

    /**
     * Who gets the Task, and whose name heads the page (brief C6). Pure.
     *
     * @param {Object} opp - { valueProposition, pe, salesRep }
     * @param {Object} cfg - PE_VALUEPROPS (may be empty), FALLBACK_EMPLOYEE
     * @returns {{employeeId: string, source: string}} source 'pe' | 'salesrep' | 'fallback'
     */
    function resolveRecipient(opp, cfg) {
        if (contains(cfg.PE_VALUEPROPS, opp.valueProposition) && trim(opp.pe) !== '') {
            return { employeeId: trim(opp.pe), source: 'pe' };
        }
        if (trim(opp.salesRep) !== '') {
            return { employeeId: trim(opp.salesRep), source: 'salesrep' };
        }
        return { employeeId: String(cfg.FALLBACK_EMPLOYEE), source: 'fallback' };
    }

    /**
     * The opportunity whose account manager heads the page: the first in delivery, then design,
     * then to-order order. Pure.
     * @returns {Object|null}
     */
    function headerOpportunity(groups) {
        if (groups.forDelivery.length) {
            return groups.forDelivery[0].opp;
        }
        if (groups.inDesign.length) {
            return groups.inDesign[0].opp;
        }
        if (groups.toOrder.length) {
            return groups.toOrder[0];
        }
        return null;
    }

    /** Pure: loose but useful. One @, something each side, a dot in the domain, no spaces. */
    function looksLikeEmail(value) {
        return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>".]+$/.test(value);
    }

    /**
     * Validates the delivery form. Pure.
     *
     * @param {Object} input - raw strings: date, time, address, vehicle, unload, contactName,
     *                         contactPhone, contactEmail, requests, payment ('BACS' | 'CARD'); 2.2: address
     *                         may be config.NEW_ADDRESS.VALUE, with addr1, addr2, city, county, zip
     * @param {Object} ctx - { todayKey, noticeDays, holidays (set), horizonMonths, timeIds,
     *                         vehicleIds, unloadIds, addressIds, payBacs, payCard }
     * @returns {{ok: boolean, errors: Object, values: Object}}
     *   errors keyed by input name; values cleaned, with payIntent set to the list ID; 2.2: newAddress
     *   { addr1, addr2, city, county, zip (normalised) } when the new address was chosen, else null
     */
    function validateDelivery(input, ctx) {
        var errors = {};
        var values = {};
        var limits = config.TEXT_LIMITS;
        var key;

        values.date = trim(input.date);
        if (!dates.isAllowedDate(values.date, ctx.todayKey, ctx.noticeDays, ctx.holidays,
                ctx.horizonMonths)) {
            errors.date = 'Please choose one of the available dates.';
        }

        values.time = trim(input.time);
        if (!contains(ctx.timeIds, values.time)) {
            errors.time = 'Please choose a delivery time.';
        }
        values.address = trim(input.address);
        // 2.2: "Add a new address…". Its fields are cleaned always (so they come back on a rejected
        // form) and REQUIRED ONLY when that option was posted.
        values.addr1 = cleanLine(input.addr1);
        values.addr2 = cleanLine(input.addr2);
        values.city = cleanLine(input.city);
        values.county = cleanLine(input.county);
        values.zip = cleanLine(input.zip);
        values.newAddress = null;
        if (values.address === NEW_ADDRESS.VALUE) {
            values.newAddress = newAddressOf(values, errors);
        } else if (!contains(ctx.addressIds, values.address)) {
            errors.address = 'Please choose a delivery address.';
        }
        values.vehicle = trim(input.vehicle);
        if (!contains(ctx.vehicleIds, values.vehicle)) {
            errors.vehicle = 'Please choose the vehicle that can reach the site.';
        }
        values.unload = trim(input.unload);
        if (!contains(ctx.unloadIds, values.unload)) {
            errors.unload = 'Please choose how the delivery will be unloaded.';
        }

        values.contactName = trim(input.contactName);
        if (values.contactName === '') {
            errors.contactName = 'Please give the name of the person on site.';
        } else if (values.contactName.length > limits.CONTACT_NAME) {
            errors.contactName = 'Please keep this under ' + limits.CONTACT_NAME + ' characters.';
        }
        values.contactPhone = trim(input.contactPhone);
        if (values.contactPhone === '') {
            errors.contactPhone = 'Please give a phone number for the person on site.';
        } else if (values.contactPhone.length > limits.CONTACT_PHONE ||
                !/^[0-9+() \-]{6,}$/.test(values.contactPhone)) {
            errors.contactPhone = 'Please check the phone number.';
        }
        values.contactEmail = trim(input.contactEmail);
        if (values.contactEmail !== '' && (values.contactEmail.length > limits.CONTACT_EMAIL ||
                !looksLikeEmail(values.contactEmail))) {
            errors.contactEmail = 'Please check the email address.';
        }

        // Newlines normalised before counting, so the limit matches what the field will hold.
        values.requests = String(input.requests === null || input.requests === undefined ?
            '' : input.requests).replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '');
        if (values.requests.length > limits.SPECIAL_REQUESTS) {
            errors.requests = 'Please keep this under ' + limits.SPECIAL_REQUESTS + ' characters.';
        }

        // 1.2: only the options this order was offered. A tampered CARD from an account order, or
        // ACCOUNT from a pay-up-front one, is a field error and nothing is written.
        values.payment = trim(input.payment).toUpperCase();
        if (!contains(ctx.paymentOptions || [PAYMENT.BACS, PAYMENT.CARD], values.payment)) {
            errors.payment = values.payment === '' ? 'Please choose how you would like to pay.' :
                'Please choose one of the payment options shown.';
        } else if (values.payment === PAYMENT.BACS) {
            values.payIntent = String(ctx.payBacs);
        } else if (values.payment === PAYMENT.CARD) {
            values.payIntent = String(ctx.payCard);
        } else {
            values.payIntent = String(ctx.payAccount);
        }

        for (key in errors) {
            if (errors.hasOwnProperty(key)) {
                return { ok: false, errors: errors, values: values };
            }
        }
        return { ok: true, errors: errors, values: values };
    }

    // ---------------------------------------------------------------- 2.2: a new delivery address

    /**
     * Pure (2.2): a UK postcode, tolerant of case and spaces, as stored — upper case with one space before
     * the inward code ("sw1a1aa" -> "SW1A 1AA"). '' when it is not postcode-shaped.
     */
    function normalisePostcode(value) {
        var text = cleanLine(value).replace(/\s+/g, '').toUpperCase();
        if (!/^(GIR0AA|[A-Z]{1,2}[0-9][0-9A-Z]?[0-9][A-Z]{2})$/.test(text)) {
            return '';
        }
        return text.slice(0, -3) + ' ' + text.slice(-3);
    }

    /** Pure (2.2): text for comparing addresses — lower case, letters and digits only. */
    function addressKey(value) {
        return trim(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    /**
     * Pure (2.2): the new address's rules, on values already cleaned by validateDelivery(). Errors keyed
     * by input name. Returns the address to write: { addr1, addr2, city, county, zip } (zip normalised).
     */
    function newAddressOf(values, errors) {
        var limits = config.TEXT_LIMITS;
        var zip = normalisePostcode(values.zip);
        if (values.addr1 === '') {
            errors.addr1 = 'Please give the first line of the address.';
        } else if (values.addr1.length > limits.ADDR_LINE) {
            errors.addr1 = 'Please keep this under ' + limits.ADDR_LINE + ' characters.';
        }
        if (values.addr2.length > limits.ADDR_LINE) {
            errors.addr2 = 'Please keep this under ' + limits.ADDR_LINE + ' characters.';
        }
        if (values.city === '') {
            errors.city = 'Please give the town or city.';
        } else if (values.city.length > limits.ADDR_CITY) {
            errors.city = 'Please keep this under ' + limits.ADDR_CITY + ' characters.';
        }
        if (values.county.length > limits.ADDR_COUNTY) {
            errors.county = 'Please keep this under ' + limits.ADDR_COUNTY + ' characters.';
        }
        if (values.zip === '') {
            errors.zip = 'Please give the postcode.';
        } else if (!zip) {
            errors.zip = 'Please check the postcode, for example SW1A 1AA.';
        }
        return { addr1: values.addr1, addr2: values.addr2, city: values.city, county: values.county, zip: zip };
    }

    /** Pure (2.2): the address's lines, blanks left out — line 1, line 2, town, county, postcode. */
    function addressLines(a) {
        return [a.addr1, a.addr2, a.city, a.county, a.zip].filter(function (x) { return trim(x) !== ''; });
    }

    /**
     * Pure (2.2): the line of the address book that IS this address — the same line 1 and postcode once
     * normalised (case, spaces, punctuation) — or null. A line whose line 1 or postcode could not be read
     * never matches, so the worst case is a second line, never the wrong one.
     * @param {Array<{id, addr1, zip}>} book - getAddressBook()
     */
    function matchAddress(book, a) {
        var line1 = addressKey(a.addr1);
        var zip = addressKey(a.zip);
        var i;
        if (line1 === '' || zip === '') {
            return null;
        }
        for (i = 0; i < (book || []).length; i++) {
            if (addressKey(book[i].addr1) === line1 && addressKey(book[i].zip) === zip) {
                return book[i];
            }
        }
        return null;
    }

    /** Pure (2.2): "Added by customer (dashboard) 01/10/2026", the new line's label. */
    function addressLabel(todayKey) {
        return NEW_ADDRESS.LABEL + ' ' + slashDate(todayKey);
    }

    // ---------------------------------------------------------------- 2.1: tell us where you're up to

    /**
     * Pure (2.1): is version at least min? Both 'x.y.z' (more or fewer parts are compared part by part,
     * a missing part counting 0). Anything that is not dot-separated whole numbers is false.
     * @returns {boolean}
     */
    function versionAtLeast(version, min) {
        var a = trim(version);
        var b = trim(min);
        var pa;
        var pb;
        var i;
        var x;
        var y;
        if (!/^\d+(\.\d+)*$/.test(a) || !/^\d+(\.\d+)*$/.test(b)) {
            return false;
        }
        pa = a.split('.');
        pb = b.split('.');
        for (i = 0; i < Math.max(pa.length, pb.length); i++) {
            x = i < pa.length ? parseInt(pa[i], 10) : 0;
            y = i < pb.length ? parseInt(pb[i], 10) : 0;
            if (x !== y) {
                return x > y;
            }
        }
        return true;
    }

    /**
     * Pure (2.1): the options to offer, in the order of ids — the field's own options (from the
     * library's fieldOptions) that are in the setting. An id the field does not offer is missing.
     * @param {Array<{id: string, text: string}>} options
     * @param {string[]} ids - the setting, in display order; [] hides the question
     * @returns {{options: Array<{id: string, text: string}>, missing: string[]}}
     */
    function stageOptions(options, ids) {
        var byId = {};
        var result = { options: [], missing: [] };
        var i;
        for (i = 0; i < (options || []).length; i++) {
            byId[String(options[i].id)] = options[i];
        }
        for (i = 0; i < (ids || []).length; i++) {
            if (byId.hasOwnProperty(String(ids[i])) && String(ids[i]) !== '') {
                result.options.push({ id: String(ids[i]), text: String(byId[String(ids[i])].text) });
            } else {
                result.missing.push(String(ids[i]));
            }
        }
        return result;
    }

    /**
     * Pure (2.1): a customer's stage as UPD_LOST_STATUS_MAP keys it — 'LEAD', 'PROSPECT' or 'CUSTOMER'
     * — from the raw lookup value ('CUSTOMER', '_customer', 'Customer'…). '' when it is none of them.
     */
    function normaliseStage(raw) {
        var text = trim(raw).replace(/^_+/, '').toUpperCase();
        return config.CUSTOMER_STAGES.indexOf(text) >= 0 ? text : '';
    }

    /**
     * Pure (2.1): the Lost status to set for a customer at this stage, or why none is set. FAIL CLOSED:
     * never another stage's status (an opportunity status belongs to a stage, and setting a Customer-stage
     * status on a prospect's opportunity can move the prospect to Customer).
     *
     * @param {string} stage - normaliseStage()'s result ('' unknown)
     * @param {{status: string, map: Object}} parsed - config.parseLostStatusMap()
     * @param {Object} cfg - LOST_STATUSES
     * @returns {{statusId: string, why: string}} statusId '' with why when not set
     */
    function lostStatusFor(stage, parsed, cfg) {
        var id;
        if (!parsed || parsed.status === 'empty') {
            return { statusId: '', why: 'setting empty' };
        }
        if (parsed.status !== 'ok') {
            return { statusId: '', why: 'setting invalid' };
        }
        if (!stage) {
            return { statusId: '', why: 'customer stage unknown' };
        }
        id = parsed.map[stage];
        if (!id) {
            return { statusId: '', why: 'no status set for stage ' + stage };
        }
        // A mapped status that the dashboard does not count as Lost would neither hide the project nor
        // be a Lost status: a typo, so nothing is written.
        if (!contains(cfg.LOST_STATUSES, id)) {
            return { statusId: '', why: 'status ' + id + ' for stage ' + stage + ' is not in LOST_STATUSES' };
        }
        return { statusId: id, why: '' };
    }

    /** Pure (2.1): a yyyy-mm-dd key as dd/mm/yyyy (the objection's context line). */
    function slashDate(key) {
        var k = trim(key);
        return /^\d{4}-\d{2}-\d{2}$/.test(k) ? k.slice(8, 10) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4) : '';
    }

    /**
     * Pure (2.3.0; the update page's rule, moved here unchanged): a CHANGED date from an <input type="date"> —
     * yyyy-mm-dd, a real date, today to five years ahead. '' when it is fine, else the message. The caller skips
     * it for an unchanged value (an unchanged past date is accepted).
     * @param {string} value - trimmed
     * @param {string} todayKey
     * @returns {string}
     */
    function dateInputError(value, todayKey) {
        var lastKey = dates.addMonths(todayKey, 60);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !dates.isValidKey(value)) {
            return 'Please enter a date, for example 15/03/2027.';
        }
        if (value < todayKey || value > lastKey) {
            return 'Please choose a date from today onwards, within five years.';
        }
        return '';
    }

    /** Pure: text with newlines normalised and trimmed, the way the limits are counted. */
    function longText(value) {
        return String(value === null || value === undefined ? '' : value).replace(/\r\n?/g, '\n')
            .replace(/^\s+|\s+$/g, '');
    }

    /** Pure: the delivery form's phone rule. */
    function phoneOk(value) {
        return value.length <= config.TEXT_LIMITS.CONTACT_PHONE && /^[0-9+() \-]{6,}$/.test(value);
    }

    /**
     * Pure (2.2.1): the stored site address as one line — each newline and the space around it becomes ", ",
     * then cleanLine(). What the update page prefills (a single-line input cannot hold a newline) and what a
     * post is compared with, so an untouched address is never "changed".
     */
    function siteAddressLine(value) {
        return cleanLine(String(value === null || value === undefined ? '' : value).replace(/\s*\r?\n\s*/g, ', '));
    }

    /**
     * Pure (2.2.1): one "Your project details" line, by the project name's rules — cleanLine(); equal to the
     * current value: no change and no error; over the limit: an error; blank: no change (blank never clears).
     * Sets errors[key] or changes[key].
     * @returns {string} the cleaned value
     */
    function detailLine(raw, currentLine, limit, key, errors, changes) {
        var value = cleanLine(raw);
        if (value === '' || value === currentLine) {
            return value;
        }
        if (value.length > limit) {
            errors[key] = 'Please keep this under ' + limit + ' characters.';
        } else {
            changes[key] = value;
        }
        return value;
    }

    /**
     * Validates the "Tell us where you're up to" POST. Pure. NOTHING IS WRITTEN unless ok.
     *
     * Update mode: the stage (blank or one of the offered IDs), the date (blank, or a real date — when it
     * differs from the current one, from today to five years ahead), the note (<= 1,000), and the call
     * request (phone required and phone-shaped, best time one of CALL_TIMES) — the phone and time only
     * when the box is ticked. changes holds only the values that differ from the current ones; blank never
     * clears. nothing is true when there is no change, no note and no call.
     *
     * Not-going-ahead mode: confirm must be 'yes' (the confirm button's own value: the two-step rule), the
     * reason blank or one of the offered IDs, the comment <= 1,000.
     *
     * 2.2: update mode also takes projectName — cleanLine() (trimmed, control characters out), <= 60. Blank
     * never clears the title; it is a change only when it differs from current.title.
     *
     * 2.2.1: and siteAddress (2.2.2: always), by the same rules, <= 300, compared with
     * siteAddressLine(current.siteAddress). For both, a value equal to the current one
     * is never an error, so an untouched prefill always posts cleanly.
     *
     * @param {Object} input - raw strings: mode, projectName, siteAddress, buildStage, delDate, note, call, phone,
     *                         callTime, reason, comment, confirm
     * @param {Object} ctx - { stageIds (offered; [] hidden), showDate, current: { title,
     *                         siteAddress, buildStage, delDateKey }, reasonIds (offered; [] none), todayKey }
     * @returns {{ok: boolean, mode: string, errors: Object, values: Object, changes: Object, nothing: boolean}}
     */
    function validateUpdate(input, ctx) {
        var errors = {};
        var values = {};
        var changes = {};
        var current = ctx.current || {};
        var limits = config.TEXT_LIMITS;
        var mode = trim(input.mode) === UPDATE_MODE.NOT_GOING ? UPDATE_MODE.NOT_GOING : UPDATE_MODE.UPDATE;
        var dateError;
        var key;

        if (mode === UPDATE_MODE.NOT_GOING) {
            values.reason = trim(input.reason);
            if (values.reason !== '' && !contains(ctx.reasonIds, values.reason)) {
                errors.reason = 'Please choose one of the reasons shown.';
            }
            values.comment = longText(input.comment);
            if (values.comment.length > limits.UPDATE_COMMENT) {
                errors.comment = 'Please keep this under ' + limits.UPDATE_COMMENT + ' characters.';
            }
            values.confirm = trim(input.confirm) === 'yes';
            if (!values.confirm) {
                errors.confirm = 'Please press “Confirm: we’ve decided not to go ahead”.';
            }
        } else {
            values.projectName = detailLine(input.projectName, cleanLine(current.title), limits.PROJECT_NAME,
                'projectName', errors, changes);
            values.siteAddress = detailLine(input.siteAddress, siteAddressLine(current.siteAddress),
                limits.SITE_ADDRESS, 'siteAddress', errors, changes);

            values.buildStage = (ctx.stageIds || []).length ? trim(input.buildStage) : '';
            if (values.buildStage !== '' && !contains(ctx.stageIds, values.buildStage)) {
                errors.buildStage = 'Please choose one of the stages shown.';
            } else if (values.buildStage !== '' && values.buildStage !== trim(current.buildStage)) {
                changes.buildStage = values.buildStage;
            }

            values.delDate = ctx.showDate ? trim(input.delDate) : '';
            if (values.delDate !== '' && values.delDate !== trim(current.delDateKey)) {
                // 2.3.0: the rule moved, unchanged, to dateInputError(), shared with the design information page.
                dateError = dateInputError(values.delDate, ctx.todayKey);
                if (dateError) {
                    errors.delDate = dateError;
                } else {
                    changes.delDate = values.delDate;
                }
            }

            values.note = longText(input.note);
            if (values.note.length > limits.UPDATE_NOTE) {
                errors.note = 'Please keep this under ' + limits.UPDATE_NOTE + ' characters.';
            }

            values.call = trim(input.call) === 'T';
            values.phone = trim(input.phone);
            values.callTime = trim(input.callTime).toUpperCase();
            if (values.call) {
                if (values.phone === '') {
                    errors.phone = 'Please give a phone number we can call.';
                } else if (!phoneOk(values.phone)) {
                    errors.phone = 'Please check the phone number.';
                }
                if (!config.CALL_TIMES.hasOwnProperty(values.callTime)) {
                    errors.callTime = 'Please choose the best time to call.';
                }
            }
        }

        for (key in errors) {
            if (errors.hasOwnProperty(key)) {
                return { ok: false, mode: mode, errors: errors, values: values, changes: {}, nothing: false };
            }
        }
        return {
            ok: true, mode: mode, errors: errors, values: values, changes: changes,
            nothing: mode === UPDATE_MODE.UPDATE && !changes.projectName && !changes.siteAddress && !changes.buildStage &&
                !changes.delDate &&
                values.note === '' && !values.call
        };
    }

    // ---------------------------------------------------------------- 1.3: released and delivered

    /**
     * Pure: the Record Status part of a search filter for "open". Without released statuses it is
     * today's (RS noneof excluded OR RS empty); with them it gains "OR RS anyof released".
     * @returns {Array} a filter expression
     */
    function recordStatusFilter(cfg) {
        var expr = [[SO.RECORD_STATUS, 'anyof', '@NONE@'], 'OR', [SO.RECORD_STATUS, 'noneof', cfg.EXCLUDED_STATUSES]];
        if ((cfg.RELEASED_STATUSES || []).length) {
            expr = expr.concat(['OR', [SO.RECORD_STATUS, 'anyof', cfg.RELEASED_STATUSES]]);
        }
        return expr;
    }

    /**
     * Customers with an open opportunity: not Lost, and either not Won, or Won at a design or
     * delivery sub-status. The same opportunities the dashboard shows. Grouped by customer.
     * 2.2.3: moved unchanged from cdb_mr_digest.js; the digest and the link backfill both use it.
     * @returns {Object} set of customer IDs
     */
    function customersWithOpenOpportunity(cfg) {
        var set = {};
        collect(search.create({
            type: search.Type.OPPORTUNITY,
            // No mainline: the opportunity search rejects it. See getOpportunities().
            filters: [
                [OPP.STATUS, 'noneof', cfg.LOST_STATUSES], 'AND',
                [[OPP.STATUS, 'noneof', cfg.WON_STATUSES], 'OR',
                    [OPP.SUB_STATUS, 'anyof', cfg.DESIGN_SUBSTATUS.concat(cfg.DELIVERY_SUBSTATUS)]]
            ],
            columns: [search.createColumn({ name: 'entity', summary: search.Summary.GROUP })]
        }), function (r) {
            set[String(r.getValue({ name: 'entity', summary: search.Summary.GROUP }))] = true;
        });
        return set;
    }

    /**
     * Customers with an open sales order: every rule of "open" (this file's header), including the
     * addendum's native status filter. Grouped by the order's own customer.
     * 2.2.3: moved unchanged from cdb_mr_digest.js; the digest and the link backfill both use it.
     * @returns {Object} set of customer IDs
     */
    function customersWithOpenOrder(cfg) {
        var set = {};
        collect(search.create({
            type: search.Type.SALES_ORDER,
            // 1.3: recordStatusFilter() carries the released exception when the list is set.
            filters: openOrderFilters().concat([
                'AND', recordStatusFilter(cfg),
                'AND', [[SO.QUOTE_TYPE, 'anyof', '@NONE@'], 'OR',
                    [SO.QUOTE_TYPE, 'noneof', cfg.EXCLUDED_QUOTE_TYPES]]
            ]),
            columns: [search.createColumn({ name: 'entity', summary: search.Summary.GROUP })]
        }), function (r) {
            set[String(r.getValue({ name: 'entity', summary: search.Summary.GROUP }))] = true;
        });
        return set;
    }

    /**
     * Pure: an order's delivery date — the confirmed date (custbody_del_date) when set, otherwise
     * the ship date (custbody_defaultshipdate); null with neither.
     * @returns {string|null} key
     */
    function deliveryDateKey(order) {
        return trim(order.confirmedDateKey) || trim(order.shipDateKey) || null;
    }

    /**
     * Pure: the "Recently delivered" section. Keeps rows delivered from today - days to today
     * (inclusive), with an opportunity, a quote type that is not excluded and a Record Status that is
     * not hidden; groups them under their project (from opps, else the order's opportunity text).
     *
     * @param {Object[]} orders - shaped like orderFromResult()
     * @param {Object[]} opps - the customer's opportunities (getProjects().opps), may be []
     * @param {Object} cfg - EXCLUDED_QUOTE_TYPES, RECENT_HIDDEN_STATUSES
     * @param {string} todayKey
     * @param {number} days
     * @returns {Array<{opp: Object, orders: Array<{order: Object, state: string}>}>}
     */
    function groupRecent(orders, opps, cfg, todayKey, days) {
        var fromKey = dates.addDays(todayKey, -Math.max(0, parseInt(days, 10) || 0));
        var byOpp = {};
        var order = [];
        var oppById = {};
        var i;
        var o;
        var key;
        for (i = 0; i < (opps || []).length; i++) {
            oppById[opps[i].id] = opps[i];
        }
        for (i = 0; i < (orders || []).length; i++) {
            o = orders[i];
            key = deliveryDateKey(o);
            if (!key || key < fromKey || key > todayKey || trim(o.opportunityId) === '' ||
                    contains(cfg.EXCLUDED_QUOTE_TYPES, o.quoteType) || contains(cfg.RECENT_HIDDEN_STATUSES, o.recordStatus)) {
                continue;
            }
            o.deliveredKey = key;
            if (!byOpp[o.opportunityId]) {
                byOpp[o.opportunityId] = { opp: oppById[o.opportunityId] ||
                    { id: o.opportunityId, title: o.opportunityText, tranId: '', siteAddress: '' }, orders: [] };
                order.push(o.opportunityId);
            }
            byOpp[o.opportunityId].orders.push({ order: o, state: STATES.DELIVERED });
        }
        return order.map(function (id) { return byOpp[id]; });
    }

    // ---------------------------------------------------------------- money and terms (1.2)

    /** Pure: a currency value as a number, or null when blank or not a number. 0 is a number. */
    function toAmount(value) {
        var text = trim(value).replace(/[\u00a3,\s]/g, '');
        if (text === '' || !/^-?\d*\.?\d+$/.test(text)) {
            return null;
        }
        return Math.round(parseFloat(text) * 100) / 100;
    }

    /**
     * Pure (2.0.5): what the customer has to pay on an order — the SYSTEM BALANCES ONLY (Steve, 1 Oct):
     *   incVat  custbodycustbody_sys_bal_incvat, the amount to pay including VAT, after any deposits
     *   exVat   custbody_sys_bal_exvat, the same excluding VAT; null when blank
     * The inc-VAT balance blank (or not a number) -> null: NO FALLBACK (the old total - deposit sum gave
     * wrong figures). 0 is a real value ("Nothing left to pay on this order"). A negative inc-VAT
     * balance is null and onOdd, if given, is told why (the caller logs CDB AMOUNT_ODD); a negative
     * ex-VAT balance alone is dropped (exVat null).
     *
     * @param {Object} extras - { balance, balanceEx } as the extras search returned them
     * @param {function(string)} [onOdd]
     * @returns {{incVat: number, exVat: (number|null)}|null}
     */
    function amountToPay(extras, onOdd) {
        var inc;
        var ex;
        if (!extras) {
            return null;
        }
        inc = toAmount(extras.balance);
        if (inc === null) {
            return null;
        }
        if (inc < 0) {
            if (onOdd) {
                onOdd('negative balance: inc VAT "' + trim(extras.balance) + '", ex VAT "' + trim(extras.balanceEx) + '"');
            }
            return null;
        }
        ex = toAmount(extras.balanceEx);
        return { incVat: inc, exVat: ex !== null && ex >= 0 ? ex : null };
    }

    /**
     * Pure: does this order pay up front? (Amendment 2: the customer AND the order must say account.)
     *
     *   customer terms          order terms         result
     *   in PREPAY_TERMS         anything            pay up front
     *   blank                   anything            pay up front (fail closed)
     *   credit (not in list)    in PREPAY_TERMS     pay up front (staff made this order pay up front)
     *   credit                  credit or blank     ACCOUNT
     *
     * On top: an empty PAY_ACCOUNT or PREPAY_TERMS, or missing extras (the search failed), means pay
     * up front. Every doubt resolves to "pay up front", which offers less.
     *
     * @param {string} customerTermsId - the customer's CURRENT terms (getCustomer().termsId)
     * @param {Object|undefined} extras - { termsId } of the order; undefined when the search failed
     * @param {Object} cfg - PREPAY_TERMS, PAY_ACCOUNT
     * @returns {boolean}
     */
    function isPrepay(customerTermsId, extras, cfg) {
        if (!extras || trim(cfg.PAY_ACCOUNT) === '' || !(cfg.PREPAY_TERMS || []).length) {
            return true;
        }
        if (trim(customerTermsId) === '' || contains(cfg.PREPAY_TERMS, customerTermsId)) {
            return true;
        }
        return contains(cfg.PREPAY_TERMS, extras.termsId);
    }

    /**
     * Pure: adds the 1.2 values to an order row, in place.
     *   typeLabel  the short label for its quote type (custscript_cdb_quote_type_labels), else the
     *              quote type's own text
     *   uniqueRef  custbody_unique_so_ref, cleaned like the description ('' when unknown)
     *   termsId, customerTermsId  the order's and the customer's terms, for the logs (amendment 2)
     *   prepay     isPrepay(customerTermsId, extras, cfg)
     *   amount     amountToPay() for EVERY order when known (amendment 1: account customers paying
     *              by BACS see it too); null when unknown. An Add-to-account booking never shows it:
     *              render and the Task leave it out for that choice.
     *
     * @param {Object} order
     * @param {Object} extrasById - from getOrderExtras(); {} when it failed
     * @param {Object} labels - quote type id -> label
     * @param {Object} cfg
     * @param {string} customerTermsId - the customer's current terms
     * @param {function(string)} [onOdd]
     * @returns {Object} the order
     */
    function decorateOrder(order, extrasById, labels, cfg, customerTermsId, onOdd) {
        var extras = extrasById ? extrasById[order.id] : undefined;
        order.typeLabel = (labels && labels.hasOwnProperty(order.quoteType) && labels[order.quoteType]) ||
            order.quoteTypeText || '';
        order.uniqueRef = extras ? cleanDescription(extras.uniqueRef) : '';
        order.termsId = extras ? trim(extras.termsId) : '';
        order.customerTermsId = trim(customerTermsId);
        order.prepay = isPrepay(customerTermsId, extras, cfg);
        order.amount = amountToPay(extras, onOdd ? function (why) {
            onOdd('Sales order ' + order.id + ': ' + why);
        } : null);
        return order;
    }

    /** Pure: every order in the delivery section. */
    function decorateGroups(groups, extrasById, labels, cfg, customerTermsId, onOdd) {
        var i;
        var j;
        for (i = 0; i < groups.forDelivery.length; i++) {
            for (j = 0; j < groups.forDelivery[i].orders.length; j++) {
                decorateOrder(groups.forDelivery[i].orders[j].order, extrasById, labels, cfg, customerTermsId, onOdd);
            }
        }
        return groups;
    }

    /**
     * 1.3: everything a page or a digest needs on top of getProjects(), in ONE extras call: the IDs
     * of the delivery orders and of the recent rows are joined, the extras read once, every order
     * decorated, and groups.recent set from groupRecent().
     *
     * @param {Object} groups - from getProjects()
     * @param {Object[]} recentRows - from getRecentlyDelivered(); [] when it failed
     * @returns {Object} groups
     */
    function decorateAll(groups, recentRows, labels, cfg, customerTermsId, todayKey, onOdd) {
        var ids = orderIdsOf(groups);
        var extras;
        var i;
        var j;
        // 1.3.1: group first, so only the recent rows that will be SHOWN join the extras call.
        groups.recent = groupRecent(recentRows, groups.opps, cfg, todayKey, cfg.RECENT_DAYS);
        for (i = 0; i < groups.recent.length; i++) {
            for (j = 0; j < groups.recent[i].orders.length; j++) {
                ids.push(groups.recent[i].orders[j].order.id);
            }
        }
        extras = getOrderExtras(ids);
        decorateGroups(groups, extras, labels, cfg, customerTermsId, onOdd);
        for (i = 0; i < groups.recent.length; i++) {
            for (j = 0; j < groups.recent[i].orders.length; j++) {
                decorateOrder(groups.recent[i].orders[j].order, extras, labels, cfg, customerTermsId, onOdd);
            }
        }
        return groups;
    }

    /** The states that need the customer (1.3.2): they stay in "Projects for delivery". */
    var NEEDS_CUSTOMER = [STATES.READY, STATES.AWAITING_PAYMENT, STATES.REQUESTED, STATES.NEEDS_INFO];

    /** The date an in-hand order is due: the confirmed date when booked, else the ship date. */
    function upcomingKey(row) {
        return row.state === STATES.BOOKED ? trim(row.order.confirmedDateKey) : trim(row.order.shipDateKey);
    }

    /** Ascending by key, blanks last, then by SO number so the order is stable. */
    function byKeyAsc(keyOf) {
        return function (a, b) {
            var ka = keyOf(a);
            var kb = keyOf(b);
            if (ka !== kb) {
                return ka === '' ? 1 : kb === '' ? -1 : (ka < kb ? -1 : 1);
            }
            return String(a.order.tranId) < String(b.order.tranId) ? -1 : 1;
        };
    }

    /**
     * Pure (1.3.2): one "Booked deliveries" section. Run after decorateAll().
     *
     *   groups.forDelivery  keeps only orders that NEED THE CUSTOMER (ready, awaiting payment,
     *                       requested, needs info); a project with none of those leaves it.
     *   groups.booked       everything IN HAND — released and booked open orders, plus the recent
     *                       deliveries — grouped under their project. Projects with an upcoming order
     *                       first, by their soonest upcoming date; then delivered-only projects, most
     *                       recent first. Within a project: upcoming by date ascending, then delivered
     *                       by date descending.
     *
     * Whether a project or customer has anything to show (groups.isEmpty, and so who gets a
     * digest) is NOT changed here: it was decided by groupProjects() before the split.
     *
     * @param {Object} groups - from getProjects(), with groups.recent from decorateAll()
     * @returns {Object} groups
     */
    function arrangeSections(groups) {
        var forDelivery = [];
        var byOpp = {};
        var keys = [];
        var i;
        var j;
        var p;
        var row;
        var need;
        var buckets;

        function bucket(opp) {
            if (!byOpp[opp.id]) {
                byOpp[opp.id] = { opp: opp, upcoming: [], delivered: [] };
                keys.push(opp.id);
            }
            return byOpp[opp.id];
        }

        for (i = 0; i < groups.forDelivery.length; i++) {
            p = groups.forDelivery[i];
            need = [];
            for (j = 0; j < p.orders.length; j++) {
                row = p.orders[j];
                if (contains(NEEDS_CUSTOMER, row.state)) {
                    need.push(row);
                } else {
                    bucket(p.opp).upcoming.push(row);
                }
            }
            if (need.length) {
                forDelivery.push({ opp: p.opp, orders: need });
            }
        }
        for (i = 0; i < (groups.recent || []).length; i++) {
            for (j = 0; j < groups.recent[i].orders.length; j++) {
                bucket(groups.recent[i].opp).delivered.push(groups.recent[i].orders[j]);
            }
        }

        buckets = keys.map(function (k) {
            var b = byOpp[k];
            b.upcoming.sort(byKeyAsc(upcomingKey));
            b.delivered.sort(byKeyAsc(function (r) { return trim(r.order.deliveredKey); })).reverse();
            b.soonest = b.upcoming.length ? upcomingKey(b.upcoming[0]) : '';
            b.latest = b.delivered.length ? trim(b.delivered[0].order.deliveredKey) : '';
            return b;
        });
        buckets.sort(function (a, b) {
            var au = a.upcoming.length > 0;
            var bu = b.upcoming.length > 0;
            if (au !== bu) {
                return au ? -1 : 1;
            }
            if (au) {
                if (a.soonest !== b.soonest) {
                    return a.soonest === '' ? 1 : b.soonest === '' ? -1 : (a.soonest < b.soonest ? -1 : 1);
                }
                return 0;
            }
            return a.latest === b.latest ? 0 : (a.latest > b.latest ? -1 : 1);
        });

        groups.forDelivery = forDelivery;
        groups.booked = buckets.map(function (b) {
            return { opp: b.opp, orders: b.upcoming.concat(b.delivered) };
        });
        return groups;
    }

    /** Pure (1.3.1): the IDs of the customer's opportunities that getProjects() loaded. */
    function oppIdsOf(groups) {
        return (groups.opps || []).map(function (o) { return o.id; });
    }

    /** Pure: the IDs of every order in the delivery section. */
    function orderIdsOf(groups) {
        var ids = [];
        var i;
        var j;
        for (i = 0; i < groups.forDelivery.length; i++) {
            for (j = 0; j < groups.forDelivery[i].orders.length; j++) {
                ids.push(groups.forDelivery[i].orders[j].order.id);
            }
        }
        return ids;
    }

    // ---------------------------------------------------------------- value shapes

    /** A select from lookupFields: [{value, text}] or ''. */
    function lookupSelect(value) {
        if (Array.isArray(value)) {
            return value.length ? { value: String(value[0].value), text: String(value[0].text || '') } :
                { value: '', text: '' };
        }
        return { value: trim(value), text: '' };
    }

    /** A checkbox from a search or lookup: true, 'T' or false/'F'. */
    function isTicked(value) {
        return value === true || value === 'T';
    }

    /**
     * A date column or lookup value, which arrives as a string in the account's date format.
     * @returns {string} key, or '' when blank or unparseable
     */
    function dateKey(value) {
        var parsed;
        if (value instanceof Date) {
            return dates.keyFromLocalDate(value);
        }
        if (trim(value) === '') {
            return '';
        }
        try {
            parsed = format.parse({ value: String(value), type: format.Type.DATE });
        } catch (e) {
            return '';
        }
        return dates.keyFromLocalDate(parsed);
    }

    /** A key as the account's date format, for a search filter. */
    function dateFilterValue(key) {
        return format.format({ value: dates.localDateForWrite(key), type: format.Type.DATE });
    }

    // ---------------------------------------------------------------- reads

    /**
     * @param {string} customerId
     * @returns {Object|null} { id, name, email, salesRep, dashboardContact, isInactive }
     */
    function getCustomer(customerId) {
        var r;
        var name;
        try {
            r = search.lookupFields({
                type: search.Type.CUSTOMER,
                id: customerId,
                // terms: standard field, safe in lookupFields (amendment 2).
                // 2.1: phone, the call request's default when the dashboard contact has none.
                columns: ['entityid', 'companyname', 'firstname', 'lastname', 'isperson', 'email', 'phone', 'terms',
                    'salesrep', 'isinactive', CUST.DASHBOARD_CONTACT]
            });
        } catch (e) {
            return null;
        }
        if (isTicked(r.isperson)) {
            name = trim(trim(r.firstname) + ' ' + trim(r.lastname));
        } else {
            name = trim(r.companyname);
        }
        return {
            id: String(customerId),
            name: name || trim(r.entityid),
            greetingName: (isTicked(r.isperson) ? trim(r.firstname) : '') || name || trim(r.entityid),
            email: trim(r.email),
            phone: trim(r.phone),
            salesRep: lookupSelect(r.salesrep).value,
            termsId: lookupSelect(r.terms).value,
            dashboardContact: lookupSelect(r[CUST.DASHBOARD_CONTACT]).value,
            isInactive: isTicked(r.isinactive)
        };
    }

    /**
     * One lookup on an employee. The phone is the employee `phone` field — the field Send Quote's card
     * reads (master proposal loadSalesRepData) — else `mobilephone`, this repo's fallback.
     *
     * 2.0.2: withPhoto adds custentity_employee_photo_link to the SAME lookup, for the email card. If
     * that lookup throws (say, the field is missing in an account) it is retried once without the
     * photo, so a photo problem never costs the author or the send; photoError says why.
     *
     * @param {string} employeeId
     * @param {boolean} [withPhoto]
     * @returns {Object|null} { id, name, firstName, phone, email, isInactive, photoLink, photoError }
     */
    function getEmployee(employeeId, withPhoto) {
        var columns = ['entityid', 'firstname', 'lastname', 'phone', 'mobilephone', 'email', 'isinactive'];
        var photoField = config.FIELDS.EMPLOYEE.PHOTO_LINK;
        var photoError = '';
        var r;
        if (trim(employeeId) === '') {
            return null;
        }
        try {
            r = search.lookupFields({
                type: search.Type.EMPLOYEE,
                id: employeeId,
                columns: withPhoto ? columns.concat([photoField]) : columns
            });
        } catch (e) {
            if (!withPhoto) {
                return null;
            }
            photoError = 'employee lookup with the photo field failed: ' + (e && e.message ? e.message : String(e));
            try {
                r = search.lookupFields({ type: search.Type.EMPLOYEE, id: employeeId, columns: columns });
            } catch (e2) {
                return null;
            }
        }
        return {
            id: String(employeeId),
            name: trim(trim(r.firstname) + ' ' + trim(r.lastname)) || trim(r.entityid),
            firstName: trim(r.firstname),
            phone: trim(r.phone) || trim(r.mobilephone),
            email: trim(r.email),
            isInactive: isTicked(r.isinactive),
            photoLink: withPhoto && !photoError ? trim(r[photoField]) : '',
            photoError: photoError
        };
    }

    /**
     * Pure (Send Quote's checkPhotoUrl): the photo URL if an email can use it — absolute https://, no
     * spaces, quotes or angle brackets.
     * @returns {{url: string, reason: string}} reason says why not, when url is ''
     */
    function checkPhotoUrl(value) {
        var text = trim(value);
        if (!text) {
            return { url: '', reason: config.FIELDS.EMPLOYEE.PHOTO_LINK + ' is empty' };
        }
        if (!/^https:\/\//i.test(text)) {
            return { url: '', reason: 'not an https:// URL' };
        }
        if (/[\s"'<>]/.test(text)) {
            return { url: '', reason: 'URL contains spaces, quotes or angle brackets' };
        }
        return { url: text, reason: '' };
    }

    /**
     * 2.0.2: the account manager for an email's card, from emailAuthor()'s result. Logs CDB AM_PHOTO
     * once — photo used, or skipped and why (the Send Quote pattern). Call once per email.
     * @param {Object} author - from emailAuthor()
     * @param {string} what - for the log, e.g. 'Digest, customer 42'
     * @returns {Object} { name, phone, email, firstName, photoUrl }
     */
    function emailAm(author, what) {
        var a = author || {};
        var photo = a.photoError ? { url: '', reason: a.photoError } : checkPhotoUrl(a.photoLink);
        log.audit({ title: config.logTitle('AM_PHOTO'), details: what + ', employee ' + (a.id || 'none') +
            (photo.url ? ': photo used' : ': photo skipped: ' + photo.reason) });
        return { name: a.name || '', phone: a.phone || '', email: a.email || '', firstName: a.firstName || '',
            photoUrl: photo.url };
    }

    /**
     * @param {string} contactId
     * @returns {string} the contact's email, or ''
     */
    function getContactEmail(contactId) {
        var r;
        if (trim(contactId) === '') {
            return '';
        }
        try {
            r = search.lookupFields({ type: search.Type.CONTACT, id: contactId, columns: ['email'] });
        } catch (e) {
            return '';
        }
        return trim(r.email);
    }

    /**
     * 2.1: the contact's phone (else mobile), or ''. Never throws.
     * @param {string} contactId
     * @returns {string}
     */
    function getContactPhone(contactId) {
        var r;
        if (trim(contactId) === '') {
            return '';
        }
        try {
            r = search.lookupFields({ type: search.Type.CONTACT, id: contactId, columns: ['phone', 'mobilephone'] });
        } catch (e) {
            return '';
        }
        return trim(r.phone) || trim(r.mobilephone);
    }

    /**
     * 2.1: the customer's stage, one lookup: the raw value and normaliseStage()'s result. Leads and
     * prospects are customer records at another stage, so search.Type.CUSTOMER reads them too. Never
     * throws: a failed lookup gives stage '' and raw the error.
     * @param {string} customerId
     * @returns {{stage: string, raw: string}}
     */
    function getCustomerStage(customerId) {
        var r;
        var v;
        try {
            r = search.lookupFields({ type: search.Type.CUSTOMER, id: customerId, columns: ['stage'] });
        } catch (e) {
            return { stage: '', raw: 'lookup failed: ' + (e && e.message ? e.message : String(e)) };
        }
        v = lookupSelect(r.stage).value || trim(r.stage);
        return { stage: normaliseStage(v), raw: v };
    }

    /**
     * 2.0, the digest's rule: who a customer email goes to — the dashboard contact's email, else the
     * customer's own. The caller decides what an unusable result means.
     * @param {Object} customer - from getCustomer()
     * @returns {string} '' when neither is set
     */
    function emailRecipient(customer) {
        return getContactEmail(customer.dashboardContact) || customer.email;
    }

    /**
     * 2.0, the digest's rule (moved here from cdb_mr_digest.js unchanged): who a customer email comes
     * from and whose card it shows — the customer's sales rep if active, else the fallback employee.
     * Never the current user.
     * @param {Object} customer - from getCustomer()
     * @param {Object} cfg - FALLBACK_EMPLOYEE
     * 2.0.2: the lookup also reads the photo link (getEmployee(id, true)).
     * @returns {Object} { id, name, firstName, phone, email, photoLink, photoError }
     */
    function emailAuthor(customer, cfg) {
        var rep = customer.salesRep ? getEmployee(customer.salesRep, true) : null;
        if (rep && !rep.isInactive) {
            return rep;
        }
        return getEmployee(String(cfg.FALLBACK_EMPLOYEE), true) ||
            { id: String(cfg.FALLBACK_EMPLOYEE), name: '', firstName: '', phone: '', email: '', photoLink: '',
                photoError: 'the employee could not be read' };
    }

    /**
     * 2.0: the customer a sales order's links belong to — its OPPORTUNITY's customer, the guard's
     * rule, never the order's own entity. Two lookups. Never throws.
     * @param {string} orderId
     * @returns {{opportunityId: string, customerId: string}|null} null when the order or its
     *   opportunity cannot be read, or the order has no opportunity
     */
    function orderCustomer(orderId) {
        var so;
        var opp;
        var oppId;
        var customerId;
        if (!/^\d+$/.test(trim(orderId))) {
            return null;
        }
        try {
            so = search.lookupFields({ type: search.Type.SALES_ORDER, id: trim(orderId), columns: [SO.OPPORTUNITY] });
            oppId = lookupSelect(so[SO.OPPORTUNITY]).value;
            if (oppId === '') {
                return null;
            }
            opp = search.lookupFields({ type: search.Type.OPPORTUNITY, id: oppId, columns: ['entity'] });
            customerId = lookupSelect(opp.entity).value;
        } catch (e) {
            return null;
        }
        return customerId === '' ? null : { opportunityId: oppId, customerId: customerId };
    }

    /** Runs a search to completion, mapping each result. */
    function collect(searchObj, mapper) {
        var rows = [];
        var paged = searchObj.runPaged({ pageSize: 1000 });
        paged.pageRanges.forEach(function (range) {
            paged.fetch({ index: range.index }).data.forEach(function (result) {
                rows.push(mapper(result));
            });
        });
        return rows;
    }

    /**
     * The customer's opportunities that are not Lost.
     * 2.1.1 (PR #7 amendment 1): also the build stage's text and the start date, for the "Projects to
     * order" meta line — in this one search, never a lookup per row. Both fields are confirmed on the
     * opportunity (the Online-quote library writes them).
     * @returns {Object[]} { id, tranId, title, siteAddress, status, subStatus, salesRep, pe,
     *                       valueProposition, buildStageText, delDateKey }
     */
    function getOpportunities(customerId, cfg) {
        var s = search.create({
            type: search.Type.OPPORTUNITY,
            // No mainline: the opportunity search rejects it ("invalid search criteria") and
            // already returns one row per opportunity.
            filters: [
                ['entity', 'anyof', customerId], 'AND',
                [OPP.STATUS, 'noneof', cfg.LOST_STATUSES]
            ],
            columns: [
                search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
                'tranid', 'title', OPP.STATUS, OPP.SUB_STATUS, OPP.SITE_ADDRESS, 'salesrep', OPP.PE,
                OPP.VALUE_PROPOSITION, OPP.BUILD_STAGE, OPP.DEL_DATE
            ]
        });
        return collect(s, function (r) {
            return {
                id: String(r.id),
                tranId: trim(r.getValue('tranid')),
                title: trim(r.getValue('title')),
                siteAddress: trim(r.getValue(OPP.SITE_ADDRESS)),
                status: trim(r.getValue(OPP.STATUS)),
                subStatus: trim(r.getValue(OPP.SUB_STATUS)),
                salesRep: trim(r.getValue('salesrep')),
                pe: trim(r.getValue(OPP.PE)),
                valueProposition: trim(r.getValue(OPP.VALUE_PROPOSITION)),
                buildStageText: trim(r.getText(OPP.BUILD_STAGE)),
                delDateKey: dateKey(r.getValue(OPP.DEL_DATE))
            };
        });
    }

    /** The description column: joined through the originating quote, never unjoined. */
    function descriptionColumn() {
        return search.createColumn({ name: config.FIELDS.QUOTE.DESCRIPTION, join: config.FIELDS.QUOTE.JOIN });
    }

    /** The order columns every order read uses. */
    function orderColumns() {
        return ['tranid', 'entity', SO.OPPORTUNITY, SO.RECORD_STATUS, SO.QUOTE_TYPE,
            SO.CONFIRMED_DATE, SO.PAY_INTENT, SO.READY, SO.HOLD_REASON, SO.SHIP_DATE, SO.TIME,
            descriptionColumn()];
    }

    /** Shapes one sales order search result. */
    function orderFromResult(r) {
        return {
            id: String(r.id),
            tranId: trim(r.getValue('tranid')),
            entity: trim(r.getValue('entity')),
            opportunityId: trim(r.getValue(SO.OPPORTUNITY)),
            recordStatus: trim(r.getValue(SO.RECORD_STATUS)),
            quoteType: trim(r.getValue(SO.QUOTE_TYPE)),
            quoteTypeText: trim(r.getText(SO.QUOTE_TYPE)),
            confirmedDateKey: dateKey(r.getValue(SO.CONFIRMED_DATE)),
            payIntent: trim(r.getValue(SO.PAY_INTENT)),
            ready: isTicked(r.getValue(SO.READY)),
            holdReason: trim(r.getValue(SO.HOLD_REASON)),
            shipDateKey: dateKey(r.getValue(SO.SHIP_DATE)),
            timeText: trim(r.getText(SO.TIME)),
            opportunityText: trim(r.getText(SO.OPPORTUNITY)),
            description: cleanDescription(r.getValue({ name: config.FIELDS.QUOTE.DESCRIPTION,
                join: config.FIELDS.QUOTE.JOIN }))
        };
    }

    /**
     * The base filter for "open" rules 1 and 2. Pure, and node-tested: it is where the addendum's
     * native status rule lives.
     * @returns {Array} a filter expression
     */
    function openOrderFilters() {
        return [
            ['mainline', 'is', 'T'], 'AND',
            [SO.OPPORTUNITY, 'noneof', '@NONE@'], 'AND',
            ['status', 'anyof', config.SHIPPABLE_STATUSES]
        ];
    }

    /**
     * The sales orders of the given opportunities that pass rules 1 and 2. Rules 3 and 4 are
     * applied by groupProjects() through isOpenOrder().
     * @param {string[]} oppIds
     * @returns {Object[]}
     */
    function getOrdersForOpportunities(oppIds) {
        if (!oppIds || !oppIds.length) {
            return [];
        }
        return collect(search.create({
            type: search.Type.SALES_ORDER,
            filters: openOrderFilters().concat(['AND', [SO.OPPORTUNITY, 'anyof', oppIds]]),
            columns: [search.createColumn({ name: 'tranid', sort: search.Sort.ASC })]
                .concat(orderColumns().slice(1))
        }), orderFromResult);
    }

    /**
     * Everything a page for one customer needs: opportunities, orders, sections.
     * About 20 governance units.
     */
    function getProjects(customerId, cfg) {
        var opps = getOpportunities(customerId, cfg);
        var wonIds = [];
        var i;
        for (i = 0; i < opps.length; i++) {
            if (contains(cfg.WON_STATUSES, opps[i].status) &&
                    contains(cfg.DELIVERY_SUBSTATUS, opps[i].subStatus)) {
                wonIds.push(opps[i].id);
            }
        }
        var groups = groupProjects(opps, getOrdersForOpportunities(wonIds), cfg);
        // 1.3: kept so the recently delivered rows can sit under their project's heading.
        groups.opps = opps;
        return groups;
    }

    /**
     * The B4 guard, for GET and POST alike.
     *
     * @param {string} customerId - from the verified token, never from the request
     * @param {string} orderId - from the request
     * @param {Object} cfg
     * @returns {{ok: boolean, reason: string, alreadyRequested: boolean, order: Object,
     *            opportunity: Object}}
     */
    function guardOrder(customerId, orderId, cfg) {
        var result = { ok: false, reason: '', alreadyRequested: false, order: null, opportunity: null };
        var rows;
        var opp;
        var oppStatus;

        if (!/^\d+$/.test(trim(orderId))) {
            result.reason = GUARD.NOT_FOUND;
            return result;
        }
        rows = collect(search.create({
            type: search.Type.SALES_ORDER,
            filters: openOrderFilters().concat(['AND', ['internalid', 'anyof', trim(orderId)]]),
            columns: orderColumns()
        }), orderFromResult);
        if (!rows.length) {
            result.reason = GUARD.NOT_FOUND;
            return result;
        }
        result.order = rows[0];

        try {
            opp = search.lookupFields({
                type: search.Type.OPPORTUNITY,
                id: result.order.opportunityId,
                // 2.0.3: the site address too, for the delivery-link email's "Project" row.
                columns: ['entity', 'title', 'tranid', 'salesrep', OPP.PE, OPP.VALUE_PROPOSITION,
                    OPP.STATUS, OPP.SITE_ADDRESS]
            });
        } catch (e) {
            result.reason = GUARD.NOT_OPEN;
            return result;
        }
        if (lookupSelect(opp.entity).value !== String(customerId)) {
            result.reason = GUARD.NOT_YOURS;
            return result;
        }
        oppStatus = lookupSelect(opp[OPP.STATUS]).value;
        result.opportunity = {
            id: result.order.opportunityId,
            title: trim(opp.title),
            tranId: trim(opp.tranid),
            siteAddress: trim(opp[OPP.SITE_ADDRESS]),
            status: oppStatus,
            salesRep: lookupSelect(opp.salesrep).value,
            pe: lookupSelect(opp[OPP.PE]).value,
            valueProposition: lookupSelect(opp[OPP.VALUE_PROPOSITION]).value
        };

        if (!isOpenOrder(result.order, cfg)) {
            result.reason = GUARD.NOT_OPEN;
            return result;
        }
        if (result.order.confirmedDateKey !== '') {
            result.reason = GUARD.BOOKED;
            return result;
        }
        // 1.3: released orders are open (they show) but are never bookable.
        if (isReleased(result.order, cfg)) {
            result.reason = GUARD.RELEASED;
            return result;
        }
        if (result.order.payIntent !== '') {
            result.reason = GUARD.ALREADY_REQUESTED;
            result.alreadyRequested = true;
            return result;
        }
        if (!result.order.ready) {
            result.reason = GUARD.NOT_READY;
            return result;
        }
        result.ok = true;
        return result;
    }

    /**
     * 2.1: the guard for "Tell us where you're up to", for GET and POST alike. Refuses unless the
     * opportunity's entity is THIS customer and its status is neither Won nor Lost — the "Projects to
     * order" rule (groupProjects()).
     *
     * @param {string} customerId - from the verified token, never from the request
     * @param {string} oppId - from the request
     * @param {Object} cfg - WON_STATUSES, LOST_STATUSES
     * @returns {{ok: boolean, reason: string, opportunity: Object}} opportunity: { id, title, tranId,
     *   siteAddress, status, salesRep, pe, valueProposition, buildStage, buildStageText, delDateKey }
     */
    function guardOpportunity(customerId, oppId, cfg) {
        var result = { ok: false, reason: '', opportunity: null };
        var opp;
        var stage;
        if (!/^\d+$/.test(trim(oppId))) {
            result.reason = GUARD_OPP.NOT_FOUND;
            return result;
        }
        try {
            opp = search.lookupFields({
                type: search.Type.OPPORTUNITY,
                id: trim(oppId),
                columns: ['entity', 'title', 'tranid', 'salesrep', OPP.PE, OPP.VALUE_PROPOSITION, OPP.STATUS,
                    OPP.SITE_ADDRESS, OPP.BUILD_STAGE, OPP.DEL_DATE]
            });
        } catch (e) {
            result.reason = GUARD_OPP.NOT_FOUND;
            return result;
        }
        if (lookupSelect(opp.entity).value !== String(customerId)) {
            result.reason = GUARD_OPP.NOT_YOURS;
            return result;
        }
        stage = lookupSelect(opp[OPP.BUILD_STAGE]);
        result.opportunity = {
            id: trim(oppId),
            title: trim(opp.title),
            tranId: trim(opp.tranid),
            siteAddress: trim(opp[OPP.SITE_ADDRESS]),
            status: lookupSelect(opp[OPP.STATUS]).value,
            salesRep: lookupSelect(opp.salesrep).value,
            pe: lookupSelect(opp[OPP.PE]).value,
            valueProposition: lookupSelect(opp[OPP.VALUE_PROPOSITION]).value,
            buildStage: stage.value,
            buildStageText: stage.text,
            delDateKey: dateKey(opp[OPP.DEL_DATE])
        };
        if (contains(cfg.LOST_STATUSES, result.opportunity.status)) {
            result.reason = GUARD_OPP.LOST;
            return result;
        }
        if (contains(cfg.WON_STATUSES, result.opportunity.status)) {
            result.reason = GUARD_OPP.WON;
            return result;
        }
        result.ok = true;
        return result;
    }

    /**
     * 2.1: the opportunity's open quotes (native Estimate:A, Open), for the not-going-ahead Task — the
     * account manager decides what happens to them; the dashboard never touches an estimate. FAIL-SAFE:
     * null when the search throws (the Task says so).
     * @param {string} oppId
     * @returns {Array<{id: string, tranId: string, description: string}>|null}
     */
    function getOpenQuotes(oppId) {
        try {
            return collect(search.create({
                type: search.Type.ESTIMATE,
                filters: [['mainline', 'is', 'T'], 'AND', [SO.OPPORTUNITY, 'anyof', trim(oppId)], 'AND',
                    ['status', 'anyof', ['Estimate:A']]],
                // The quote description is confirmed on the Estimate (section 0, 8): unjoined here, because
                // this IS the estimate search.
                columns: [search.createColumn({ name: 'tranid', sort: search.Sort.ASC }), config.FIELDS.QUOTE.DESCRIPTION]
            }), function (r) {
                return { id: String(r.id), tranId: trim(r.getValue('tranid')),
                    description: cleanDescription(r.getValue(config.FIELDS.QUOTE.DESCRIPTION)) };
            });
        } catch (e) {
            log.audit({ title: config.logTitle('OPEN_QUOTES_FAILED'), details: 'Opportunity ' + oppId + ': ' +
                (e && e.message ? e.message : String(e)) });
            return null;
        }
    }

    /**
     * 2.1: the objection types to offer as "Why not?" — their names from customrecord_nh_objection_type,
     * in the setting's order. FAIL-SAFE: a failed search logs CDB OBJECTION_TYPES_FAILED and offers none.
     * @param {string[]} ids - UPD_OBJECTION_TYPES
     * @returns {{options: Array<{id: string, text: string}>, missing: string[]}}
     */
    function getObjectionTypes(ids) {
        if (!(ids || []).length) {
            return { options: [], missing: [] };
        }
        try {
            return getListOptions(config.RECORD_TYPES.OBJECTION_TYPE, ids);
        } catch (e) {
            log.audit({ title: config.logTitle('OBJECTION_TYPES_FAILED'), details: config.RECORD_TYPES.OBJECTION_TYPE +
                ': ' + (e && e.message ? e.message : String(e)) + '. No reason list offered.' });
            return { options: [], missing: [] };
        }
    }

    /**
     * The 1.2 extras for orders ALREADY FOUND by the main searches, in one separate search.
     * FAIL-SAFE: any error is logged once as CDB EXTRAS_FAILED and {} is returned, so the page
     * renders as in 1.1 and every order is treated as pay up front. Call it once per request.
     *
     * @param {string[]} orderIds
     * @returns {Object} soId -> { termsId, uniqueRef, balance, balanceEx }
     */
    function getOrderExtras(orderIds) {
        var result = {};
        if (!orderIds || !orderIds.length) {
            return result;
        }
        try {
            collect(search.create({
                type: search.Type.SALES_ORDER,
                filters: [['mainline', 'is', 'T'], 'AND', ['internalid', 'anyof', orderIds]],
                columns: [SO.TERMS, SO.UNIQUE_REF, SO.BALANCE, SO.BALANCE_EX]
            }), function (r) {
                result[String(r.id)] = {
                    termsId: trim(r.getValue(SO.TERMS)),
                    uniqueRef: trim(r.getValue(SO.UNIQUE_REF)),
                    balance: trim(r.getValue(SO.BALANCE)),
                    balanceEx: trim(r.getValue(SO.BALANCE_EX))
                };
            });
        } catch (e) {
            log.audit({ title: config.logTitle('EXTRAS_FAILED'), details: 'Orders ' + orderIds.join(',') +
                ': ' + (e && e.message ? e.message : String(e)) + '. Shown without amounts or split ' +
                'references; every order treated as pay up front.' });
            return {};
        }
        return result;
    }

    /**
     * 1.3: the customer's shipped orders (native F/G) whose confirmed or ship date falls in the last
     * custscript_cdb_recent_days days. 1.3.1: "the customer's" means ON THE CUSTOMER'S OPPORTUNITIES,
     * as in every other section, not the order's own entity. oppIds are the ones getProjects()
     * already loaded (oppIdsOf()); with none, no search is run. NOT the excluded list; only the
     * hidden statuses. FAIL-SAFE: any error logs CDB RECENT_FAILED and returns [] so the page and
     * the digest carry on without them. Rows still need groupRecent(), which decides each one on
     * deliveryDateKey(). Since 1.3.2 they are shown in "Booked deliveries" (arrangeSections()).
     *
     * @returns {Object[]} rows shaped like orderFromResult()
     */
    function getRecentlyDelivered(customerId, oppIds, cfg, todayKey) {
        var fromKey = dates.addDays(todayKey, -Math.max(0, parseInt(cfg.RECENT_DAYS, 10) || 0));
        var filters;
        if (!oppIds || !oppIds.length) {
            return [];
        }
        try {
            filters = [
                ['mainline', 'is', 'T'], 'AND',
                [SO.OPPORTUNITY, 'anyof', oppIds], 'AND',
                ['status', 'anyof', config.DELIVERED_STATUSES], 'AND',
                [[SO.QUOTE_TYPE, 'anyof', '@NONE@'], 'OR', [SO.QUOTE_TYPE, 'noneof', cfg.EXCLUDED_QUOTE_TYPES]], 'AND',
                [[SO.CONFIRMED_DATE, 'within', dateFilterValue(fromKey), dateFilterValue(todayKey)], 'OR',
                    [SO.SHIP_DATE, 'within', dateFilterValue(fromKey), dateFilterValue(todayKey)]]
            ];
            if ((cfg.RECENT_HIDDEN_STATUSES || []).length) {
                filters = filters.concat(['AND', [[SO.RECORD_STATUS, 'anyof', '@NONE@'], 'OR',
                    [SO.RECORD_STATUS, 'noneof', cfg.RECENT_HIDDEN_STATUSES]]]);
            }
            return collect(search.create({
                type: search.Type.SALES_ORDER,
                filters: filters,
                columns: [search.createColumn({ name: 'tranid', sort: search.Sort.ASC })].concat(orderColumns().slice(1))
            }), orderFromResult);
        } catch (e) {
            log.audit({ title: config.logTitle('RECENT_FAILED'), details: 'Customer ' + customerId + ': ' +
                (e && e.message ? e.message : String(e)) + '. Shown without "Recently delivered".' });
            return [];
        }
    }

    /**
     * Non-delivery dates between two keys, inclusive.
     * @returns {Object} a set of keys
     */
    function getNonDeliveryDates(fromKey, toKey) {
        var keys = collect(search.create({
            type: config.RECORD_TYPES.NON_DELIVERY,
            filters: [
                ['isinactive', 'is', 'F'], 'AND',
                [config.FIELDS.NON_DELIVERY.DATE, 'within', dateFilterValue(fromKey),
                    dateFilterValue(toKey)]
            ],
            columns: [config.FIELDS.NON_DELIVERY.DATE]
        }), function (r) {
            return dateKey(r.getValue(config.FIELDS.NON_DELIVERY.DATE));
        });
        return dates.toSet(keys);
    }

    /**
     * The options of a custom list, restricted to the allowed IDs and in their order.
     * @param {string} listType - e.g. customlist_del_time_per
     * @param {string[]} ids
     * @returns {{options: Array<{id: string, text: string}>, missing: string[]}}
     */
    function getListOptions(listType, ids) {
        var names = {};
        var options = [];
        var missing = [];
        var i;
        collect(search.create({
            type: listType,
            filters: [['internalid', 'anyof', ids]],
            columns: ['name']
        }), function (r) {
            names[String(r.id)] = trim(r.getValue('name'));
        });
        for (i = 0; i < ids.length; i++) {
            if (names.hasOwnProperty(ids[i])) {
                options.push({ id: ids[i], text: names[ids[i]] });
            } else {
                missing.push(ids[i]);
            }
        }
        return { options: options, missing: missing };
    }

    /** 2.2: an address book line's internal ID (what shipaddresslist holds). */
    function addressLineId(customer, line) {
        return trim(customer.getSublistValue({ sublistId: 'addressbook', fieldId: 'id', line: line })) ||
            trim(customer.getSublistValue({ sublistId: 'addressbook', fieldId: 'internalid', line: line }));
    }

    /**
     * 2.2: one field of an address book line's address. '' when it cannot be read: never fatal (the
     * duplicate check then simply finds no match).
     */
    function addressPart(customer, line, fieldId) {
        try {
            return trim(customer.getSublistSubrecord({ sublistId: 'addressbook', fieldId: 'addressbookaddress',
                line: line }).getValue({ fieldId: fieldId }));
        } catch (e) {
            return '';
        }
    }

    /**
     * The customer's address book lines. The value of each is the line's internal ID, which is
     * what shipaddresslist holds. 2.2: also each line's addr1 and zip, for matchAddress().
     * @returns {Array<{id: string, text: string, label: string, addr1: string, zip: string}>}
     */
    function getAddressBook(customerId) {
        var customer = record.load({ type: record.Type.CUSTOMER, id: customerId, isDynamic: false });
        var count = customer.getLineCount({ sublistId: 'addressbook' });
        var lines = [];
        var i;
        var id;
        var label;
        var text;
        for (i = 0; i < count; i++) {
            id = addressLineId(customer, i);
            label = trim(customer.getSublistValue({ sublistId: 'addressbook', fieldId: 'label', line: i }));
            text = trim(customer.getSublistValue({ sublistId: 'addressbook',
                fieldId: 'addressbookaddress_text', line: i }));
            if (id !== '') {
                lines.push({ id: id, text: text ? text.replace(/\s*\n\s*/g, ', ') : label, label: label,
                    addr1: addressPart(customer, i, 'addr1'), zip: addressPart(customer, i, 'zip') });
            }
        }
        return lines;
    }

    // ---------------------------------------------------------------- 2.2: the three writes

    function writeError(name, message) {
        var e = new Error(name + ': ' + message);
        e.name = name;
        return e;
    }

    /**
     * 2.2.1 (was 2.2's writeProjectName): "Your project details". ONE submitFields on the opportunity carrying
     * only the values given — title and/or custbody_opp_site_adress, NEVER any other field — no sourcing,
     * mandatory fields ignored. The caller has run guardOpportunity() (the token's customer's, not Won or Lost)
     * and validateUpdate(), and passes only the changed
     * values; each is checked again here and the whole write refused rather than made (fail closed): a bad
     * opportunity ID, nothing to write, a blank value or one over its limit.
     * @param {string} oppId
     * @param {Object} details - { title, siteAddress }: each optional, at least one
     * @returns {Object} the values written, by field ID
     * @throws CDB_BAD_PROJECT_DETAILS, or whatever submitFields throws
     */
    function writeProjectDetails(oppId, details) {
        var id = trim(oppId);
        var d = details || {};
        var values = {};
        var specs = [{ key: 'title', fieldId: OPP.TITLE, limit: config.TEXT_LIMITS.PROJECT_NAME },
            { key: 'siteAddress', fieldId: OPP.SITE_ADDRESS, limit: config.TEXT_LIMITS.SITE_ADDRESS }];
        var count = 0;
        var value;
        var i;
        if (!/^\d+$/.test(id)) {
            throw writeError('CDB_BAD_PROJECT_DETAILS', 'opportunity "' + id + '": not written');
        }
        for (i = 0; i < specs.length; i++) {
            if (d[specs[i].key] === undefined || d[specs[i].key] === null) {
                continue;
            }
            value = cleanLine(d[specs[i].key]);
            if (value === '' || value.length > specs[i].limit) {
                throw writeError('CDB_BAD_PROJECT_DETAILS', 'opportunity "' + id + '", ' + specs[i].fieldId + ' of ' +
                    value.length + ' characters: nothing written');
            }
            values[specs[i].fieldId] = value;
            count += 1;
        }
        if (!count) {
            throw writeError('CDB_BAD_PROJECT_DETAILS', 'opportunity "' + id + '": nothing to write');
        }
        record.submitFields({ type: record.Type.OPPORTUNITY, id: id, values: values,
            options: { enableSourcing: false, ignoreMandatoryFields: true } });
        return values;
    }

    /**
     * 2.2: which field of the address subrecord holds the county, VERIFIED ON THE SUBRECORD after the
     * country is set (the country decides the address form): 'state' when the form has it as a text field
     * (a select would be a list of states, which a typed county cannot be); else 'dispstate' when the
     * form has that; else '' and the county is not written.
     */
    function countyFieldOf(address) {
        var field = null;
        try {
            field = address.getField({ fieldId: 'state' });
        } catch (e) {
            field = null;
        }
        if (field && String(field.type).toLowerCase() !== 'select') {
            return 'state';
        }
        try {
            field = address.getField({ fieldId: 'dispstate' });
        } catch (e2) {
            field = null;
        }
        return field && String(field.type).toLowerCase() !== 'select' ? 'dispstate' : '';
    }

    /**
     * 2.2: the line just added, found again after the save by its label and postcode (the last such line:
     * the newest). '' when there is none.
     */
    function findAddressLine(customerId, label, zip) {
        var customer = record.load({ type: record.Type.CUSTOMER, id: customerId, isDynamic: false });
        var i;
        for (i = customer.getLineCount({ sublistId: 'addressbook' }) - 1; i >= 0; i--) {
            if (trim(customer.getSublistValue({ sublistId: 'addressbook', fieldId: 'label', line: i })) === label &&
                    addressKey(addressPart(customer, i, 'zip')) === addressKey(zip)) {
                return addressLineId(customer, i);
            }
        }
        return '';
    }

    /**
     * 2.2: adds the customer's new address to their address book — one line, labelled, neither default
     * shipping nor default billing — and returns its address ID for shipaddresslist. Standard mode: load
     * (5 units), save (10), load again to find the line (5).
     *
     * @param {string} customerId - the token's
     * @param {Object} a - newAddressOf(): { addr1, addr2, city, county, zip }
     * @param {string} label - addressLabel()
     * @returns {{id: string, countyField: string, countyNote: string}} id '' when the line was saved but could
     *   not be found again; countyField the field the county went in ('' none); countyNote why not, if not
     * @throws whatever the load or the save throws (nothing was added); never after the save
     */
    function addToAddressBook(customerId, a, label) {
        var customer = record.load({ type: record.Type.CUSTOMER, id: customerId, isDynamic: false });
        var line = customer.getLineCount({ sublistId: 'addressbook' });
        var address;
        var result = { id: '', countyField: '', countyNote: '' };
        customer.insertLine({ sublistId: 'addressbook', line: line });
        customer.setSublistValue({ sublistId: 'addressbook', fieldId: 'label', line: line, value: label });
        customer.setSublistValue({ sublistId: 'addressbook', fieldId: 'defaultshipping', line: line, value: false });
        customer.setSublistValue({ sublistId: 'addressbook', fieldId: 'defaultbilling', line: line, value: false });
        address = customer.getSublistSubrecord({ sublistId: 'addressbook', fieldId: 'addressbookaddress', line: line });
        // The country first: it chooses the address form, which decides the fields (and resets them).
        address.setValue({ fieldId: 'country', value: NEW_ADDRESS.COUNTRY });
        address.setValue({ fieldId: 'addr1', value: a.addr1 });
        if (a.addr2) {
            address.setValue({ fieldId: 'addr2', value: a.addr2 });
        }
        address.setValue({ fieldId: 'city', value: a.city });
        address.setValue({ fieldId: 'zip', value: a.zip });
        if (a.county) {
            result.countyField = countyFieldOf(address);
            if (result.countyField) {
                try {
                    address.setValue({ fieldId: result.countyField, value: a.county });
                } catch (e) {
                    result.countyNote = result.countyField + ' refused it: ' + (e && e.message ? e.message : String(e));
                    result.countyField = '';
                }
            } else {
                result.countyNote = 'the address form has no text county field (state or dispstate)';
            }
        }
        customer.save({ ignoreMandatoryFields: true });
        // Saved: from here nothing throws, so the caller never reports a saved line as not added.
        try {
            result.id = findAddressLine(customerId, label, a.zip);
        } catch (e2) {
            result.id = '';
        }
        return result;
    }

    /**
     * 2.2: keeps the customer's new delivery address on the opportunity — custbody_cdb_delivery_address,
     * overwriting any earlier one, and NOTHING ELSE on the opportunity. The field is optional (Steve creates
     * it): written only when getField() finds it on the loaded opportunity.
     * @returns {{written: boolean}} written false when the field is not on the opportunity
     * @throws whatever the load or submitFields throws
     */
    function writeDeliveryAddress(oppId, text) {
        var opp = record.load({ type: record.Type.OPPORTUNITY, id: trim(oppId), isDynamic: false });
        var values = {};
        if (!opp.getField({ fieldId: OPP.DELIVERY_ADDRESS })) {
            return { written: false };
        }
        values[OPP.DELIVERY_ADDRESS] = text;
        record.submitFields({ type: record.Type.OPPORTUNITY, id: trim(oppId), values: values,
            options: { enableSourcing: false, ignoreMandatoryFields: true } });
        return { written: true };
    }

    // ---------------------------------------------------------------- 2.3.0: "Tell us about your property"

    var DI_STORE = designinfo.STORE;

    /**
     * Field.type values, upper-cased, a text answer may be written to. CLOBTEXT/LONGTEXT: Long Text. NEVER RICHTEXT
     * (2.3.1): a Rich Text field renders its value as HTML for staff, and the customer's text is written as typed.
     */
    var DI_TEXT_TYPES = ['TEXT', 'TEXTAREA', 'LONGTEXT', 'CLOBTEXT', 'PHONE', 'EMAIL', 'URL'];

    /** NetSuite's own limits by field type, used when getField() exposes no maxLength. */
    var DI_TYPE_LIMITS = { TEXT: 300, PHONE: 300, EMAIL: 254, URL: 300, TEXTAREA: 4000 };

    /**
     * 2.3.0: the opportunity for the design information page, for GET and POST alike. One lookupFields. The
     * customer is the token's; the opportunity ID comes from the request.
     * @param {string} customerId - from the verified token
     * @param {string} oppId - from the request
     * @param {Object} cfg - WON_STATUSES, NEEDINFO_SUBSTATUS, DESIGN_SUBSTATUS, FC_MAP
     * @returns {{ok: boolean, reason: string, mode: string, opportunity: Object|null}} mode 'edit' (NEEDINFO) or
     *   'view' (DESIGN); opportunity { id, tranId, title, status, subStatus, pe, salesRep, valueProposition, fc }
     */
    function guardDesignInfo(customerId, oppId, cfg) {
        var result = { ok: false, reason: '', mode: '', opportunity: null };
        var r;
        var o;
        if (!/^\d+$/.test(trim(oppId))) {
            result.reason = GUARD_DI.NOT_FOUND;
            return result;
        }
        try {
            r = search.lookupFields({
                type: search.Type.OPPORTUNITY,
                id: trim(oppId),
                columns: ['entity', OPP.STATUS, OPP.SUB_STATUS, 'tranid', 'title', OPP.PE, 'salesrep', OPP.VALUE_PROPOSITION,
                    OPP.FC]
            });
        } catch (e) {
            result.reason = GUARD_DI.NOT_FOUND;
            return result;
        }
        if (lookupSelect(r.entity).value !== String(customerId)) {
            result.reason = GUARD_DI.NOT_YOURS;
            return result;
        }
        o = {
            id: trim(oppId),
            tranId: trim(r.tranid),
            title: trim(r.title),
            status: lookupSelect(r[OPP.STATUS]).value,
            subStatus: lookupSelect(r[OPP.SUB_STATUS]).value,
            pe: lookupSelect(r[OPP.PE]).value,
            salesRep: lookupSelect(r.salesrep).value,
            valueProposition: lookupSelect(r[OPP.VALUE_PROPOSITION]).value,
            fc: lookupSelect(r[OPP.FC]).value
        };
        result.opportunity = o;
        if (!contains(cfg.WON_STATUSES, o.status)) {
            result.reason = GUARD_DI.NOT_WON;
            return result;
        }
        // NEEDINFO first: its sub-status is also a design one.
        result.mode = contains(cfg.NEEDINFO_SUBSTATUS, o.subStatus) ? 'edit' :
            contains(cfg.DESIGN_SUBSTATUS, o.subStatus) ? 'view' : '';
        if (!result.mode) {
            result.reason = GUARD_DI.SUBSTATUS;
            return result;
        }
        if (designinfo.isFcNone(designinfo.fcTokens(designinfo.parseMaps(cfg), o.fc))) {
            result.reason = GUARD_DI.FC_NONE;
            return result;
        }
        result.ok = true;
        return result;
    }

    /** 2.3.0: the registry, once per execution per path. */
    var registryCache = {};

    /**
     * 2.3.0: the question registry from the File Cabinet (file.load by path, ~10 units), parsed with the allow-list
     * (every FIELDS.OPPORTUNITY value) and the deny-list (config.DESIGNINFO_DENY). Once per execution. Never throws.
     * @param {string} path - setting DESIGNINFO_REGISTRY
     * @returns {{status: string, questions: Object[], rejected: Object[], detail: string}} status 'none' (no
     *   setting), 'missing' (the file cannot be read), or parseRegistry()'s 'ok' | 'empty' | 'invalid'
     */
    function loadRegistry(path) {
        var p = trim(path);
        var text;
        if (p === '') {
            return { status: 'none', questions: [], rejected: [], detail: 'setting DESIGNINFO_REGISTRY is empty' };
        }
        if (registryCache.hasOwnProperty(p)) {
            return registryCache[p];
        }
        try {
            text = file.load({ id: p }).getContents();
            registryCache[p] = designinfo.parseRegistry(text, config.designInfoAllowList(), config.DESIGNINFO_DENY);
        } catch (e) {
            registryCache[p] = { status: 'missing', questions: [], rejected: [], detail: p + ' could not be read: ' +
                (e && e.message ? e.message : String(e)) };
        }
        return registryCache[p];
    }

    /** Field.type upper-cased, '' when unreadable. */
    function fieldType(field) {
        return field && field.type ? String(field.type).toUpperCase() : '';
    }

    /** Is a field of this type able to hold this question's answer? */
    function typeFits(q, type) {
        if (q.type === 'date') {
            return type === 'DATE';
        }
        if (q.type === 'choice' && q.optionsFromField) {
            return type === 'SELECT';
        }
        if (q.type === 'yesno') {
            return type === 'CHECKBOX' || contains(DI_TEXT_TYPES, type);
        }
        return contains(DI_TEXT_TYPES, type);
    }

    /** A read that never throws: '' (or false) when the field or the call fails. */
    function safeValue(rec, fieldId) {
        try {
            return rec.getValue({ fieldId: fieldId });
        } catch (e) {
            return '';
        }
    }

    function safeText(rec, fieldId) {
        try {
            return trim(rec.getText({ fieldId: fieldId }));
        } catch (e) {
            return '';
        }
    }

    /**
     * 2.3.0 (brief §4.3; amendment 1 §8): ONE record.load of the opportunity, DYNAMIC (Field.getSelectOptions()
     * needs it) and read-only: this record is never saved — every write is submitFields. For each registry question
     * with a field: the field missing -> the question is omitted (missing); its type unfit -> read-only (mismatched);
     * a choice @field whose options cannot be read -> read-only (optionsUnavailable). Current values come from the
     * same record. Also the facts' sources, the card's display values and the state.
     *
     * @param {string} oppId
     * @param {Object[]} questions - parseRegistry().questions
     * @param {Object} cfg - UPD_BUILD_STAGES (the stage choice is offered only from these, as on the update page)
     * @returns {Object} { fields: qid -> { fieldId, type, maxLength (or 0), limit, options ([{value, text}] for
     *   @field) }, values: qid -> current value (yesno 'yes'/'no'/'', choice literal: the label, @field: the option
     *   id, date: key), texts: qid -> display text, missing: [qid], mismatched: [{qid, fieldId, type}],
     *   optionsUnavailable: [{qid, why}], maxLengthExposed: boolean, info: { ...facts' sources and display } }
     */
    function loadDesignInfo(oppId, questions, cfg) {
        var rec = record.load({ type: record.Type.OPPORTUNITY, id: trim(oppId), isDynamic: true });
        var out = { fields: {}, values: {}, texts: {}, missing: [], mismatched: [], optionsUnavailable: [],
            maxLengthExposed: false, info: {} };

        (questions || []).forEach(function (q) {
            var field;
            var type;
            var raw;
            var options;
            var max;
            if (q.store !== DI_STORE.FIELD) {
                return;
            }
            try {
                field = rec.getField({ fieldId: q.field });
            } catch (e) {
                field = null;
            }
            if (!field) {
                out.missing.push(q.qid);
                return;
            }
            type = fieldType(field);
            max = typeof field.maxLength === 'number' && field.maxLength > 0 ? field.maxLength : 0;
            if (max) {
                out.maxLengthExposed = true;
            }
            out.fields[q.qid] = { fieldId: q.field, type: type, maxLength: max, ok: typeFits(q, type),
                limit: max || DI_TYPE_LIMITS[type] || 0, options: null };
            raw = safeValue(rec, q.field);
            if (!out.fields[q.qid].ok) {
                out.mismatched.push({ qid: q.qid, fieldId: q.field, type: type || '(unknown)' });
                out.texts[q.qid] = type === 'SELECT' ? safeText(rec, q.field) : displayValue(raw);
                return;
            }
            if (q.type === 'choice' && q.optionsFromField) {
                options = selectOptions(field, q, cfg);
                out.texts[q.qid] = safeText(rec, q.field);
                out.values[q.qid] = trim(raw);
                if (options.why) {
                    out.optionsUnavailable.push({ qid: q.qid, why: options.why });
                } else {
                    out.fields[q.qid].options = options.list;
                }
                return;
            }
            if (q.type === 'yesno') {
                // 2.3.1: an unticked box is "no" — a real answer — so a "No" is remembered and counts as answered.
                out.values[q.qid] = type === 'CHECKBOX' ? (raw === true || raw === 'T' ? 'yes' : 'no') :
                    (/^y(es)?$/i.test(trim(raw)) ? 'yes' : /^no?$/i.test(trim(raw)) ? 'no' : '');
                out.texts[q.qid] = out.values[q.qid] === 'yes' ? 'Yes' : out.values[q.qid] === 'no' ? 'No' : '';
                return;
            }
            if (q.type === 'date') {
                out.values[q.qid] = dateKey(raw);
                out.texts[q.qid] = designinfo.slashDate(out.values[q.qid]);
                return;
            }
            out.values[q.qid] = displayValue(raw);
            out.texts[q.qid] = out.values[q.qid];
        });

        out.info = {
            tranId: trim(safeValue(rec, 'tranid')),
            title: trim(safeValue(rec, OPP.TITLE)),
            siteAddress: trim(safeValue(rec, OPP.SITE_ADDRESS)),
            subStatus: trim(safeValue(rec, OPP.SUB_STATUS)),
            valueProposition: trim(safeValue(rec, OPP.VALUE_PROPOSITION)),
            valuePropositionText: safeText(rec, OPP.VALUE_PROPOSITION),
            fc: trim(safeValue(rec, OPP.FC)),
            fcText: safeText(rec, OPP.FC),
            heatSource: trim(safeValue(rec, OPP.HEAT_SOURCE)),
            heatSourceText: safeText(rec, OPP.HEAT_SOURCE),
            market: trim(safeValue(rec, OPP.MARKET)),
            manifolds: trim(safeValue(rec, OPP.MANIFOLD_LOCATIONS)),
            thermostatsText: safeText(rec, OPP.THERMOSTATS) || displayValue(safeValue(rec, OPP.THERMOSTATS)),
            neoHub: isTicked(safeValue(rec, OPP.NEO_HUB)),
            nextContactKey: dateKey(safeValue(rec, OPP.NEXT_CONTACT)),
            delDateKey: dateKey(safeValue(rec, OPP.DEL_DATE)),
            stateRaw: safeValue(rec, OPP.DESIGNINFO_STATE)
        };
        return out;
    }

    /** A field value as text for display and comparison. */
    function displayValue(raw) {
        if (raw instanceof Date) {
            return designinfo.slashDate(dates.keyFromLocalDate(raw));
        }
        if (raw === true || raw === false) {
            return raw ? 'Yes' : 'No';
        }
        return String(raw === null || raw === undefined ? '' : raw).replace(/^\s+|\s+$/g, '');
    }

    /**
     * The options of a choice @field: getSelectOptions() (the active ones the form offers; blank left out). For
     * custbody_build_stage only the UPD_BUILD_STAGES IDs, in that order — the update page's validation; empty: none
     * offered (fail closed). why says why there are none (the question is then read-only).
     */
    function selectOptions(field, q, cfg) {
        var raw;
        var list;
        var byId = {};
        try {
            raw = field.getSelectOptions() || [];
        } catch (e) {
            return { list: [], why: 'getSelectOptions() failed: ' + (e && e.message ? e.message : String(e)) };
        }
        list = raw.filter(function (o) { return o && trim(o.value) !== ''; }).map(function (o) {
            return { value: trim(o.value), text: trim(o.text) };
        });
        if (q.field === OPP.BUILD_STAGE) {
            list.forEach(function (o) { byId[o.value] = o; });
            list = ((cfg && cfg.UPD_BUILD_STAGES) || []).filter(function (id) { return byId[id]; }).map(function (id) {
                return byId[id];
            });
            if (!((cfg && cfg.UPD_BUILD_STAGES) || []).length) {
                return { list: [], why: 'setting UPD_BUILD_STAGES is empty' };
            }
        }
        return list.length ? { list: list, why: '' } : { list: [], why: 'no options returned' };
    }

    /** Pure: a typed line — control characters become spaces, trimmed. */
    function diLine(value) {
        return cleanLine(value);
    }

    /** Pure: typed text — newlines kept (\n), other control characters removed, trimmed. */
    function diText(value) {
        return trim(String(value === null || value === undefined ? '' : value).replace(/\r\n?/g, '\n')
            .replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ''));
    }

    /** Pure: is the value acceptable to a PHONE / EMAIL / URL field? Anything else is not written there. */
    function fitsSpecialType(type, value) {
        if (type === 'PHONE') {
            return /^[0-9+().\-\s xX]+$/.test(value) && (value.match(/\d/g) || []).length >= 7;
        }
        if (type === 'EMAIL') {
            return looksLikeEmail(value);
        }
        if (type === 'URL') {
            return /^https?:\/\/[^\s"'<>]+$/i.test(value);
        }
        return true;
    }

    /** An uploaded part that is a file: a name and a size above 0. */
    function isFilePart(f) {
        return !!(f && trim(f.name) !== '' && Number(f.size) > 0);
    }

    /**
     * Pure (brief §4.5; amendment 1 §4): every posted answer and file, before anything is written. Only the questions
     * the page offered for editing (shown, not read-only) are read; anything else posted is ignored.
     *
     * @param {Object} params - the request parameters: q_<qid> per answer
     * @param {Object} files - the request's files: f_<qid>_<n> -> { name, size, ... } (absent or empty: not a file)
     * @param {Object[]} questions - the editable questions
     * @param {Object} ctx - { todayKey, maxFiles, fields (loadDesignInfo().fields), stored (qid -> the current value:
     *   the record's, or the state's), options (qid -> [{value, text}] for @field) }
     * @returns {{ok: boolean, errors: Object, values: Object, files: Object}} values: qid -> the cleaned answer ('' for
     *   none; a choice: the label (literal) or the option id (@field)); files: qid -> [file parts]
     */
    function validateDesignInfo(params, files, questions, ctx) {
        var p = params || {};
        var f = files || {};
        var errors = {};
        var values = {};
        var chosen = {};
        var max = parseInt(ctx.maxFiles, 10) || designinfo.LIMITS.MAX_FILES_DEFAULT;
        var limits = designinfo.LIMITS;

        (questions || []).forEach(function (q) {
            var raw = p['q_' + q.qid];
            var v;
            var opts;
            var n;
            var list;
            var err;
            if (q.type === 'info') {
                return;
            }
            if (q.type === 'files') {
                list = [];
                for (n = 1; n <= Math.max(max, 20); n++) {
                    if (isFilePart(f['f_' + q.qid + '_' + n])) {
                        list.push(f['f_' + q.qid + '_' + n]);
                    }
                }
                if (list.length > max) {
                    errors[q.qid] = 'Please choose at most ' + max + ' files here at a time.';
                } else {
                    list.forEach(function (part) {
                        if (!errors[q.qid] && !designinfo.extensionAllowed(part.name)) {
                            errors[q.qid] = '“' + part.name + '” is not a file type we can take. Please send PDF, ' +
                                'DWG, DXF, an image, ZIP, Word or Excel.';
                        } else if (!errors[q.qid] && Number(part.size) > limits.FILE_BYTES) {
                            errors[q.qid] = '“' + part.name + '” is bigger than 10 MB. Tick “I have files bigger ' +
                                'than 10 MB” and we’ll send you a secure way to send it.';
                        }
                    });
                }
                chosen[q.qid] = list;
                return;
            }
            if (q.type === 'long') {
                v = diText(raw);
                if (v.length > limits.LONG) {
                    errors[q.qid] = 'Please keep this under ' + limits.LONG + ' characters.';
                }
            } else if (q.type === 'text') {
                v = diLine(raw);
                if (v.length > limits.TEXT) {
                    errors[q.qid] = 'Please keep this under ' + limits.TEXT + ' characters.';
                }
            } else if (q.type === 'date') {
                v = trim(raw);
                if (v !== '' && v !== trim((ctx.stored || {})[q.qid])) {
                    err = dateInputError(v, ctx.todayKey);
                    if (err) {
                        errors[q.qid] = err;
                    }
                }
            } else if (q.type === 'yesno') {
                v = trim(raw).toLowerCase();
                if (v !== '' && v !== 'yes' && v !== 'no') {
                    errors[q.qid] = 'Please choose Yes or No.';
                }
            } else {
                v = trim(raw);
                if (q.optionsFromField) {
                    opts = ((ctx.options || {})[q.qid] || []).map(function (o) { return o.value; });
                    if (v !== '' && !contains(opts, v)) {
                        errors[q.qid] = 'Please choose one of the options shown.';
                    }
                } else if (v !== '') {
                    n = /^\d+$/.test(v) ? parseInt(v, 10) : -1;
                    if (n < 0 || n >= (q.options || []).length) {
                        errors[q.qid] = 'Please choose one of the options shown.';
                    } else {
                        v = q.options[n];
                    }
                }
            }
            values[q.qid] = v;
        });
        return { ok: !Object.keys(errors).length, errors: errors, values: values, files: chosen };
    }

    /**
     * 2.3.0 (brief §4.5 step 1): ONE submitFields of the design information — modelled on writeProjectDetails().
     * Only registry-allowed fields (FIELDS.OPPORTUNITY, never DESIGNINFO_DENY) and the state field; only non-empty
     * values (blank never clears). Anything else refuses the whole write (fail closed).
     * A CHECKBOX "No" IS A VALUE, NOT A BLANK (decision, amendment 2): the customer's "No" writes false, and may untick a
     * box that was ticked. Only an empty string, null or undefined counts as blank.
     * @param {string} oppId
     * @param {Object} changes - fieldId -> value (string, Date or boolean)
     * @param {string} [stateText] - the state JSON, written in the same call
     * @returns {Object} the values written, by field ID
     * @throws CDB_BAD_DESIGNINFO_WRITE, or whatever submitFields throws
     */
    function writeDesignInfo(oppId, changes, stateText) {
        var id = trim(oppId);
        var values = {};
        var allow = config.designInfoAllowList();
        var count = 0;
        var key;
        var v;
        if (!/^\d+$/.test(id)) {
            throw writeError('CDB_BAD_DESIGNINFO_WRITE', 'opportunity "' + id + '": not written');
        }
        for (key in (changes || {})) {
            if (!changes.hasOwnProperty(key)) {
                continue;
            }
            v = changes[key];
            if (!contains(allow, key) || contains(config.DESIGNINFO_DENY, key)) {
                throw writeError('CDB_BAD_DESIGNINFO_WRITE', 'opportunity "' + id + '": ' + key + ' may not be written: ' +
                    'nothing written');
            }
            if (v === null || v === undefined || (typeof v === 'string' && trim(v) === '')) {
                throw writeError('CDB_BAD_DESIGNINFO_WRITE', 'opportunity "' + id + '": ' + key + ' is blank (blank never ' +
                    'clears): nothing written');
            }
            values[key] = v;
            count += 1;
        }
        if (stateText !== undefined && stateText !== null) {
            values[OPP.DESIGNINFO_STATE] = String(stateText);
            count += 1;
        }
        if (!count) {
            throw writeError('CDB_BAD_DESIGNINFO_WRITE', 'opportunity "' + id + '": nothing to write');
        }
        record.submitFields({ type: record.Type.OPPORTUNITY, id: id, values: values,
            options: { enableSourcing: false, ignoreMandatoryFields: true } });
        return values;
    }

    /**
     * 2.3.0 (brief §4.5 step 2): one customer file into the upload folder, private (isOnline false). The uploaded
     * part is a file.File already (request.files): it is named, filed and saved (~20 units). Returns its ID.
     * @throws whatever save throws
     */
    function saveUpload(part, name, folderId) {
        part.name = name;
        part.folder = parseInt(folderId, 10);
        part.isOnline = false;
        return String(part.save());
    }

    /**
     * 2.3.0: the saved file attached to the opportunity (~10 units). UNVERIFIED in this account: on the Sandbox
     * list. A failure leaves the file in the folder; the caller says so.
     */
    function attachUpload(fileId, oppId) {
        record.attach({ record: { type: 'file', id: parseInt(fileId, 10) },
            to: { type: record.Type.OPPORTUNITY, id: parseInt(oppId, 10) } });
    }

    /**
     * 2.3.0 (brief §6): the card states' extras for opportunities ALREADY FOUND, in one separate search — the
     * getOrderExtras() pattern. FAIL-SAFE: any error logs CDB OPP_EXTRAS_FAILED once and gives {}, so the page and
     * the digest show "needs information" cards. Never add these columns to getOpportunities().
     * @param {string[]} oppIds
     * @returns {Object} oppId -> { state, fc, heatSource, market, nextContactKey }
     */
    function getOpportunityExtras(oppIds) {
        var result = {};
        var wanted = {};
        if (!oppIds || !oppIds.length) {
            return result;
        }
        oppIds.forEach(function (id) { wanted[String(id)] = true; });
        try {
            collect(search.create({
                type: search.Type.OPPORTUNITY,
                filters: [['internalid', 'anyof', oppIds]],
                columns: [OPP.DESIGNINFO_STATE, OPP.FC, OPP.HEAT_SOURCE, OPP.MARKET, OPP.NEXT_CONTACT]
            }), function (r) {
                if (!wanted[String(r.id)]) {
                    return;
                }
                result[String(r.id)] = {
                    state: r.getValue(OPP.DESIGNINFO_STATE) || '',
                    fc: trim(r.getValue(OPP.FC)),
                    heatSource: trim(r.getValue(OPP.HEAT_SOURCE)),
                    market: trim(r.getValue(OPP.MARKET)),
                    nextContactKey: dateKey(r.getValue(OPP.NEXT_CONTACT))
                };
            });
        } catch (e) {
            log.audit({ title: config.logTitle('OPP_EXTRAS_FAILED'), details: 'Opportunities ' + oppIds.join(',') + ': ' +
                (e && e.message ? e.message : String(e)) + '. Design cards shown as "we need information".' });
            return {};
        }
        return result;
    }

    /**
     * 2.3.0 (brief §6): each design row's card — d.design = { key (cdb_lib_designinfo.CARD), progress
     * (progressFromState(), or null with no registry), sentKey, callKey (the design call, today or later), peFirst
     * (info_sent only) } — and d.badge widened to the four DESIGN_BADGES (an FC-none row: designing). Never throws.
     * @param {Object} groups - getProjects()
     * @param {Object} o - { extras (getOpportunityExtras()), questions (the registry's, or null), cfg, todayKey,
     *   firstNameOf (function(opp) -> the PE/AM first name; optional), onStateInvalid (function(oppId, detail)) }
     */
    function decorateDesign(groups, o) {
        (groups.inDesign || []).forEach(function (d) {
            var ex = (o.extras || {})[String(d.opp.id)] || {};
            var parsed = designinfo.parseState(ex.state);
            var facts = designinfo.buildFacts({ valueProposition: d.opp.valueProposition, fc: ex.fc,
                heatSource: ex.heatSource, market: ex.market, subStatus: d.opp.subStatus }, o.cfg);
            var key = designinfo.cardState({ needInfo: contains(o.cfg.NEEDINFO_SUBSTATUS, d.opp.subStatus),
                fcNone: designinfo.isFcNone(facts.fc), state: parsed.state });
            if (parsed.status === 'invalid' && o.onStateInvalid) {
                o.onStateInvalid(d.opp.id, parsed.detail);
            }
            d.design = {
                key: key,
                progress: o.questions ? designinfo.progressFromState(designinfo.visibleQuestions(o.questions, facts),
                    parsed.state) : null,
                sentKey: parsed.state.sent ? designinfo.londonTime(Date.parse(parsed.state.sent)).key : '',
                callKey: ex.nextContactKey && ex.nextContactKey >= o.todayKey ? ex.nextContactKey : '',
                peFirst: key === designinfo.CARD.INFO_SENT && o.firstNameOf ? o.firstNameOf(d.opp) : '',
                anySaved: designinfo.anySectionSaved(parsed.state)
            };
            d.badge = key === designinfo.CARD.FC_NONE ? DESIGN_BADGES.DESIGNING : key;
        });
        return groups;
    }

    /**
     * 2.3.0 (brief §7): the request button's and the Send design information Suitelet's read — ONE lookupFields —
     * and the three conditions: Won, sub-status in NEEDINFO_SUBSTATUS, FC maps to anything but none. FC_MAP empty
     * or invalid: refused (fail closed: it cannot tell a OneZone, Electric or Parts project apart).
     * @returns {{ok: boolean, reason: string, opp: Object|null}} opp { id, customerId, tranId, title, siteAddress,
     *   status, subStatus, pe, salesRep, valueProposition, fc, fcText, heatSource, heatSourceText, market,
     *   nextContactKey, delDateKey, stateRaw }
     */
    function designInfoRequest(oppId, cfg) {
        var out = { ok: false, reason: '', opp: null };
        var r;
        var o;
        var maps = designinfo.parseFcMapOnly(cfg);
        if (!/^\d+$/.test(trim(oppId))) {
            out.reason = 'no opportunity ID';
            return out;
        }
        try {
            r = search.lookupFields({ type: search.Type.OPPORTUNITY, id: trim(oppId), columns: ['entity', 'tranid', 'title',
                OPP.STATUS, OPP.SUB_STATUS, OPP.SITE_ADDRESS, OPP.PE, 'salesrep', OPP.VALUE_PROPOSITION, OPP.FC,
                OPP.HEAT_SOURCE, OPP.MARKET, OPP.NEXT_CONTACT, OPP.DEL_DATE, OPP.DESIGNINFO_STATE] });
        } catch (e) {
            out.reason = 'the opportunity could not be read: ' + (e && e.message ? e.message : String(e));
            return out;
        }
        o = {
            id: trim(oppId),
            customerId: lookupSelect(r.entity).value,
            tranId: trim(r.tranid),
            title: trim(r.title),
            siteAddress: trim(r[OPP.SITE_ADDRESS]),
            status: lookupSelect(r[OPP.STATUS]).value,
            subStatus: lookupSelect(r[OPP.SUB_STATUS]).value,
            pe: lookupSelect(r[OPP.PE]).value,
            salesRep: lookupSelect(r.salesrep).value,
            valueProposition: lookupSelect(r[OPP.VALUE_PROPOSITION]).value,
            fc: lookupSelect(r[OPP.FC]).value,
            fcText: lookupSelect(r[OPP.FC]).text,
            heatSource: lookupSelect(r[OPP.HEAT_SOURCE]).value,
            heatSourceText: lookupSelect(r[OPP.HEAT_SOURCE]).text,
            market: lookupSelect(r[OPP.MARKET]).value,
            nextContactKey: dateKey(r[OPP.NEXT_CONTACT]),
            delDateKey: dateKey(r[OPP.DEL_DATE]),
            stateRaw: r[OPP.DESIGNINFO_STATE] || ''
        };
        out.opp = o;
        out.reason = requestRefusal(o.status, o.subStatus, o.fc, cfg, maps);
        out.ok = !out.reason;
        return out;
    }

    /**
     * Pure (2.3.0): why the request button must not show, or '' when it may — the ONE rule for the User Event (its
     * record's own values) and the Suitelet (its lookup).
     * Reads WON_STATUSES, NEEDINFO_SUBSTATUS and FC_MAP only (2.3.1), the User Event's whole key list.
     * @param {Object} [maps] - designinfo.parseFcMapOnly(cfg), when the caller has it
     */
    function requestRefusal(status, subStatus, fc, cfg, maps) {
        var m = maps || designinfo.parseFcMapOnly(cfg);
        if (!contains(cfg.WON_STATUSES, status)) {
            return 'the opportunity is not Won';
        }
        if (!contains(cfg.NEEDINFO_SUBSTATUS, subStatus)) {
            return 'the sub-status is not Awaiting Design Info (NEEDINFO_SUBSTATUS)';
        }
        if (m.fcEmpty) {
            return 'setting FC_MAP is empty or invalid, so a OneZone, Electric or Parts project cannot be told apart';
        }
        if (designinfo.isFcNone(designinfo.fcTokens(m, fc))) {
            return 'the FC maps to none: nothing is needed from the customer';
        }
        return '';
    }

    return {
        VERSION: VERSION,
        STATES: STATES,
        DESIGN_BADGES: DESIGN_BADGES,
        PAYMENT: PAYMENT,
        GUARD: GUARD,
        GUARD_OPP: GUARD_OPP,
        UPDATE_MODE: UPDATE_MODE,
        contains: contains,
        versionAtLeast: versionAtLeast,
        stageOptions: stageOptions,
        normaliseStage: normaliseStage,
        lostStatusFor: lostStatusFor,
        slashDate: slashDate,
        validateUpdate: validateUpdate,
        guardOpportunity: guardOpportunity,
        getOpenQuotes: getOpenQuotes,
        getObjectionTypes: getObjectionTypes,
        getContactPhone: getContactPhone,
        getCustomerStage: getCustomerStage,
        isOpenOrder: isOpenOrder,
        orderState: orderState,
        groupProjects: groupProjects,
        resolveRecipient: resolveRecipient,
        headerOpportunity: headerOpportunity,
        looksLikeEmail: looksLikeEmail,
        toAmount: toAmount,
        amountToPay: amountToPay,
        isPrepay: isPrepay,
        decorateOrder: decorateOrder,
        decorateGroups: decorateGroups,
        orderIdsOf: orderIdsOf,
        getOrderExtras: getOrderExtras,
        decodeEntities: decodeEntities,
        cleanDescription: cleanDescription,
        orderColumns: orderColumns,
        validateDelivery: validateDelivery,
        openOrderFilters: openOrderFilters,
        dateKey: dateKey,
        dateFilterValue: dateFilterValue,
        isTicked: isTicked,
        lookupSelect: lookupSelect,
        getCustomer: getCustomer,
        getEmployee: getEmployee,
        getContactEmail: getContactEmail,
        emailRecipient: emailRecipient,
        emailAuthor: emailAuthor,
        emailAm: emailAm,
        checkPhotoUrl: checkPhotoUrl,
        orderCustomer: orderCustomer,
        getOpportunities: getOpportunities,
        getOrdersForOpportunities: getOrdersForOpportunities,
        getProjects: getProjects,
        isReleased: isReleased,
        recordStatusFilter: recordStatusFilter,
        customersWithOpenOpportunity: customersWithOpenOpportunity,
        customersWithOpenOrder: customersWithOpenOrder,
        deliveryDateKey: deliveryDateKey,
        groupRecent: groupRecent,
        getRecentlyDelivered: getRecentlyDelivered,
        oppIdsOf: oppIdsOf,
        decorateAll: decorateAll,
        arrangeSections: arrangeSections,
        guardOrder: guardOrder,
        getNonDeliveryDates: getNonDeliveryDates,
        getListOptions: getListOptions,
        getAddressBook: getAddressBook,
        cleanLine: cleanLine,
        normalisePostcode: normalisePostcode,
        addressLines: addressLines,
        matchAddress: matchAddress,
        addressLabel: addressLabel,
        writeProjectDetails: writeProjectDetails,
        siteAddressLine: siteAddressLine,
        addToAddressBook: addToAddressBook,
        writeDeliveryAddress: writeDeliveryAddress,
        // 2.3.0
        GUARD_DI: GUARD_DI,
        dateInputError: dateInputError,
        guardDesignInfo: guardDesignInfo,
        loadRegistry: loadRegistry,
        loadDesignInfo: loadDesignInfo,
        validateDesignInfo: validateDesignInfo,
        fitsSpecialType: fitsSpecialType,
        writeDesignInfo: writeDesignInfo,
        saveUpload: saveUpload,
        attachUpload: attachUpload,
        getOpportunityExtras: getOpportunityExtras,
        decorateDesign: decorateDesign,
        designInfoRequest: designInfoRequest,
        requestRefusal: requestRefusal
    };
});
