/**
 * cdb_lib_data.js
 *
 * Reads for the dashboard and the digest: customer -> opportunities -> sales orders, grouped into
 * the three stages; the guard on an order the customer wants to book; the delivery form's
 * choices; and the server-side validation of what the customer submitted.
 *
 * READ-ONLY. Nothing in this file writes a record.
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
 * THE EXTRAS (1.2) — terms, the split reference, the balance, the total and the deposit — come
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
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 2.0.2
 */
define(['N/search', 'N/record', 'N/format', 'N/log', './cdb_lib_config', './cdb_lib_dates'],
    function (search, record, format, log, config, dates) {

    'use strict';

    var VERSION = '2.0.2';

    var OPP = config.FIELDS.OPPORTUNITY;
    var SO = config.FIELDS.SALES_ORDER;
    var CUST = config.FIELDS.CUSTOMER;

    var STATES = {
        BOOKED: 'booked',
        AWAITING_PAYMENT: 'awaiting_payment',
        REQUESTED: 'requested',
        RELEASED: 'released',
        DELIVERED: 'delivered',
        READY: 'ready',
        NEEDS_INFO: 'needs_info'
    };

    var DESIGN_BADGES = {
        NEEDS_INFO: 'needs_info',
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
     *                         contactPhone, contactEmail, requests, payment ('BACS' | 'CARD')
     * @param {Object} ctx - { todayKey, noticeDays, holidays (set), horizonMonths, timeIds,
     *                         vehicleIds, unloadIds, addressIds, payBacs, payCard }
     * @returns {{ok: boolean, errors: Object, values: Object}}
     *   errors keyed by input name; values cleaned, with payIntent set to the list ID
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
        if (!contains(ctx.addressIds, values.address)) {
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
     * Pure: what the customer has to pay on an order.
     *   1. balance set (0 is a real value)   -> balance,                 basis 'balance'
     *   2. else total set                    -> total - (deposit || 0),  basis 'total_less_deposit'
     *   3. else                              -> null
     * A negative result is null; onOdd, if given, is told why (the caller logs CDB AMOUNT_ODD).
     *
     * @param {Object} extras - { balance, total, deposit } as the search returned them
     * @param {function(string)} [onOdd]
     * @returns {{amount: number, basis: string}|null}
     */
    function amountToPay(extras, onOdd) {
        var balance;
        var total;
        var amount;
        var basis;
        if (!extras) {
            return null;
        }
        balance = toAmount(extras.balance);
        total = toAmount(extras.total);
        if (balance !== null) {
            amount = balance;
            basis = 'balance';
        } else if (total !== null) {
            amount = Math.round((total - (toAmount(extras.deposit) || 0)) * 100) / 100;
            basis = 'total_less_deposit';
        } else {
            return null;
        }
        if (amount < 0) {
            if (onOdd) {
                onOdd('negative amount ' + amount + ' (' + basis + '; balance "' + trim(extras.balance) +
                    '", total "' + trim(extras.total) + '", deposit "' + trim(extras.deposit) + '")');
            }
            return null;
        }
        return { amount: amount, basis: basis };
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
                columns: ['entityid', 'companyname', 'firstname', 'lastname', 'isperson', 'email', 'terms',
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
     * @returns {Object[]} { id, tranId, title, siteAddress, status, subStatus, salesRep, pe,
     *                       valueProposition }
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
                OPP.VALUE_PROPOSITION
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
                valueProposition: trim(r.getValue(OPP.VALUE_PROPOSITION))
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
                columns: ['entity', 'title', 'tranid', 'salesrep', OPP.PE, OPP.VALUE_PROPOSITION,
                    OPP.STATUS]
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
     * The 1.2 extras for orders ALREADY FOUND by the main searches, in one separate search.
     * FAIL-SAFE: any error is logged once as CDB EXTRAS_FAILED and {} is returned, so the page
     * renders as in 1.1 and every order is treated as pay up front. Call it once per request.
     *
     * @param {string[]} orderIds
     * @returns {Object} soId -> { termsId, uniqueRef, balance, total, deposit }
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
                columns: [SO.TERMS, SO.UNIQUE_REF, SO.BALANCE, SO.TOTAL, SO.DEPOSIT]
            }), function (r) {
                result[String(r.id)] = {
                    termsId: trim(r.getValue(SO.TERMS)),
                    uniqueRef: trim(r.getValue(SO.UNIQUE_REF)),
                    balance: trim(r.getValue(SO.BALANCE)),
                    total: trim(r.getValue(SO.TOTAL)),
                    deposit: trim(r.getValue(SO.DEPOSIT))
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

    /**
     * The customer's address book lines. The value of each is the line's internal ID, which is
     * what shipaddresslist holds.
     * @returns {Array<{id: string, text: string}>}
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
            id = trim(customer.getSublistValue({ sublistId: 'addressbook', fieldId: 'id', line: i })) ||
                trim(customer.getSublistValue({ sublistId: 'addressbook', fieldId: 'internalid', line: i }));
            label = trim(customer.getSublistValue({ sublistId: 'addressbook', fieldId: 'label', line: i }));
            text = trim(customer.getSublistValue({ sublistId: 'addressbook',
                fieldId: 'addressbookaddress_text', line: i }));
            if (id !== '') {
                lines.push({ id: id, text: text ? text.replace(/\s*\n\s*/g, ', ') : label, label: label });
            }
        }
        return lines;
    }

    return {
        VERSION: VERSION,
        STATES: STATES,
        DESIGN_BADGES: DESIGN_BADGES,
        PAYMENT: PAYMENT,
        GUARD: GUARD,
        contains: contains,
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
        deliveryDateKey: deliveryDateKey,
        groupRecent: groupRecent,
        getRecentlyDelivered: getRecentlyDelivered,
        oppIdsOf: oppIdsOf,
        decorateAll: decorateAll,
        arrangeSections: arrangeSections,
        guardOrder: guardOrder,
        getNonDeliveryDates: getNonDeliveryDates,
        getListOptions: getListOptions,
        getAddressBook: getAddressBook
    };
});
