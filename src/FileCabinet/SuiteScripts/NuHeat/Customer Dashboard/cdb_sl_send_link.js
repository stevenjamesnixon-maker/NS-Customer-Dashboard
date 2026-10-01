/**
 * cdb_sl_send_link.js
 *
 * "Send delivery link" (release 2.0): emails the customer a direct link to book delivery for ONE
 * sales order. Internal Suitelet, LOGIN REQUIRED (never Available Without Login), GET only, reached
 * from the button cdb_ue_salesorder.js adds to the sales order.
 *
 *   GET ?so=<sales order id>
 *
 * STEPS
 *   1. config.load(): this script's custscript_cdbsend_ parameters (SCRIPT_KEYS column SEND).
 *   2. The customer is the order's OPPORTUNITY's customer (data.orderCustomer()), never the order's
 *      entity, and data.guardOrder() runs for that customer: the full "open + ready + not booked,
 *      requested or released" definition. Refused -> back to the order with cdbsl=refused;
 *      CDB SEND_REFUSED with the guard's reason.
 *   3. Recipient: data.emailRecipient() — the dashboard contact's email, else the customer's (the
 *      digest's rule). None, or not an email -> refused; CDB SEND_NO_RECIPIENT.
 *   4. Author: data.emailAuthor() — the customer's sales rep if active, else the fallback employee
 *      (the digest's rule, so the customer sees the same person everywhere). NOT the user who
 *      pressed the button.
 *   5. The email: render.deliveryLinkEmail() with the direct link
 *      token.buildLink(customer, { a: 'delivery', so }) and the dashboard link
 *      token.buildLink(customer); the order's extras (split reference, type label) as the dashboard
 *      reads them. 2.0.1: the short type label ("Order SO… · UFH") comes from
 *      custscript_cdbsend_quote_type_labels, with the dashboard's parser and fallback: empty or
 *      invalid -> the quote type's own text, logged once (CDB PARAMETER_DEFAULT when empty,
 *      CDB TYPE_LABELS_INVALID when invalid), never failing the send.
 *      2.0.2: in the customer email standard (Send Quote 2.2.0's card, footer and robustness rules);
 *      the AM card is the author, with firstname and photo from the same lookup (data.emailAm(),
 *      CDB AM_PHOTO once per email).
 *      2.0.3: the v2 design (docs/design/canvas/EmailDeliveryLink.dc.html): the hero
 *      (config.EMAIL_HERO_URL), the "Your order" facts — the earliest delivery date by the delivery
 *      form's own calculation (earliestKey(): custscript_cdbsend_notice_days, weekends, the
 *      non-delivery dates; fail-safe, CDB EARLIEST_FAILED), and the amount to pay for pay-up-front
 *      orders (custscript_cdbsend_prepay_terms / _pay_account, as the dashboard decides it) — and the
 *      "Before you book" icons (custscript_cdbsend_icon_*).
 *   6. email.send with relatedRecords { entityId: customer, transactionId: order }, so it shows on
 *      both Communication tabs. Any failure -> cdbsl=failed; CDB SEND_FAILED.
 *   7. CDB SEND_LINK: the order, the customer, the recipient, the author and the user who pressed.
 *   8. redirect.toRecord back to the order with cdbsl=sent.
 *
 * WRITES NO RECORD. Sending changes nothing on the order; a resend is just another email.
 * It never writes custbody_del_date or the Record Status.
 *
 * THE CURRENT USER is read ONCE, for the CDB SEND_LINK log line only. This is the one script in the
 * repo that may: it requires a login. It is never the author, and never decides anything.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @version 2.0.3
 */
define(['N/record', 'N/email', 'N/redirect', 'N/runtime', 'N/log', './lib/cdb_lib_config',
    './lib/cdb_lib_token', './lib/cdb_lib_dates', './lib/cdb_lib_data', './lib/cdb_lib_render'],
    function (record, email, redirect, runtime, log, config, token, dates, data, render) {

    'use strict';

    var VERSION = '2.0.3';

    /** The banner codes cdb_ue_salesorder.js shows (config.SEND_LINK_BANNERS). */
    var OUTCOME = { SENT: 'sent', REFUSED: 'refused', FAILED: 'failed' };

    function title(name) {
        return config.logTitle(name);
    }

    function message(e) {
        return e && e.message ? e.message : String(e);
    }

    /** Back to the sales order, with the banner code and the time it was set. */
    function back(orderId, outcome) {
        redirect.toRecord({
            type: record.Type.SALES_ORDER,
            id: orderId,
            parameters: { cdbsl: outcome, cdblt: String(Date.now()) }
        });
    }

    /** Logs a refusal. @returns {string} OUTCOME.REFUSED */
    function refuse(orderId, key, details) {
        log.audit({ title: title(key), details: 'Sales order ' + orderId + ': ' + details });
        return OUTCOME.REFUSED;
    }

    /** The user who pressed the button, for the log only. */
    function pressedBy() {
        var user;
        try {
            user = runtime.getCurrentUser();
            return String(user.id) + (user.name ? ' (' + user.name + ')' : '');
        } catch (e) {
            return '(unknown)';
        }
    }

    /**
     * 2.0.1: the short quote type labels, as the dashboard reads them. Never throws: an invalid value
     * logs CDB TYPE_LABELS_INVALID once and gives {}, so each type shows its own text.
     */
    function typeLabels(cfg) {
        var parsed = config.parseTypeLabels(cfg.QUOTE_TYPE_LABELS);
        if (parsed.status === 'invalid') {
            log.audit({ title: title('TYPE_LABELS_INVALID'), details: 'custscript_cdbsend_quote_type_labels ignored: ' +
                parsed.detail });
        }
        return parsed.labels || {};
    }

    /**
     * 2.0.3: the first date the delivery form would offer — the same calculation (notice days, weekends,
     * the non-delivery dates, the booking horizon). '' when none is offered or the read fails: the
     * "Earliest delivery" row is then left out and the send goes ahead (CDB EARLIEST_FAILED).
     */
    function earliestKey(orderId, cfg) {
        var todayKey = dates.londonTodayKey(Date.now());
        var lastKey;
        var allowed;
        try {
            lastKey = dates.lastAllowedDate(todayKey, config.BOOKING_HORIZON_MONTHS);
            allowed = dates.allowedDates(todayKey, cfg.NOTICE_DAYS, data.getNonDeliveryDates(todayKey, lastKey),
                config.BOOKING_HORIZON_MONTHS);
        } catch (e) {
            log.audit({ title: title('EARLIEST_FAILED'), details: 'Sales order ' + orderId + ': ' + message(e) +
                '. Sent without the earliest delivery date.' });
            return '';
        }
        return allowed.length ? allowed[0] : '';
    }

    /** A plain answer when there is no order to go back to. */
    function plain(response, text) {
        response.setHeader({ name: 'Content-Type', value: 'text/plain; charset=utf-8' });
        response.write({ output: text });
    }

    /**
     * Steps 2 to 7 for one order. The caller redirects (step 8).
     * @returns {string} an OUTCOME
     */
    function sendFor(orderId, cfg) {
        var owner = data.orderCustomer(orderId);
        var guard;
        var customer;
        var recipient;
        var from;
        var order;
        var subject;
        var body;

        if (!owner) {
            return refuse(orderId, 'SEND_REFUSED', 'no opportunity, or the order or its opportunity could not be read');
        }
        guard = data.guardOrder(owner.customerId, orderId, cfg);
        if (!guard.ok) {
            return refuse(orderId, 'SEND_REFUSED', 'customer ' + owner.customerId + ': ' + guard.reason);
        }
        customer = data.getCustomer(owner.customerId);
        if (!customer || customer.isInactive) {
            // The link would show the invalid-link page: token.verify() refuses an inactive customer.
            return refuse(orderId, 'SEND_REFUSED', 'customer ' + owner.customerId + (customer ? ' is inactive' :
                ' could not be read'));
        }
        recipient = data.emailRecipient(customer);
        if (!recipient || !data.looksLikeEmail(recipient)) {
            return refuse(orderId, 'SEND_NO_RECIPIENT', 'customer ' + owner.customerId + ' has no valid email ' +
                '(dashboard contact ' + (customer.dashboardContact || '(none)') + ', customer email "' + customer.email + '")');
        }

        try {
            from = data.emailAuthor(customer, cfg);
            order = data.decorateOrder(guard.order, data.getOrderExtras([guard.order.id]), typeLabels(cfg), cfg,
                customer.termsId);
            subject = render.deliveryLinkSubject(config.DELIVERY_LINK_EMAIL, order.tranId);
            body = render.deliveryLinkEmail({
                text: config.DELIVERY_LINK_EMAIL,
                customerName: customer.name,
                greetingName: customer.greetingName,
                logoUrl: cfg.LOGO_URL,
                opp: guard.opportunity,
                order: order,
                earliestKey: earliestKey(orderId, cfg),
                noticeDays: cfg.NOTICE_DAYS,
                icons: { LORRY: cfg.ICON_LORRY, PARCEL: cfg.ICON_PARCEL, PEOPLE: cfg.ICON_PEOPLE },
                link: token.buildLink(owner.customerId, { a: 'delivery', so: order.id }),
                dashboardLink: token.buildLink(owner.customerId),
                am: data.emailAm(from, 'Delivery link, sales order ' + orderId)
            });
            email.send({
                author: parseInt(from.id, 10),
                recipients: [recipient],
                subject: subject,
                body: body,
                relatedRecords: { entityId: parseInt(owner.customerId, 10), transactionId: parseInt(order.id, 10) }
            });
        } catch (e) {
            log.error({ title: title('SEND_FAILED'), details: 'Sales order ' + orderId + ', customer ' +
                owner.customerId + ', to ' + recipient + ': ' + message(e) });
            return OUTCOME.FAILED;
        }

        log.audit({
            title: title('SEND_LINK'),
            details: 'Sales order ' + orderId + ' (' + order.tranId + '), customer ' + owner.customerId + ', to ' +
                recipient + ', from employee ' + from.id + ', pressed by user ' + pressedBy() + ' (v' + VERSION + ')'
        });
        return OUTCOME.SENT;
    }

    /**
     * @param {Object} context - Suitelet context
     */
    function onRequest(context) {
        var request = context.request;
        var orderId = String((request.parameters || {}).so || '').replace(/^\s+|\s+$/g, '');
        var cfg;
        var outcome;

        if (request.method !== 'GET') {
            log.audit({ title: title('SEND_REFUSED'), details: request.method + ' is not accepted; GET only' });
            plain(context.response, 'GET only.');
            return;
        }
        if (!/^\d+$/.test(orderId)) {
            log.audit({ title: title('SEND_REFUSED'), details: 'No sales order ID in the request' });
            plain(context.response, 'No sales order was given.');
            return;
        }
        try {
            cfg = config.load(log);
        } catch (e) {
            log.error({ title: title('CONFIG_FAILED'), details: message(e) });
            back(orderId, OUTCOME.FAILED);
            return;
        }
        try {
            outcome = sendFor(orderId, cfg);
        } catch (e2) {
            // A search or lookup of ours threw before the send (the send has its own catch, and
            // nothing after it throws): nothing was sent.
            log.error({ title: title('SEND_FAILED'), details: 'Sales order ' + orderId + ': ' + message(e2) +
                (e2 && e2.stack ? ' ' + e2.stack : '') });
            outcome = OUTCOME.FAILED;
        }
        back(orderId, outcome);
    }

    return { onRequest: onRequest };
});
