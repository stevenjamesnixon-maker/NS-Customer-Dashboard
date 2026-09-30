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
 *   1. a linked opportunity (the native opportunity field, mainline T);
 *   2. its native status is one that can still ship: config.SHIPPABLE_STATUSES (addendum). This
 *      is a SEARCH FILTER, never a comparison against a column value, because the status column
 *      does not return the SalesOrd:X codes;
 *   3. its Record Status (custbody_finance_status) is blank or not in the excluded list — the same
 *      definition as NS-Opportunity-SO-Sync, with this repo's own twin of the list;
 *   4. its quote type is not an excluded one (Parts, FOC). A blank quote type is not excluded.
 * 1 and 2 are in the search; 3 and 4 are in isOpenOrder(), which is pure and node-tested.
 *
 * The pure functions — isOpenOrder, orderState, groupProjects, resolveRecipient,
 * validateDelivery — take plain rows and are node-tested (test/grouping.test.js,
 * test/validation.test.js). The search functions only fetch and shape.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/search', 'N/record', 'N/format', './cdb_lib_config', './cdb_lib_dates'],
    function (search, record, format, config, dates) {

    'use strict';

    var VERSION = '1.0.0';

    var OPP = config.FIELDS.OPPORTUNITY;
    var SO = config.FIELDS.SALES_ORDER;
    var CUST = config.FIELDS.CUSTOMER;

    var STATES = {
        BOOKED: 'booked',
        AWAITING_PAYMENT: 'awaiting_payment',
        READY: 'ready',
        NEEDS_INFO: 'needs_info'
    };

    var DESIGN_BADGES = {
        NEEDS_INFO: 'needs_info',
        DESIGNING: 'designing'
    };

    var PAYMENT = { BACS: 'BACS', CARD: 'CARD' };

    /** Why the guard refused. The customer sees a short notice, never these. */
    var GUARD = {
        NOT_FOUND: 'order not found, or its native status cannot ship',
        NOT_YOURS: 'order belongs to another customer',
        NOT_OPEN: 'order is not open (Record Status or quote type excluded, or no opportunity)',
        BOOKED: 'delivery already confirmed (custbody_del_date set)',
        ALREADY_REQUESTED: 'delivery already requested (custbody_cust_pay_intent set)',
        NOT_READY: 'order is not ready for delivery'
    };

    // ---------------------------------------------------------------- pure

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
        if (contains(cfg.EXCLUDED_STATUSES, order.recordStatus)) {
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
    function orderState(order) {
        if (trim(order.confirmedDateKey) !== '') {
            return STATES.BOOKED;
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
                    state = orderState(ordersByOpp[opp.id][j]);
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

        values.payment = trim(input.payment).toUpperCase();
        if (values.payment === PAYMENT.BACS) {
            values.payIntent = String(ctx.payBacs);
        } else if (values.payment === PAYMENT.CARD) {
            values.payIntent = String(ctx.payCard);
        } else {
            errors.payment = 'Please choose how you would like to pay.';
        }

        for (key in errors) {
            if (errors.hasOwnProperty(key)) {
                return { ok: false, errors: errors, values: values };
            }
        }
        return { ok: true, errors: errors, values: values };
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
                columns: ['entityid', 'companyname', 'firstname', 'lastname', 'isperson', 'email',
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
            email: trim(r.email),
            salesRep: lookupSelect(r.salesrep).value,
            dashboardContact: lookupSelect(r[CUST.DASHBOARD_CONTACT]).value,
            isInactive: isTicked(r.isinactive)
        };
    }

    /**
     * @param {string} employeeId
     * @returns {Object|null} { id, name, phone, email, isInactive }
     */
    function getEmployee(employeeId) {
        var r;
        if (trim(employeeId) === '') {
            return null;
        }
        try {
            r = search.lookupFields({
                type: search.Type.EMPLOYEE,
                id: employeeId,
                columns: ['entityid', 'firstname', 'lastname', 'phone', 'mobilephone', 'email',
                    'isinactive']
            });
        } catch (e) {
            return null;
        }
        return {
            id: String(employeeId),
            name: trim(trim(r.firstname) + ' ' + trim(r.lastname)) || trim(r.entityid),
            phone: trim(r.phone) || trim(r.mobilephone),
            email: trim(r.email),
            isInactive: isTicked(r.isinactive)
        };
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
            filters: [
                ['mainline', 'is', 'T'], 'AND',
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

    /** The order columns every order read uses. */
    function orderColumns() {
        return ['tranid', 'entity', SO.OPPORTUNITY, SO.RECORD_STATUS, SO.QUOTE_TYPE,
            SO.CONFIRMED_DATE, SO.PAY_INTENT, SO.READY, SO.HOLD_REASON, SO.SHIP_DATE, SO.TIME];
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
            timeText: trim(r.getText(SO.TIME))
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
        return groupProjects(opps, getOrdersForOpportunities(wonIds), cfg);
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
        validateDelivery: validateDelivery,
        openOrderFilters: openOrderFilters,
        dateKey: dateKey,
        dateFilterValue: dateFilterValue,
        isTicked: isTicked,
        lookupSelect: lookupSelect,
        getCustomer: getCustomer,
        getEmployee: getEmployee,
        getContactEmail: getContactEmail,
        getOpportunities: getOpportunities,
        getOrdersForOpportunities: getOrdersForOpportunities,
        getProjects: getProjects,
        guardOrder: guardOrder,
        getNonDeliveryDates: getNonDeliveryDates,
        getListOptions: getListOptions,
        getAddressBook: getAddressBook
    };
});
