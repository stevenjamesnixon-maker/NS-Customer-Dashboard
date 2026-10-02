/**
 * cdb_sl_dashboard.js
 *
 * The customer dashboard. Suitelet, deployed Available Without Login, Execute As Administrator.
 *
 *   GET  ?t=<token>                         the dashboard
 *   GET  ?t=<token>&a=delivery&so=<id>      the delivery form
 *   POST  t, a=delivery, so, form fields    the request: SO fields, then a Task, then confirmation
 *   GET  ?t=<token>&a=update&opp=<id>       "Tell us where you're up to" (2.1; "Give us an update" to customers)
 *   POST  t, a=update, opp, mode, fields    update: opportunity fields, then a Task, then confirmation;
 *                                           not going ahead: objection, then Lost, then a Task (2.1)
 *   GET  ?t=<token>&a=designinfo&opp=<id>   "Tell us about your property" (2.3)
 *   POST  t, a=designinfo, opp, sec|send,   the answers (multipart, with files): fields, files, state, a Note;
 *         q_<qid>, f_<qid>_<n>              on send=1 also a Task (2.3)
 *
 * THE CUSTOMER IS THE TOKEN'S. Every request verifies the token first, and the customer ID used
 * from then on comes from the verified token, never from a request parameter. The sales order ID
 * does come from the request, so every read and write of an order goes through
 * data.guardOrder(), which checks that the order's opportunity belongs to THIS customer.
 *
 * NO CURRENT USER. A no-login Suitelet runs as user -4. runtime.getCurrentUser() is not used in
 * this script. (2.0: the one exception in the repo is the login-required cdb_sl_send_link.js, which
 * logs who pressed the button and nothing more.)
 *
 * DIRECT LINKS (2.0): every customer action is addressable as ?t=…&a=<action>&<id>=…, so an email can
 * link straight to the action (the "Send delivery link" email links to ?t=…&a=delivery&so=…), and
 * the confirmation pages link back to the dashboard.
 *
 * THE OPPORTUNITY ID ALSO COMES FROM THE REQUEST (2.1), so every update read and write goes through
 * data.guardOpportunity(): the opportunity's entity is THIS customer, and it is neither Won nor Lost.
 *
 * WHAT THIS SCRIPT WRITES — and nothing else:
 *   - the sales order fields in brief B5 (setOrderFields below), plus, from 1.1, two OPTIONAL
 *     fields written only when so.getField() finds them on the loaded record:
 *     custbody_cdb_awaiting_payment := true (never cleared by anything in this repo) and
 *     custbody_edd_certainty := custscript_cdb_edd_definite_value (skipped when that is empty);
 *   - one Task per request (lib/cdb_lib_task.js);
 *   - 2.1, ONLY through the Online-quote Update Opportunity library (config.OPPLIB, >= 1.2.0):
 *     custbody_build_stage and custbody_opp_del_date (writeOppUpdate, changed values only, blank never
 *     clears), entitystatus = the Lost status for the customer's stage (writeOppUpdate), and one
 *     Customer Objection (createObjections);
 *   - 2.2, the opportunity's title (the project name), by the dashboard ITSELF; 2.2.1, with the site address
 *     (custbody_opp_site_adress, Long Text) — data.writeProjectDetails(), one
 *     write of the changed ones of those two fields only, after guardOpportunity(), after the
 *     library's write;
 *   - 2.2, with "Add a new address…": one line on the customer's address book (data.addToAddressBook(),
 *     unless the same address is already there), and custbody_cdb_delivery_address on the order's
 *     opportunity (data.writeDeliveryAddress(), only when the field exists);
 *   - 2.3, "Tell us about your property": through data.writeDesignInfo() only, the registry's Project
 *     Specification fields (type-verified, changed, non-empty, never config.DESIGNINFO_DENY) and the state field
 *     custbody_cdb_designinfo_state; the customer's files (File Cabinet, attached to the opportunity); one Note per
 *     save; one Task per Send. Never custbody_opp_del_date (the goods date is Note, state and Task only).
 * It NEVER writes custbody_del_date (the confirmed date: a workflow runs from it),
 * custbody_finance_status (the Record Status), custbody_opportunity_sub_status, any other opportunity
 * field, any estimate, or any customer field but that one address book line.
 *
 * THE LIBRARY IS OPTIONAL (2.1). It is required at request time by absolute path, not in define(): if it
 * is missing or older than 1.2.0, the update action is unavailable (no button; a direct link says to
 * call the account manager), CDB OPPLIB_VERSION is logged once, and everything else works as before.
 *
 * ANY LINK FAILURE shows one generic page and logs the reason at audit. A failure of our own
 * (a missing parameter, a search that throws) shows a generic error page and logs at ERROR.
 *
 * GOVERNANCE. 1,000 units per request. A GET is about 60, a POST about 120. The remaining usage
 * is logged at the end of every request as CDB USAGE. 2.2: a new address adds up to 40 — the customer's
 * load (5), save (10) and reload to find the line (5), then the opportunity's load (10) and its one-field
 * write (10); a project name adds one one-field write (10). Both writes are in cdb_lib_data, never here.
 * 2.2.1: the project details write is one write (10) for either or both fields. (2.2.2: no opportunity load
 * on the update page: 2.2.1's site address type check is gone.)
 *
 * 2.2.1 (PR #8 amendment 1): "Your project details" (the reference and the site address); the delivery
 * form's TIME_DEFAULT (pre-selected, and booked when no time is posted) and UNLOAD_SURCHARGE (shown under
 * the option, on the confirmation and in the Task — the dashboard never adds an item line: the rep does).
 *
 * 2.2.2 (PR #8 amendment 2): "Site address" is always offered (the field is Long Text, confirmed in
 * Production, 2 Oct 2026; the runtime type check and CDB SITE_ADDRESS_NOT_TEXT are gone). Ready-to-book
 * orders show their current forecast date — the order's own custbody_defaultshipdate (order.shipDateKey,
 * already read), today or later — on the dashboard row and the delivery form (render).
 *
 * 2.3.0 (release 2.3, "Tell us about your property"): a=designinfo. data.guardDesignInfo() (the token's customer's,
 * Won, NEEDINFO -> edit / DESIGN -> view, FC not none; NOT guardOpportunity(), which refuses Won), the registry
 * (setting DESIGNINFO_REGISTRY; unavailable without it, CDB DESIGNINFO_NO_REGISTRY), ONE dynamic record.load that
 * is never saved. A POST validates everything first (errors: nothing written), then, each step in its own try and
 * reported in the Note and the Task: 1. the changed, non-empty, type-verified fields (one data.writeDesignInfo(),
 * with the state when no files came), 2. each file saved into DESIGNINFO_FOLDER and attached to the opportunity, 3. the state
 * (custbody_cdb_designinfo_state) when step 1 could not carry it, 4. the Note (every save), 5. the DESIGN INFO Task
 * (send=1 only). NEVER custbody_opp_del_date (the goods date is Note, state and Task only: amendment 1 §1), the
 * sub-status, the Sales MI or custbody_cad_des_contact (config.DESIGNINFO_DENY). The dashboard's design rows show
 * the four card states from the fail-safe extras search (data.getOpportunityExtras(), one search; the registry is
 * read only when a card needs its progress).
 *
 * GOVERNANCE 2.3 (units): a designinfo GET is about 34 — the settings search 10, the token's and the customer's
 * lookups 2, the guard's lookupFields 1, the registry's file.load 10, the opportunity's record.load 10 (dynamic or
 * standard, a transaction load is 10), the recipient's employee lookup 1 (a fallback adds 1). A POST is the GET's 34
 * plus the opportunity write 10 (two with files: fields, then the state), each file 30 (save 20 + attach 10), the Note
 * 10 and, on Send, the Task 10: about 164 with three files and Send, 64 for a Send without files. The dashboard
 * adds one extras search (10) when a project is in design, and the registry (10) only for a card in progress.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @version 2.3.0
 */
define(['N/record', 'N/runtime', 'N/log', './lib/cdb_lib_config', './lib/cdb_lib_token',
    './lib/cdb_lib_dates', './lib/cdb_lib_data', './lib/cdb_lib_render', './lib/cdb_lib_task', './lib/cdb_lib_designinfo',
    'require'],
    function (record, runtime, log, config, token, dates, data, render, task, designinfo, requireModule) {

    'use strict';

    var VERSION = '2.3.0';

    var OPP = config.FIELDS.OPPORTUNITY;

    var SO = config.FIELDS.SALES_ORDER;

    /** How each payment choice reads to staff: the change log and the Task. */
    var PAYMENT_TEXT = { BACS: 'BACS', CARD: 'Card, account manager to call', ACCOUNT: 'Add to account' };
    var PAYMENT_CHOICE = { BACS: 'BACS', CARD: 'Card', ACCOUNT: 'Add to account' };

    var NOTICES = {
        GENERIC: 'That order can\'t be booked online at the moment. Your account manager will be in touch.',
        BOOKED: 'Delivery for order {tranid} is already booked.',
        ALREADY: 'You\'ve already requested delivery for order {tranid}. Your account manager will be in touch.',
        // 2.1: guardOpportunity() refusals.
        OPP_GENERIC: 'That project can\'t be updated online. Please contact your account manager.',
        OPP_WON: 'That project has been ordered, so there\'s nothing to update here.',
        OPP_LOST: 'That project is closed. If anything has changed, please contact your account manager.'
    };

    function title(name) {
        return config.logTitle(name);
    }

    /** Log details are cut at 3,999 characters by NetSuite; cut them ourselves, visibly. */
    function clip(text) {
        return text.length > 3900 ? text.slice(0, 3900) + ' ...[truncated]' : text;
    }

    /**
     * @param {Object} response
     * @param {string} html
     */
    function send(response, html) {
        response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
        response.setHeader({ name: 'Cache-Control', value: 'no-store' });
        response.setHeader({ name: 'X-Frame-Options', value: 'DENY' });
        response.write({ output: html });
    }

    /**
     * 1.2: THE PERSON THE CUSTOMER SEES — header, footer, form and confirmations: the customer's own
     * sales rep (customer.salesrep), or the fallback employee when the rep is empty, inactive or
     * unreadable. The same person the digest sends from. NOT the Task assignee: see taskAssignee().
     */
    function customerManager(ctx) {
        var rep = ctx.customer.salesRep ? data.getEmployee(ctx.customer.salesRep) : null;
        var id = ctx.customer.salesRep;
        var source = 'salesrep';
        if (!rep || rep.isInactive) {
            id = String(ctx.cfg.FALLBACK_EMPLOYEE);
            source = 'fallback';
            rep = data.getEmployee(id);
        }
        return {
            id: id,
            source: source,
            name: rep ? rep.name : '',
            phone: rep ? rep.phone : '',
            email: rep ? rep.email : ''
        };
    }

    /**
     * Who gets the Task for an opportunity (brief C6: the PE for PE-case value propositions, else
     * the rep, else the fallback). Unchanged in 1.2; since 1.2 it is used ONLY for Task routing.
     */
    function taskAssignee(opp, cfg) {
        var recipient = opp ? data.resolveRecipient(opp, cfg) :
            { employeeId: String(cfg.FALLBACK_EMPLOYEE), source: 'fallback' };
        var employee = data.getEmployee(recipient.employeeId);
        if (!employee && recipient.source !== 'fallback') {
            recipient = { employeeId: String(cfg.FALLBACK_EMPLOYEE), source: 'fallback' };
            employee = data.getEmployee(recipient.employeeId);
        }
        return {
            id: recipient.employeeId,
            source: recipient.source,
            name: employee ? employee.name : '',
            firstName: employee ? employee.firstName : '',
            phone: employee ? employee.phone : '',
            email: employee ? employee.email : ''
        };
    }

    /** CDB AMOUNT_ODD: an amount that came out negative, so is not shown. */
    function amountOdd(why) {
        log.audit({ title: title('AMOUNT_ODD'), details: why });
    }

    /**
     * The short quote type labels, parsed once per request. Invalid JSON logs CDB TYPE_LABELS_INVALID
     * once and falls back to each quote type's own text. Never fails the page.
     */
    function typeLabels(ctx) {
        var parsed;
        if (!ctx.typeLabels) {
            parsed = config.parseTypeLabels(ctx.cfg.QUOTE_TYPE_LABELS);
            if (parsed.status === 'invalid') {
                log.audit({ title: title('TYPE_LABELS_INVALID'), details: 'custscript_cdb_quote_type_labels ignored: ' +
                    parsed.detail });
            }
            ctx.typeLabels = parsed.labels;
        }
        return ctx.typeLabels;
    }

    /** Amendment 2: both term IDs, so a dispute over the payment options offered can be traced. */
    function termsNote(order) {
        return 'terms: customer ' + (order.customerTermsId || '(blank)') + ', order ' + (order.termsId || '(blank)') +
            ' -> ' + (order.prepay ? 'pay up front' : 'account');
    }

    /** 1.2: the payment options an order is offered. */
    function paymentOptions(order) {
        return order.prepay ? [data.PAYMENT.BACS, data.PAYMENT.CARD] : [data.PAYMENT.BACS, data.PAYMENT.ACCOUNT];
    }

    function bankOf(cfg) {
        return { name: cfg.BANK_NAME, sort: cfg.BANK_SORT, account: cfg.BANK_ACCOUNT };
    }

    /**
     * The dashboard page.
     * @param {Object} ctx - { cfg, customer, baseUrl }
     * @param {string} [notice]
     */
    function renderDashboard(ctx, notice) {
        var groups = data.getProjects(ctx.customer.id, ctx.cfg);
        var am = customerManager(ctx);
        var todayKey = dates.londonTodayKey(Date.now());
        var canUpdate;
        // 1.3: one more search per page (recently delivered; fail-safe), and still ONE extras search
        // for every order on the page, recent rows included. A failed extras search leaves them
        // pay-up-front.
        data.decorateAll(groups, data.getRecentlyDelivered(ctx.customer.id, data.oppIdsOf(groups), ctx.cfg, todayKey),
            typeLabels(ctx), ctx.cfg, ctx.customer.termsId, todayKey, amountOdd);
        // 1.3.2: "Projects for delivery" keeps what needs the customer; the rest is "Booked deliveries".
        data.arrangeSections(groups);
        // 2.1: the library is only needed (and only required) when there is an open quote to show it on.
        canUpdate = groups.toOrder.length > 0 && !!oppLib().lib;
        // 2.3: the design rows' card states.
        if (groups.inDesign.length) {
            decorateDesignRows(ctx, groups, todayKey);
        }
        return render.dashboard({
            customerName: ctx.customer.name,
            greetingName: ctx.customer.greetingName,
            logoUrl: ctx.cfg.LOGO_URL,
            am: am,
            groups: groups,
            notice: notice || '',
            bank: bankOf(ctx.cfg),
            payBacs: ctx.cfg.PAY_BACS,
            recentDays: ctx.cfg.RECENT_DAYS,
            deliveryUrl: function (orderId) {
                return ctx.baseUrl + '&a=delivery&so=' + encodeURIComponent(orderId);
            },
            updateUrl: canUpdate ? function (oppId) {
                return ctx.baseUrl + '&a=update&opp=' + encodeURIComponent(oppId);
            } : null,
            // 2.3: only with a registry setting (an unreadable registry shows "not available" on the page itself).
            designInfoUrl: ctx.cfg.DESIGNINFO_REGISTRY ? function (oppId) {
                return ctx.baseUrl + '&a=designinfo&opp=' + encodeURIComponent(oppId);
            } : null
        });
    }

    /**
     * 2.3 (brief §6): the four card states for the dashboard's design rows — the extras search (fail-safe), the
     * registry only when a card in progress needs its section titles, the PE/AM's first name for "Information received".
     */
    function decorateDesignRows(ctx, groups, todayKey) {
        var ids = groups.inDesign.map(function (d) { return d.opp.id; });
        var extras = data.getOpportunityExtras(ids);
        var once = onceLogger();
        var needRegistry = groups.inDesign.some(function (d) {
            var st = designinfo.parseState((extras[d.opp.id] || {}).state).state;
            return data.contains(ctx.cfg.NEEDINFO_SUBSTATUS, d.opp.subStatus) && !st.sent && designinfo.anySectionSaved(st);
        });
        var reg = needRegistry ? data.loadRegistry(ctx.cfg.DESIGNINFO_REGISTRY) : null;
        if (reg && reg.status !== 'ok') {
            once('DESIGNINFO_NO_REGISTRY', 'Dashboard: registry ' + reg.status + (reg.detail ? ' (' + reg.detail + ')' : '') +
                '; cards in progress say "a few more details"');
        }
        data.decorateDesign(groups, {
            extras: extras,
            questions: reg && reg.status === 'ok' ? reg.questions : null,
            cfg: ctx.cfg,
            todayKey: todayKey,
            firstNameOf: function (opp) { return taskAssignee(opp, ctx.cfg).firstName; },
            onStateInvalid: function (oppId, detail) {
                once('DESIGNINFO_STATE_INVALID', 'Opportunity ' + oppId + ': ' + detail + '; shown as nothing received');
            }
        });
    }

    /**
     * The notice for a guard failure, and the audit line.
     */
    function guardNotice(ctx, guard, orderId) {
        var tranId = guard.order ? guard.order.tranId : '';
        log.audit({
            title: title('GUARD_REFUSED'),
            details: 'Customer ' + ctx.customer.id + ', sales order ' + orderId + ': ' + guard.reason
        });
        if (guard.reason === data.GUARD.ALREADY_REQUESTED) {
            return NOTICES.ALREADY.replace('{tranid}', tranId);
        }
        if (guard.reason === data.GUARD.BOOKED) {
            return NOTICES.BOOKED.replace('{tranid}', tranId);
        }
        return NOTICES.GENERIC;
    }

    /**
     * Everything the delivery form needs besides the values.
     */
    function formContext(ctx, guard) {
        var todayKey = dates.londonTodayKey(Date.now());
        var lastKey = dates.lastAllowedDate(todayKey, config.BOOKING_HORIZON_MONTHS);
        var holidays = data.getNonDeliveryDates(todayKey, lastKey);
        var allowed = dates.allowedDates(todayKey, ctx.cfg.NOTICE_DAYS, holidays,
            config.BOOKING_HORIZON_MONTHS);
        var time = data.getListOptions(config.RECORD_TYPES.LIST_TIME, ctx.cfg.TIME_VALUES);
        var vehicle = data.getListOptions(config.RECORD_TYPES.LIST_VEHICLE, ctx.cfg.VEHICLE_VALUES);
        var unload = data.getListOptions(config.RECORD_TYPES.LIST_UNLOAD, ctx.cfg.UNLOAD_VALUES);
        var address = data.getAddressBook(ctx.customer.id);
        var hints = config.parseOptionHints(ctx.cfg.OPTION_HINTS);
        var surcharge = config.parseUnloadSurcharge(ctx.cfg.UNLOAD_SURCHARGE);
        var timeDefault = '';

        // 1.2: the extras for this one order, once per request. Sets typeLabel, uniqueRef, prepay
        // and amount on the guard's order row.
        data.decorateOrder(guard.order, data.getOrderExtras([guard.order.id]), typeLabels(ctx), ctx.cfg,
            ctx.customer.termsId, amountOdd);

        // Once per request (formContext runs once per GET or POST). Never fails the page.
        if (hints.status === 'invalid') {
            log.audit({ title: title('OPTION_HINTS_INVALID'), details: 'custscript_cdb_option_hints ignored: ' +
                hints.detail });
        }

        // 2.2.1: also once per request. An invalid surcharge setting means no surcharge.
        if (surcharge.status === 'invalid') {
            log.audit({ title: title('UNLOAD_SURCHARGE_INVALID'), details: 'Setting UNLOAD_SURCHARGE ignored, so no ' +
                'surcharge is shown: ' + surcharge.detail });
        }
        // 2.2.1: the default time only when it is one of the times offered; otherwise as before, logged.
        if (ctx.cfg.TIME_DEFAULT) {
            if (data.contains(ids(time.options), ctx.cfg.TIME_DEFAULT)) {
                timeDefault = String(ctx.cfg.TIME_DEFAULT);
            } else {
                log.audit({ title: title('TIME_DEFAULT_INVALID'), details: 'Setting TIME_DEFAULT ' + ctx.cfg.TIME_DEFAULT +
                    ' is not one of the times offered [' + ids(time.options).join(',') + ']: no default time' });
            }
        }

        if (time.missing.length || vehicle.missing.length || unload.missing.length) {
            log.audit({
                title: title('LIST_VALUE_MISSING'),
                details: 'Parameter IDs not found in their list, so not offered. Time: [' +
                    time.missing.join(',') + '] vehicle: [' + vehicle.missing.join(',') +
                    '] unload: [' + unload.missing.join(',') + ']'
            });
        }
        return {
            todayKey: todayKey,
            holidays: holidays,
            allowedSet: dates.toSet(allowed),
            months: dates.calendarMonths(todayKey, lastKey),
            options: { time: time.options, vehicle: vehicle.options, unload: unload.options,
                address: address },
            hints: hints.hints,
            timeDefault: timeDefault,
            surcharges: surcharge.amounts,
            am: customerManager(ctx),
            assignee: taskAssignee(guard.opportunity, ctx.cfg)
        };
    }

    function ids(options) {
        var result = [];
        var i;
        for (i = 0; i < options.length; i++) {
            result.push(String(options[i].id));
        }
        return result;
    }

    function textOf(options, id) {
        var i;
        for (i = 0; i < options.length; i++) {
            if (String(options[i].id) === String(id)) {
                return options[i].text;
            }
        }
        return '';
    }

    function renderForm(ctx, guard, fc, values, errors) {
        var hasErrors = false;
        var key;
        for (key in (errors || {})) {
            if (errors.hasOwnProperty(key)) {
                hasErrors = true;
            }
        }
        return render.deliveryForm({
            logoUrl: ctx.cfg.LOGO_URL,
            am: fc.am,
            order: guard.order,
            opp: guard.opportunity,
            actionUrl: ctx.baseUrl,
            backUrl: ctx.baseUrl,
            token: ctx.token,
            months: fc.months,
            allowedSet: fc.allowedSet,
            values: values,
            errors: errors || {},
            hasErrors: hasErrors,
            options: fc.options,
            limits: config.TEXT_LIMITS,
            hints: fc.hints,
            guidance: config.DELIVERY_GUIDANCE,
            noticeDays: ctx.cfg.NOTICE_DAYS,
            paymentOptions: paymentOptions(guard.order),
            surcharges: fc.surcharges
        });
    }

    /** 2.2.1: { optionName, amount } when the unloading option chosen carries a surcharge, else null. */
    function surchargeOf(fc, unloadId) {
        return fc.surcharges.hasOwnProperty(String(unloadId)) ?
            { optionName: textOf(fc.options.unload, unloadId), amount: fc.surcharges[String(unloadId)] } : null;
    }

    /** GET ?a=delivery&so= */
    function handleDeliveryGet(ctx, orderId) {
        var guard = data.guardOrder(ctx.customer.id, orderId, ctx.cfg);
        var fc;
        var so;
        if (!guard.ok) {
            return renderDashboard(ctx, guardNotice(ctx, guard, orderId));
        }
        fc = formContext(ctx, guard);
        so = record.load({ type: record.Type.SALES_ORDER, id: guard.order.id, isDynamic: false });
        return renderForm(ctx, guard, fc, {
            // 2.2.1: TIME_DEFAULT, when it is offered; '' otherwise (nothing pre-selected, as before).
            time: fc.timeDefault,
            address: String(so.getValue({ fieldId: SO.SHIP_ADDRESS }) || ''),
            contactName: so.getValue({ fieldId: SO.CONTACT_NAME }) || '',
            contactPhone: so.getValue({ fieldId: SO.CONTACT_PHONE }) || '',
            contactEmail: so.getValue({ fieldId: SO.CONTACT_EMAIL }) || ''
        }, {});
    }

    /** The submitted form fields, raw. 2.2.1: no time posted means the default time, when there is one. */
    function formInput(params, fc) {
        var noTime = params.time === null || params.time === undefined || String(params.time).replace(/\s+/g, '') === '';
        return {
            date: params.date,
            time: noTime && fc.timeDefault ? fc.timeDefault : params.time,
            address: params.address,
            vehicle: params.vehicle,
            unload: params.unload,
            contactName: params.contactName,
            contactPhone: params.contactPhone,
            contactEmail: params.contactEmail,
            requests: params.requests,
            payment: params.payment,
            // 2.2: "Add a new address…" (address=new); validated only then.
            addr1: params.addr1,
            addr2: params.addr2,
            city: params.city,
            county: params.county,
            zip: params.zip
        };
    }

    /**
     * Sets the B5 fields on the loaded order, then the two optional 1.1 fields, and returns
     * old -> new for each field written. 2.2: v.address '' (a new address that did not reach the address
     * book) leaves the ship-to address as it is; v.addressText, when set, is the address's text.
     * THE ONLY SALES ORDER WRITE IN THIS REPO. custbody_del_date and custbody_finance_status are
     * not in this list and must never be added. custbody_cdb_awaiting_payment is only ever set
     * TRUE here: staff release and bill the order and it stays ticked.
     */
    function setOrderFields(so, v, fc, now, cfg, orderId) {
        var dateText = function (value) {
            return value instanceof Date ? dates.formatLong(dates.keyFromLocalDate(value)) : String(value || '');
        };
        var optional = [
            { label: 'Awaiting customer payment', fieldId: SO.AWAITING_PAYMENT, value: true, newText: 'Yes',
                checkbox: true }
        ];
        // 1.2: an Add-to-account booking has nothing to pay, so the box is not ticked. It is still
        // never unticked by anything in this repo.
        if (v.payment === data.PAYMENT.ACCOUNT) {
            optional = [];
        }
        var specs = [
            { label: 'Delivery date', fieldId: SO.SHIP_DATE, value: dates.localDateForWrite(v.date),
                newText: dates.formatLong(v.date), date: true },
            { label: 'Delivery time', fieldId: SO.TIME, value: v.time,
                newText: textOf(fc.options.time, v.time) },
            { label: 'Delivery address', fieldId: SO.SHIP_ADDRESS, value: v.address,
                newText: v.addressText || textOf(fc.options.address, v.address) },
            { label: 'Vehicle', fieldId: SO.VEHICLE, value: v.vehicle,
                newText: textOf(fc.options.vehicle, v.vehicle) },
            { label: 'Unloading', fieldId: SO.UNLOAD, value: v.unload,
                newText: textOf(fc.options.unload, v.unload) },
            { label: 'Site contact', fieldId: SO.CONTACT_NAME, value: v.contactName, newText: v.contactName },
            { label: 'Site contact phone', fieldId: SO.CONTACT_PHONE, value: v.contactPhone,
                newText: v.contactPhone },
            { label: 'Site contact email', fieldId: SO.CONTACT_EMAIL, value: v.contactEmail,
                newText: v.contactEmail },
            { label: 'Special requests', fieldId: SO.SPECIAL_REQUESTS, value: v.requests, newText: v.requests },
            { label: 'Payment intent', fieldId: SO.PAY_INTENT, value: v.payIntent,
                newText: PAYMENT_TEXT[v.payment] },
            { label: 'Booking requested', fieldId: SO.BOOKING_REQUESTED, value: now,
                newText: now.toISOString() }
        ];
        var changes = [];
        var i;
        var spec;
        var oldValue;
        var oldText;

        if (v.address === '') {
            specs = specs.filter(function (sp) { return sp.fieldId !== SO.SHIP_ADDRESS; });
        }
        if (cfg.EDD_DEFINITE) {
            optional.push({ label: 'EDD certainty', fieldId: SO.EDD_CERTAINTY, value: cfg.EDD_DEFINITE,
                newText: '', selectText: true });
        } else {
            log.audit({ title: title('EDD_SKIPPED'), details: 'Sales order ' + orderId +
                ': custscript_cdb_edd_definite_value is empty, so custbody_edd_certainty was not written' });
        }
        // An optional field the loaded record does not carry is skipped, never fatal.
        for (i = 0; i < optional.length; i++) {
            if (so.getField({ fieldId: optional[i].fieldId })) {
                specs.push(optional[i]);
            } else {
                log.audit({ title: title('FIELD_MISSING'), details: 'Sales order ' + orderId + ': ' +
                    optional[i].fieldId + ' is not on the record, so it was not written; the booking went ahead' });
            }
        }

        for (i = 0; i < specs.length; i++) {
            spec = specs[i];
            oldValue = so.getValue({ fieldId: spec.fieldId });
            try {
                oldText = spec.date ? dateText(oldValue) : spec.checkbox ? (oldValue === true || oldValue === 'T' ?
                    'Yes' : 'No') : (so.getText({ fieldId: spec.fieldId }) || '');
            } catch (e) {
                oldText = String(oldValue === null || oldValue === undefined ? '' : oldValue);
            }
            so.setValue({ fieldId: spec.fieldId, value: spec.value });
            if (spec.selectText) {
                try {
                    spec.newText = so.getText({ fieldId: spec.fieldId }) || ('ID ' + spec.value);
                } catch (e2) {
                    spec.newText = 'ID ' + spec.value;
                }
            }
            changes.push({
                label: spec.label,
                fieldId: spec.fieldId,
                oldValue: oldValue instanceof Date ? oldValue.toISOString() : String(oldValue === null ||
                    oldValue === undefined ? '' : oldValue),
                newValue: spec.value instanceof Date ? spec.value.toISOString() : String(spec.value),
                oldText: String(oldText),
                newText: String(spec.newText || ''),
                changed: String(oldText) !== String(spec.newText || '')
            });
        }
        return changes;
    }

    // ---------------------------------------------------------------- 2.2: a new delivery address

    /**
     * Steps 1 and 2 of a new address, after every check has passed: the same address already in the
     * address book is used as it is (CDB ADDRESS_MATCHED); otherwise it is added (CDB ADDRESS_ADDED). A
     * failed add NEVER stops the booking: it goes ahead with the ship-to address unchanged, and the Task
     * says so (CDB ADDRESS_ADD_FAILED, at error).
     * @returns {Object} { lines, label, id ('' when not in the address book), matched (the existing line, or
     *   null), added, failed ('' or why), countyField, countyNote }
     */
    function addNewAddress(ctx, fc, a) {
        var out = { lines: data.addressLines(a), label: data.addressLabel(fc.todayKey), id: '', matched: null,
            added: false, failed: '', countyField: '', countyNote: '' };
        var result;
        out.matched = data.matchAddress(fc.options.address, a);
        if (out.matched) {
            out.id = out.matched.id;
            log.audit({ title: title('ADDRESS_MATCHED'), details: 'Customer ' + ctx.customer.id + ': the new address ' +
                'matches address book line ' + out.id + ' ("' + out.matched.label + '") on line 1 and postcode; ' +
                'that line is used and no line is added' });
            return out;
        }
        try {
            result = data.addToAddressBook(ctx.customer.id, a, out.label);
            out.countyField = result.countyField;
            out.countyNote = result.countyNote;
            if (result.id) {
                out.id = result.id;
                out.added = true;
                log.audit({ title: title('ADDRESS_ADDED'), details: 'Customer ' + ctx.customer.id + ': address ' + out.id +
                    ' added to the address book, labelled "' + out.label + '", not default shipping or billing; county ' +
                    (a.county ? (out.countyField ? 'in ' + out.countyField : 'NOT saved (' + out.countyNote + ')') : 'none given') });
            } else {
                out.failed = 'saved, but the new line could not be found again by its label and postcode';
                log.error({ title: title('ADDRESS_ADD_FAILED'), details: 'Customer ' + ctx.customer.id + ': ' + out.failed +
                    '. The booking goes ahead with the ship-to address unchanged; the Task says so.' });
            }
        } catch (e) {
            out.failed = errorText(e);
            log.error({ title: title('ADDRESS_ADD_FAILED'), details: 'Customer ' + ctx.customer.id + ': the new address ' +
                'was NOT added to the address book (' + out.failed + '). The booking goes ahead with the ship-to ' +
                'address unchanged; the Task says so.' });
        }
        return out;
    }

    /**
     * Step 4: the address, one line each, in custbody_cdb_delivery_address on the order's opportunity — the
     * only opportunity write of a booking. Never fatal: a missing field or a failed write is logged and the
     * Task says the opportunity was not updated.
     * @returns {string} the Task's line
     */
    function keepAddressOnOpportunity(ctx, guard, lines) {
        var oppId = guard.opportunity.id;
        try {
            if (data.writeDeliveryAddress(oppId, lines.join('\n')).written) {
                log.audit({ title: title('OPP_ADDRESS_SAVED'), details: 'Opportunity ' + oppId + ', customer ' +
                    ctx.customer.id + ': ' + OPP.DELIVERY_ADDRESS + ' set to the new delivery address' });
                return 'Opportunity: the address is saved in "Customer-added delivery address" (' + OPP.DELIVERY_ADDRESS + ').';
            }
            log.audit({ title: title('FIELD_MISSING'), details: 'Opportunity ' + oppId + ': ' + OPP.DELIVERY_ADDRESS +
                ' is not on the record, so it was not written; the booking went ahead' });
            return 'Opportunity NOT updated: the field ' + OPP.DELIVERY_ADDRESS + ' is not on the opportunity.';
        } catch (e) {
            log.error({ title: title('OPP_ADDRESS_FAILED'), details: 'Opportunity ' + oppId + ', customer ' +
                ctx.customer.id + ': ' + OPP.DELIVERY_ADDRESS + ' NOT written (' + errorText(e) + '). The Task says so.' });
            return 'Opportunity NOT updated (' + errorText(e) + ').';
        }
    }

    /** Step 5's part: the Task's new-address block (customer's words escaped). */
    function newAddressTask(na, oppLine) {
        var lead;
        var outcomes = [];
        var LEAD_END = ' Check access, the vehicle and any delivery charge, correct the address if needed, then confirm ' +
            'the date.';
        if (na.added) {
            lead = 'The customer gave a new delivery address. It has been added to their address book (labelled \'' +
                config.NEW_ADDRESS.LABEL + '\') and set as this order\'s ship-to address.' + LEAD_END;
            outcomes.push('Address book: added as address ' + na.id + ', labelled "' + na.label + '", neither default ' +
                'shipping nor default billing.');
            if (na.countyNote) {
                outcomes.push('County NOT saved on the address (' + na.countyNote + '). Add it by hand.');
            }
        } else if (na.matched) {
            lead = 'The customer gave a new delivery address. It matches a line already in their address book, which ' +
                'has been set as this order\'s ship-to address.' + LEAD_END;
            outcomes.push('Address book: matches the existing line "' + render.esc(na.matched.label) + '" (address ' +
                na.id + ') on line 1 and postcode, so no line was added.');
        } else {
            lead = 'The customer gave a new delivery address. Check access, the vehicle and any delivery charge, then ' +
                'confirm the date.';
            outcomes.push('New address NOT added to the address book (' + na.failed + '). Add it and set it as the ' +
                'ship-to address by hand.');
        }
        outcomes.push(na.id ? 'Ship-to address: set to address ' + na.id + '.' : 'Ship-to address: NOT changed.');
        outcomes.push(oppLine);
        return { lead: lead, lines: na.lines.map(render.esc), outcomes: outcomes };
    }

    /** POST a=delivery */
    function handleDeliveryPost(ctx, params) {
        var orderId = params.so;
        var guard = data.guardOrder(ctx.customer.id, orderId, ctx.cfg);
        var fc;
        var check;
        var so;
        var changes;
        var taskChanges = [];
        var i;
        var am;
        var taskResult;
        var now = new Date();
        var na = null;
        var oppLine = '';
        var surcharge;

        if (!guard.ok) {
            return renderDashboard(ctx, guardNotice(ctx, guard, orderId));
        }
        fc = formContext(ctx, guard);
        check = data.validateDelivery(formInput(params, fc), {
            todayKey: fc.todayKey,
            noticeDays: ctx.cfg.NOTICE_DAYS,
            holidays: fc.holidays,
            horizonMonths: config.BOOKING_HORIZON_MONTHS,
            timeIds: ids(fc.options.time),
            vehicleIds: ids(fc.options.vehicle),
            unloadIds: ids(fc.options.unload),
            addressIds: ids(fc.options.address),
            payBacs: ctx.cfg.PAY_BACS,
            payCard: ctx.cfg.PAY_CARD,
            payAccount: ctx.cfg.PAY_ACCOUNT,
            paymentOptions: paymentOptions(guard.order)
        });
        if (!check.ok) {
            log.audit({
                title: title('FORM_REJECTED'),
                details: clip('Customer ' + ctx.customer.id + ', sales order ' + guard.order.id + ': ' +
                    JSON.stringify(check.errors))
            });
            return renderForm(ctx, guard, fc, check.values, check.errors);
        }

        // 2.2: a new address — steps 1 and 2 (match, else add), before the order is loaded, so the order's
        // ship-to list is read with the new line in it. Never stops the booking.
        if (check.values.newAddress) {
            na = addNewAddress(ctx, fc, check.values.newAddress);
            check.values.address = na.id;
            check.values.addressText = na.added ? na.lines.join(', ') : '';
        }

        so = record.load({ type: record.Type.SALES_ORDER, id: guard.order.id, isDynamic: false });
        // Belt and braces: the guard read these through a search a moment ago.
        if (so.getValue({ fieldId: SO.CONFIRMED_DATE }) || so.getValue({ fieldId: SO.PAY_INTENT })) {
            log.audit({ title: title('GUARD_REFUSED'), details: 'Sales order ' + guard.order.id +
                ' changed between guard and load: confirmed date or payment intent now set' });
            return renderDashboard(ctx, NOTICES.ALREADY.replace('{tranid}', guard.order.tranId));
        }
        changes = setOrderFields(so, check.values, fc, now, ctx.cfg, guard.order.id);
        so.save({ ignoreMandatoryFields: true });
        log.audit({
            title: title('SO_UPDATED'),
            details: clip('Sales order ' + guard.order.id + ' (' + guard.order.tranId + '), customer ' +
                ctx.customer.id + ', ' + termsNote(guard.order) + ': ' + JSON.stringify(changes))
        });
        // 2.2: step 4, the opportunity — whether or not the address reached the address book.
        if (na) {
            oppLine = keepAddressOnOpportunity(ctx, guard, na.lines);
        }

        am = fc.assignee;
        surcharge = surchargeOf(fc, check.values.unload);
        try {
            for (i = 0; i < changes.length; i++) {
                if (changes[i].changed && changes[i].fieldId !== SO.SPECIAL_REQUESTS) {
                    taskChanges.push(changes[i]);
                }
            }
            taskResult = task.createDeliveryTask({
                title: task.buildTitle(guard.order.tranId, render.orderTitle(guard.order), !!na),
                assigneeId: am.id,
                customerId: ctx.customer.id,
                opportunityId: guard.opportunity.id,
                message: task.buildMessage(taskChanges,
                    check.values.payment === data.PAYMENT.BACS ?
                        'BACS: the customer has been shown the bank details, reference ' + guard.order.tranId :
                        check.values.payment === data.PAYMENT.CARD ? 'Card: call the customer to take payment' :
                            'Add to account: no payment is needed now',
                    check.values.requests, {
                        description: render.orderTitle(guard.order),
                        uniqueRef: guard.order.uniqueRef,
                        paymentChoice: PAYMENT_CHOICE[check.values.payment],
                        account: check.values.payment === data.PAYMENT.ACCOUNT,
                        // Amendment 1: whenever the choice is BACS or Card; never for Add to account.
                        // 2.0.5: both balances, as the customer sees them; no "basis" wording.
                        amountText: check.values.payment !== data.PAYMENT.ACCOUNT ? render.amountText(guard.order.amount) : '',
                        newAddress: na ? newAddressTask(na, oppLine) : null,
                        // 2.2.1: the rep adds the item line; the dashboard never does.
                        surcharge: surcharge
                    }),
                todayKey: fc.todayKey
            });
            log.audit({
                title: title('TASK_CREATED'),
                details: 'Task ' + taskResult.id + ' for sales order ' + guard.order.id + ', assigned to ' +
                    am.id + ' (' + am.source + '), sendemail ' + (taskResult.sendEmailSet ? 'set' : 'NOT set') +
                    ', payment ' + check.values.payment + ', ' + termsNote(guard.order)
            });
        } catch (e) {
            log.error({
                title: title('TASK_FAILED'),
                details: 'Sales order ' + guard.order.id + ' WAS updated; the Task was not created. ' +
                    'Assignee ' + am.id + ' (' + am.source + '). ' + (e && e.message ? e.message : String(e))
            });
        }

        return render.confirmation({
            logoUrl: ctx.cfg.LOGO_URL,
            am: fc.am,
            // render.confirmation leaves it out for Add to account.
            amount: guard.order.amount,
            uniqueRef: guard.order.uniqueRef,
            payment: check.values.payment,
            bank: bankOf(ctx.cfg),
            tranId: guard.order.tranId,
            orderTitle: render.orderTitle(guard.order),
            dateKey: check.values.date,
            timeText: textOf(fc.options.time, check.values.time),
            backUrl: ctx.baseUrl,
            // 2.2: the same page whether or not the address reached the address book.
            newAddress: !!na,
            surcharge: surcharge
        });
    }

    // ---------------------------------------------------------------- 2.1: tell us where you're up to

    /** The library, once per execution: { lib, reason }; lib null when unavailable. */
    var oppLibState = null;

    /**
     * 2.1: the Online-quote Update Opportunity library (config.OPPLIB). Required here, at request time,
     * so a missing file or a load error costs the update action only. Server-side require() runs its
     * callback synchronously. LIB_VERSION below 1.2.0 (or missing) makes it unavailable. CDB OPPLIB_VERSION
     * is logged once per execution when it is unavailable.
     * @returns {{lib: Object|null, reason: string}}
     */
    function oppLib() {
        var lib = null;
        var reason = '';
        if (oppLibState) {
            return oppLibState;
        }
        try {
            requireModule([config.OPPLIB.PATH], function (m) {
                lib = m;
            });
            if (!lib) {
                reason = 'require() returned no module';
            }
        } catch (e) {
            reason = 'could not be loaded: ' + (e && e.message ? e.message : String(e));
        }
        if (lib && !data.versionAtLeast(lib.LIB_VERSION, config.OPPLIB.MIN_VERSION)) {
            reason = 'LIB_VERSION ' + (lib.LIB_VERSION ? '"' + lib.LIB_VERSION + '"' : 'missing') + ', ' +
                config.OPPLIB.MIN_VERSION + ' or later needed';
        }
        oppLibState = { lib: reason ? null : lib, reason: reason };
        if (reason) {
            log.audit({ title: title('OPPLIB_VERSION'), details: config.OPPLIB.PATH + ': ' + reason +
                '. "Tell us where you\'re up to" is unavailable; the rest of the dashboard works.' });
        }
        return oppLibState;
    }

    /** An OPPLIB_* error (a plain Error whose name is the code) or any other, for logs and Tasks. */
    function errorText(e) {
        var message = e && e.message ? e.message : String(e);
        // The library's messages already start "OPPLIB_CODE: ", so the name is not repeated.
        return e && e.name && message.indexOf(e.name) !== 0 ? e.name + ': ' + message : message;
    }

    /** The notice for a guardOpportunity() refusal, and the audit line. */
    function oppGuardNotice(ctx, guard, oppId) {
        log.audit({ title: title('GUARD_REFUSED'), details: 'Customer ' + ctx.customer.id + ', opportunity ' +
            oppId + ': ' + guard.reason });
        if (guard.reason === data.GUARD_OPP.WON) {
            return NOTICES.OPP_WON;
        }
        if (guard.reason === data.GUARD_OPP.LOST) {
            return NOTICES.OPP_LOST;
        }
        return NOTICES.OPP_GENERIC;
    }

    /** The call-time choices, in display order. */
    function callTimeOptions() {
        return config.CALL_TIME_ORDER.map(function (k) {
            return { id: k, text: config.CALL_TIMES[k].label };
        });
    }

    /**
     * Everything the update page needs besides the values: the offered stages and reasons, whether the
     * date shows, the people.
     */
    function updateContext(ctx, guard, lib) {
        var opp = guard.opportunity;
        var stages = { options: [], missing: [] };
        var reasons = data.getObjectionTypes(ctx.cfg.UPD_OBJECTION_TYPES);
        if (ctx.cfg.UPD_BUILD_STAGES.length) {
            try {
                stages = data.stageOptions(lib.fieldOptions(OPP.BUILD_STAGE, opp.id), ctx.cfg.UPD_BUILD_STAGES);
            } catch (e) {
                // Never fails the page: the question is hidden.
                log.audit({ title: title('BUILD_STAGES_FAILED'), details: 'Opportunity ' + opp.id + ': ' + errorText(e) +
                    '. The stage question is hidden.' });
            }
        }
        if (stages.missing.length || reasons.missing.length) {
            log.audit({ title: title('LIST_VALUE_MISSING'), details: 'Setting IDs not found, so not offered. ' +
                'UPD_BUILD_STAGES: [' + stages.missing.join(',') + '] UPD_OBJECTION_TYPES: [' +
                reasons.missing.join(',') + ']' });
        }
        return {
            todayKey: dates.londonTodayKey(Date.now()),
            stages: stages.options,
            // The goods date is asked only while the opportunity is not Won: after Won, the sync copies
            // custbody_opp_del_date to the sales orders' ship dates, so a customer edit would move them.
            // guardOpportunity() already refuses Won; this keeps the rule where the field is shown.
            showDate: !data.contains(ctx.cfg.WON_STATUSES, opp.status),
            reasons: reasons.options,
            am: customerManager(ctx),
            assignee: taskAssignee(opp, ctx.cfg)
        };
    }

    /** What the page shows before the customer has typed anything. */
    function updateDefaults(ctx, guard) {
        return {
            // 2.2: the project name, prefilled with the opportunity's title.
            projectName: guard.opportunity.title,
            // 2.2.1: the site address on one line, whatever it holds (newlines become ", ").
            siteAddress: data.siteAddressLine(guard.opportunity.siteAddress),
            buildStage: guard.opportunity.buildStage,
            delDate: guard.opportunity.delDateKey,
            note: '',
            call: false,
            phone: data.getContactPhone(ctx.customer.dashboardContact) || ctx.customer.phone || '',
            callTime: '',
            reason: '',
            comment: ''
        };
    }

    function renderUpdate(ctx, guard, uc, values, errors, notice, notGoingOpen) {
        return render.updatePage({
            logoUrl: ctx.cfg.LOGO_URL,
            am: uc.am,
            assignee: uc.assignee,
            opp: guard.opportunity,
            actionUrl: ctx.baseUrl,
            backUrl: ctx.baseUrl,
            token: ctx.token,
            stages: uc.stages,
            showDate: uc.showDate,
            values: values,
            errors: errors || {},
            notice: notice || '',
            reasons: uc.reasons,
            notGoingOpen: !!notGoingOpen,
            limits: config.TEXT_LIMITS,
            callTimes: callTimeOptions()
        });
    }

    function renderUnavailable(ctx) {
        return render.unavailablePage({ logoUrl: ctx.cfg.LOGO_URL, am: customerManager(ctx), backUrl: ctx.baseUrl });
    }

    /** GET ?a=update&opp= */
    function handleUpdateGet(ctx, oppId) {
        var guard = data.guardOpportunity(ctx.customer.id, oppId, ctx.cfg);
        var lib;
        var uc;
        if (!guard.ok) {
            return renderDashboard(ctx, oppGuardNotice(ctx, guard, oppId));
        }
        lib = oppLib().lib;
        if (!lib) {
            return renderUnavailable(ctx);
        }
        uc = updateContext(ctx, guard, lib);
        return renderUpdate(ctx, guard, uc, updateDefaults(ctx, guard), {}, '', false);
    }

    /** The submitted update fields, raw. */
    function updateInput(params) {
        return {
            mode: params.mode,
            projectName: params.projectName,
            siteAddress: params.siteAddress,
            buildStage: params.buildStage,
            delDate: params.delDate,
            note: params.note,
            call: params.call,
            phone: params.phone,
            callTime: params.callTime,
            reason: params.reason,
            comment: params.comment,
            confirm: params.confirm
        };
    }

    /** The values to show again after a rejected POST: the defaults, then what was posted. */
    function mergeValues(base, posted) {
        var out = {};
        var k;
        for (k in base) {
            if (base.hasOwnProperty(k)) {
                out[k] = base[k];
            }
        }
        for (k in posted) {
            if (posted.hasOwnProperty(k) && k !== 'confirm') {
                out[k] = posted[k];
            }
        }
        return out;
    }

    /** "Ray will call you in the morning." (the assignee makes the call), or '' with no call. */
    function callText(uc, v) {
        var phrase;
        if (!v.call) {
            return '';
        }
        phrase = config.CALL_TIMES[v.callTime].phrase;
        return uc.assignee.firstName ? uc.assignee.firstName + ' will call you ' + phrase + '.' :
            'We\u2019ll call you ' + phrase + '.';
    }

    /**
     * 2.2.1: "Your project details" to write — null when neither changed; else { values ({ title, siteAddress },
     * the changed ones, for writeProjectDetails), fieldIds, items ([{key, label, oldText, newText}], the
     * reference first), notSaved ('') }.
     */
    function projectDetails(opp, changes) {
        var out = { values: {}, fieldIds: [], items: [], notSaved: '' };
        if (changes.projectName) {
            out.values.title = changes.projectName;
            out.fieldIds.push(OPP.TITLE);
            out.items.push({ key: 'title', label: 'Your reference', oldText: opp.title, newText: changes.projectName });
        }
        if (changes.siteAddress) {
            out.values.siteAddress = changes.siteAddress;
            out.fieldIds.push(OPP.SITE_ADDRESS);
            out.items.push({ key: 'site_address', label: 'Site address', oldText: data.siteAddressLine(opp.siteAddress),
                newText: changes.siteAddress });
        }
        return out.items.length ? out : null;
    }

    /**
     * The update path: the changed opportunity values through writeOppUpdate, then (2.2.1) the project
     * details — the reference and the site address, whichever changed — through ONE
     * data.writeProjectDetails(), then the Task, then the confirmation. A failed write is not the
     * customer's problem: the Task still goes, saying what was NOT saved — the library's values and the
     * details each on their own — so the account manager makes the change.
     */
    function applyUpdate(ctx, guard, uc, check, lib) {
        var opp = guard.opportunity;
        var v = check.values;
        var values = {};
        var attempted = [];
        var saved = [];
        var notSaved = '';
        var written = null;
        var details = projectDetails(opp, check.changes);
        var detailsSaved;
        var savedAll;
        var result;
        var am = uc.assignee;
        var call = v.call ? { phone: render.esc(v.phone), timeLabel: config.CALL_TIMES[v.callTime].label } : null;
        var taskResult;
        var i;

        if (check.changes.buildStage) {
            values[OPP.BUILD_STAGE] = check.changes.buildStage;
            attempted.push({ key: 'build_stage', label: 'Project stage',
                oldText: textOf(uc.stages, opp.buildStage) || opp.buildStageText || opp.buildStage,
                newText: textOf(uc.stages, check.changes.buildStage) });
        }
        if (check.changes.delDate) {
            values[OPP.DEL_DATE] = check.changes.delDate;
            // Amendment 1: the label the account manager reads (Task, CDB OPP_UPDATED) says what the
            // customer was asked; the field is still custbody_opp_del_date.
            attempted.push({ key: 'del_date', label: 'Expected to begin work',
                oldText: dates.formatLong(opp.delDateKey), newText: dates.formatLong(check.changes.delDate) });
        }

        if (attempted.length) {
            try {
                // Only the changed values; an allowed list for the select, always (the library refuses a
                // select without one).
                result = lib.writeOppUpdate({
                    oppId: opp.id,
                    values: values,
                    allowed: { custbody_build_stage: ctx.cfg.UPD_BUILD_STAGES },
                    logKey: title('OPP_WRITE')
                });
                for (i = 0; i < attempted.length; i++) {
                    if (result && result.written && result.written.hasOwnProperty(attempted[i].key)) {
                        saved.push(attempted[i]);
                    }
                }
                written = result.written;
            } catch (e) {
                notSaved = errorText(e);
                log.error({ title: title('OPP_UPDATE_FAILED'), details: 'Opportunity ' + opp.id + ', customer ' +
                    ctx.customer.id + ': NOT updated (' + notSaved + '). Attempted: ' + JSON.stringify(values) +
                    '. The Task says so.' });
            }
        }

        // 2.2.1: the reference and the site address, after the library's write, in one write of their own: its
        // failure is reported apart from theirs. (CDB OPP_NAME_FAILED keeps its 2.2 name.)
        if (details) {
            try {
                data.writeProjectDetails(opp.id, details.values);
            } catch (e1) {
                details.notSaved = errorText(e1);
                log.error({ title: title('OPP_NAME_FAILED'), details: 'Opportunity ' + opp.id + ', customer ' +
                    ctx.customer.id + ': project details NOT updated (' + details.notSaved + '). Attempted: ' +
                    JSON.stringify(details.values) + '. The Task says so.' });
            }
        }
        detailsSaved = details && !details.notSaved;

        // What reached the record, the details first (the page's order).
        savedAll = (detailsSaved ? details.items : []).concat(saved);
        if (written || detailsSaved) {
            log.audit({ title: title('OPP_UPDATED'), details: clip('Opportunity ' + opp.id + ' (' + opp.tranId +
                '), customer ' + ctx.customer.id + ': ' + (savedAll.length ? savedAll.map(function (c) {
                    return c.label + ' ' + (c.oldText || '(empty)') + ' -> ' + c.newText;
                }).join('; ') : 'nothing changed on the record') + ' | written ' + JSON.stringify(written || {}) +
                (detailsSaved ? ' | details written: ' + details.fieldIds.join(', ') : '')) });
        }

        try {
            taskResult = task.createTask({
                title: task.buildUpdateTitle(opp.tranId, opp.title),
                assigneeId: am.id,
                customerId: ctx.customer.id,
                opportunityId: opp.id,
                // The customer's own words are escaped (brief: escape everything, the Task included).
                message: task.buildUpdateMessage({ changes: saved, attempted: attempted, notSaved: notSaved,
                    note: render.esc(v.note), call: call,
                    // 2.2.1: the old values and the new are escaped too (the new ones the customer typed).
                    details: details ? { items: details.items.map(function (c) {
                        return { label: c.label, oldText: render.esc(c.oldText), newText: render.esc(c.newText) };
                    }), notSaved: details.notSaved } : null }),
                todayKey: uc.todayKey,
                priority: task.PRIORITY.MEDIUM
            });
            log.audit({ title: title('UPDATE_TASK'), details: 'Task ' + taskResult.id + ' (customer update) for ' +
                'opportunity ' + opp.id + ', assigned to ' + am.id + ' (' + am.source + '), sendemail ' +
                (taskResult.sendEmailSet ? 'set' : 'NOT set') + ', call ' + (call ? 'requested' : 'not requested') });
        } catch (e2) {
            log.error({ title: title('TASK_FAILED'), details: 'Opportunity ' + opp.id + ': the customer update Task ' +
                'was not created. Opportunity ' + (notSaved ? 'NOT updated' : 'updated as logged') +
                (details && details.notSaved ? ', project details NOT updated' : '') + '. Assignee ' +
                am.id + ' (' + am.source + '). ' + errorText(e2) });
        }

        return render.updateDone({
            logoUrl: ctx.cfg.LOGO_URL,
            am: uc.am,
            // Amendment 2: the customer sees the stage without the list's numbering; the Task above keeps it.
            saved: savedAll.map(function (c) {
                return { label: c.label, text: c.key === 'build_stage' ? render.stageLabel(c.newText) : c.newText };
            }),
            notSaved: !!(notSaved || (details && details.notSaved)),
            callText: callText(uc, v),
            backUrl: ctx.baseUrl
        });
    }

    /**
     * The not-going-ahead path, IN THIS ORDER: the objection (if a reason was chosen) -> Lost (the status
     * mapped from the customer's stage, else skipped and logged) -> the high-priority Task -> the
     * confirmation. Each step's failure is carried into the Task; none stops the next. Open estimates
     * are listed for the account manager and never touched.
     */
    function notGoingAhead(ctx, guard, uc, v, lib) {
        var opp = guard.opportunity;
        var am = uc.assignee;
        var objectionLine = '';
        var objectionFailed = false;
        var lostLine;
        var stage;
        var parsed;
        var lost;
        var result;
        var quotes;
        var taskResult;

        // 1. The objection. The reason was checked against UPD_OBJECTION_TYPES (and the names found) by
        //    validateUpdate(): the library does not validate type IDs.
        if (v.reason) {
            try {
                result = lib.createObjections({
                    oppId: opp.id,
                    typeIds: [v.reason],
                    notes: v.comment,
                    contextLine: 'Customer, via dashboard (' + data.slashDate(uc.todayKey) + ')',
                    raisedBy: '',
                    raisedOn: uc.todayKey,
                    logKey: title('OBJECTION')
                });
                objectionFailed = !result.created.length;
                objectionLine = !objectionFailed ? 'Customer Objection created (' + result.created.join(', ') + ').' :
                    'Customer Objection NOT created: ' + (result.errors[v.reason] || 'unknown error') + '.';
            } catch (e) {
                objectionFailed = true;
                objectionLine = 'Customer Objection NOT created: ' + errorText(e) + '.';
            }
            if (objectionFailed) {
                log.error({ title: title('OBJECTION_FAILED'), details: 'Opportunity ' + opp.id + ': ' + objectionLine });
            }
        }

        // 2. Lost — only with the status mapped for the customer's OWN stage (fail closed).
        stage = data.getCustomerStage(ctx.customer.id);
        parsed = config.parseLostStatusMap(ctx.cfg.UPD_LOST_STATUS_MAP);
        if (parsed.status === 'invalid') {
            log.audit({ title: title('LOST_MAP_INVALID'), details: 'Setting UPD_LOST_STATUS_MAP ignored: ' + parsed.detail });
        }
        lost = data.lostStatusFor(stage.stage, parsed, ctx.cfg);
        if (!lost.statusId) {
            lostLine = 'NOT set to Lost: ' + lost.why + '.';
            log.audit({ title: title('LOST_NOT_SET'), details: 'Opportunity ' + opp.id + ', customer ' + ctx.customer.id +
                ', stage "' + (stage.raw || '') + '" (' + (stage.stage || 'unknown') + '): ' + lost.why +
                '. Status not written; the Task says so.' });
        } else {
            try {
                lib.writeOppUpdate({
                    oppId: opp.id,
                    values: { entitystatus: lost.statusId },
                    allowed: { entitystatus: [lost.statusId] },
                    logKey: title('OPP_WRITE')
                });
                lostLine = 'Opportunity set to Lost (status ' + lost.statusId + ', customer stage ' + stage.stage + ').';
                log.audit({ title: title('OPP_LOST'), details: 'Opportunity ' + opp.id + ' (' + opp.tranId + '), customer ' +
                    ctx.customer.id + ', stage ' + stage.stage + ': entitystatus ' + opp.status + ' -> ' + lost.statusId });
            } catch (e2) {
                lostLine = 'NOT set to Lost: ' + errorText(e2) + '.';
                log.error({ title: title('OPP_LOST_FAILED'), details: 'Opportunity ' + opp.id + ': ' + errorText(e2) +
                    '. The Task says so.' });
            }
        }

        // 3. The Task, high priority, with the open quotes for the account manager to deal with.
        quotes = data.getOpenQuotes(opp.id);
        try {
            taskResult = task.createTask({
                title: task.buildLostTitle(opp.tranId, opp.title),
                assigneeId: am.id,
                customerId: ctx.customer.id,
                opportunityId: opp.id,
                message: task.buildLostMessage({
                    reasonText: v.reason ? textOf(uc.reasons, v.reason) : '',
                    comment: render.esc(v.comment),
                    lostLine: lostLine,
                    objectionLine: objectionLine,
                    quotes: quotes
                }),
                todayKey: uc.todayKey,
                priority: task.PRIORITY.HIGH
            });
            log.audit({ title: title('UPDATE_TASK'), details: 'Task ' + taskResult.id + ' (not going ahead) for ' +
                'opportunity ' + opp.id + ', assigned to ' + am.id + ' (' + am.source + '), sendemail ' +
                (taskResult.sendEmailSet ? 'set' : 'NOT set') + '. ' + lostLine });
        } catch (e3) {
            log.error({ title: title('TASK_FAILED'), details: 'Opportunity ' + opp.id + ': the not-going-ahead Task ' +
                'was not created. ' + lostLine + ' ' + objectionLine + ' Assignee ' + am.id + ' (' + am.source + '). ' +
                errorText(e3) });
        }

        // 4. The writes have happened: the page confirms whatever the Task did.
        return render.lostDone({ logoUrl: ctx.cfg.LOGO_URL, am: uc.am, backUrl: ctx.baseUrl });
    }

    /** POST a=update */
    function handleUpdatePost(ctx, params) {
        var oppId = params.opp;
        var guard = data.guardOpportunity(ctx.customer.id, oppId, ctx.cfg);
        var lib;
        var uc;
        var check;
        if (!guard.ok) {
            return renderDashboard(ctx, oppGuardNotice(ctx, guard, oppId));
        }
        lib = oppLib().lib;
        if (!lib) {
            return renderUnavailable(ctx);
        }
        uc = updateContext(ctx, guard, lib);
        check = data.validateUpdate(updateInput(params), {
            stageIds: ids(uc.stages),
            showDate: uc.showDate,
            current: { title: guard.opportunity.title, siteAddress: guard.opportunity.siteAddress,
                buildStage: guard.opportunity.buildStage, delDateKey: guard.opportunity.delDateKey },
            reasonIds: ids(uc.reasons),
            todayKey: uc.todayKey
        });
        // Validate everything first: any error re-renders the page and NOTHING is written.
        if (!check.ok) {
            log.audit({ title: title('UPDATE_REJECTED'), details: clip('Customer ' + ctx.customer.id + ', opportunity ' +
                guard.opportunity.id + ', ' + check.mode + ': ' + JSON.stringify(check.errors)) });
            return renderUpdate(ctx, guard, uc, mergeValues(updateDefaults(ctx, guard), check.values), check.errors, '',
                check.mode === data.UPDATE_MODE.NOT_GOING);
        }
        if (check.mode === data.UPDATE_MODE.NOT_GOING) {
            return notGoingAhead(ctx, guard, uc, check.values, lib);
        }
        if (check.nothing) {
            return renderUpdate(ctx, guard, uc, mergeValues(updateDefaults(ctx, guard), check.values), {},
                render.UPDATE_TEXT.NOTHING, false);
        }
        return applyUpdate(ctx, guard, uc, check, lib);
    }

    // ---------------------------------------------------------------- 2.3: tell us about your property

    var STORE = designinfo.STORE;

    /** Logged once per request: the lines that would otherwise repeat for every question. */
    function onceLogger() {
        var seen = {};
        return function (key, details) {
            if (!seen[key]) {
                seen[key] = true;
                log.audit({ title: title(key), details: details });
            }
        };
    }

    /** The PE or AM (brief §5.3: resolveRecipient as today), with the page's role. */
    function designRecipient(opp, cfg) {
        var r = taskAssignee(opp, cfg);
        r.role = r.source === 'pe' ? 'pe' : 'am';
        return r;
    }

    /** London's "Fri 30 Oct" for a key, '' for none. */
    function display(key) {
        return dates.formatDisplay(key, dates.londonTodayKey(Date.now()));
    }

    /** "dd/mm/yyyy" of an ISO time, London. */
    function isoSlash(iso) {
        var ms = Date.parse(iso || '');
        return isNaN(ms) ? '' : designinfo.slashDate(designinfo.londonTime(ms).key);
    }

    /**
     * Everything the design information page needs, for GET and POST alike: the guard, the registry, the ONE record
     * load, the state, the facts, the questions shown. { html } when the page cannot be shown.
     */
    function designContext(ctx, oppId, once) {
        var cfg = ctx.cfg;
        var guard = data.guardDesignInfo(ctx.customer.id, oppId, cfg);
        var reg;
        var rec;
        var parsed;
        var facts;
        var shown;
        var dc;
        if (!guard.ok) {
            log.audit({ title: title('DESIGNINFO_REFUSED'), details: 'Customer ' + ctx.customer.id + ', opportunity ' + oppId +
                ': ' + guard.reason });
            return { html: render.designInfoMessagePage({ logoUrl: cfg.LOGO_URL, am: customerManager(ctx), backUrl: ctx.baseUrl,
                text: guard.reason === data.GUARD_DI.FC_NONE ? render.DESIGN_TEXT.NOTHING_NEEDED : render.DESIGN_TEXT.NOT_HERE }) };
        }
        reg = data.loadRegistry(cfg.DESIGNINFO_REGISTRY);
        if (reg.status !== 'ok') {
            log.audit({ title: title('DESIGNINFO_NO_REGISTRY'), details: 'Opportunity ' + guard.opportunity.id + ': registry ' +
                reg.status + (reg.detail ? ' (' + reg.detail + ')' : '') + '. The design information page is unavailable.' });
            return { html: render.designInfoMessagePage({ logoUrl: cfg.LOGO_URL, am: customerManager(ctx), backUrl: ctx.baseUrl,
                text: render.DESIGN_TEXT.NOT_AVAILABLE + '.' }) };
        }
        if (reg.rejected.length) {
            once('DESIGNINFO_REGISTRY_REJECTED', clip(reg.rejected.length + ' registry row(s) ignored: ' + reg.rejected.map(function (r) {
                return 'line ' + r.line + ' ' + r.qid + ': ' + r.reason;
            }).join('; ')));
        }
        rec = data.loadDesignInfo(guard.opportunity.id, reg.questions, cfg);
        parsed = designinfo.parseState(rec.info.stateRaw);
        if (parsed.status === 'invalid') {
            once('DESIGNINFO_STATE_INVALID', 'Opportunity ' + guard.opportunity.id + ': ' + parsed.detail + '; treated as empty.');
        }
        facts = designinfo.buildFacts({ valueProposition: rec.info.valueProposition, fc: rec.info.fc,
            heatSource: rec.info.heatSource, market: rec.info.market, subStatus: rec.info.subStatus || guard.opportunity.subStatus,
            manifolds: rec.info.manifolds }, cfg);
        if (facts.mapProblems.length) {
            once('DESIGNINFO_MAP_INVALID', facts.mapProblems.join(' | '));
        }
        shown = designinfo.visibleQuestions(reg.questions, facts);
        dc = { guard: guard, opp: guard.opportunity, mode: guard.mode, reg: reg, rec: rec, state: parsed.state, facts: facts,
            recipient: designRecipient(guard.opportunity, cfg), notSaved: [] };
        logFieldProblems(dc, shown, once);
        dc.questions = shown.filter(function (q) { return rec.missing.indexOf(q.qid) < 0; }).map(function (q) {
            return questionView(dc, q);
        });
        return dc;
    }

    /** CDB DESIGNINFO_FIELD_MISSING / _FIELD_MISMATCH / _OPTIONS_UNAVAILABLE, once each; dc.notSaved for the Task. */
    function logFieldProblems(dc, shown, once) {
        var ids = shown.map(function (q) { return q.qid; });
        var missing = dc.rec.missing.filter(function (qid) { return ids.indexOf(qid) >= 0; });
        var mismatched = dc.rec.mismatched.filter(function (x) { return ids.indexOf(x.qid) >= 0; });
        var noOptions = dc.rec.optionsUnavailable.filter(function (x) { return ids.indexOf(x.qid) >= 0; });
        if (missing.length) {
            once('DESIGNINFO_FIELD_MISSING', 'Opportunity ' + dc.opp.id + ': not on the record, so not asked: ' + missing.join(', '));
        }
        if (mismatched.length) {
            once('DESIGNINFO_FIELD_MISMATCH', 'Opportunity ' + dc.opp.id + ': field type does not fit the question, shown ' +
                'read-only: ' + mismatched.map(function (x) { return x.qid + ' (' + x.fieldId + ' is ' + x.type + ')'; }).join(', '));
        }
        if (noOptions.length) {
            once('DESIGNINFO_OPTIONS_UNAVAILABLE', 'Opportunity ' + dc.opp.id + ': shown read-only: ' + noOptions.map(function (x) {
                return x.qid + ' (' + x.why + ')';
            }).join(', '));
        }
        dc.notSaved = missing.map(function (q) { return q + ' (field missing)'; })
            .concat(mismatched.map(function (x) { return x.qid + ' (type mismatch: ' + x.fieldId + ' is ' + x.type + ')'; }))
            .concat(noOptions.map(function (x) { return x.qid + ' (options unavailable)'; }));
    }

    /** One question as the page shows it: a copy of the registry row with unavailable, and its current value. */
    function questionView(dc, q) {
        var v = { q: q, value: '', readOnly: false, readOnlyText: '', options: null, uploaded: [], goodsHave: '', notedText: '' };
        var copy = {};
        var k;
        var mism = dc.rec.mismatched.some(function (x) { return x.qid === q.qid; });
        var noOpt = dc.rec.optionsUnavailable.some(function (x) { return x.qid === q.qid; });
        for (k in q) {
            if (q.hasOwnProperty(k)) {
                copy[k] = q[k];
            }
        }
        copy.unavailable = mism || noOpt;
        v.q = copy;
        v.readOnly = copy.unavailable;
        v.readOnlyText = q.field === config.FIELDS.OPPORTUNITY.BUILD_STAGE ? render.stageLabel(dc.rec.texts[q.qid] || '') :
            (dc.rec.texts[q.qid] || '');
        v.value = currentValue(dc, q);
        if (q.type === 'choice' && q.optionsFromField && !v.readOnly) {
            v.options = (dc.rec.fields[q.qid].options || []).map(function (o) {
                return { value: o.value, text: q.field === config.FIELDS.OPPORTUNITY.BUILD_STAGE ? render.stageLabel(o.text) : o.text };
            });
        } else if (q.type === 'choice') {
            v.options = (q.options || []).map(function (label, i) { return { value: String(i), text: label }; });
            v.value = (q.options || []).indexOf(v.value) >= 0 ? String(q.options.indexOf(v.value)) : '';
        }
        if (q.type === 'files') {
            v.uploaded = dc.state.files.filter(function (f) { return f.qid === q.qid; }).map(function (f) {
                return { name: f.name, dateText: isoSlash(f.at) };
            });
        }
        if (q.qid === designinfo.GOODS_DATE_QID && dc.rec.info.delDateKey) {
            v.goodsHave = display(dc.rec.info.delDateKey);
        }
        if (q.store === STORE.NOTE && q.type === 'long' && dc.state.noted[q.qid]) {
            v.notedText = isoSlash(dc.state.noted[q.qid]) ? render.DESIGN_TEXT.NOTED.replace('{date}', isoSlash(dc.state.noted[q.qid])) :
                render.DESIGN_TEXT.NOTED_NO_DATE;
        }
        return v;
    }

    /** A question's stored answer: the record's (field), else the state's (state; a short note answer). */
    function currentValue(dc, q) {
        if (q.store === STORE.FIELD) {
            return dc.rec.values.hasOwnProperty(q.qid) ? dc.rec.values[q.qid] : '';
        }
        if (q.store === STORE.NOTE && q.type === 'long') {
            return '';
        }
        return dc.state.answers.hasOwnProperty(q.qid) ? String(dc.state.answers[q.qid]) : '';
    }

    /** qid -> the answer, for the progress (the record's for fields; the state's otherwise). */
    function answerValues(dc) {
        var values = {};
        dc.questions.forEach(function (v) {
            values[v.q.qid] = v.q.store === STORE.FIELD ? (dc.rec.values[v.q.qid] || '') : (dc.state.answers[v.q.qid] || '');
        });
        return values;
    }

    /** The questions' sections, each with its status. */
    function designSections(dc) {
        var values = answerValues(dc);
        var qs = dc.questions.map(function (v) { return v.q; });
        return designinfo.sectionsOf(qs).map(function (s) {
            return { id: s.id, title: s.title, status: designinfo.sectionStatus(s.questions, values, dc.state),
                questions: dc.questions.filter(function (v) { return v.q.section === s.id; }) };
        });
    }

    function completenessOf(dc) {
        return designinfo.completeness(dc.questions.map(function (v) { return v.q; }), answerValues(dc), dc.state);
    }

    /** "<FC text> · <heat source text>" */
    function havingText(info) {
        return [info.fcText, info.heatSourceText].filter(function (x) { return !!x; }).join(' · ');
    }

    function renderDesignInfo(ctx, dc, extra) {
        var e = extra || {};
        var todayKey = dates.londonTodayKey(Date.now());
        if (e.values) {
            dc.questions.forEach(function (v) {
                if (e.values.hasOwnProperty(v.q.qid) && !v.readOnly) {
                    v.value = v.q.type === 'choice' && !v.q.optionsFromField ?
                        String((v.q.options || []).indexOf(e.values[v.q.qid]) >= 0 ? v.q.options.indexOf(e.values[v.q.qid]) : '') :
                        e.values[v.q.qid];
                }
            });
        }
        return render.designInfoPage({
            logoUrl: ctx.cfg.LOGO_URL,
            recipient: dc.recipient,
            opp: { id: dc.opp.id, tranId: dc.rec.info.tranId || dc.opp.tranId, title: dc.rec.info.title || dc.opp.title,
                siteAddress: dc.rec.info.siteAddress },
            project: { havingText: havingText(dc.rec.info), thermostatsText: dc.rec.info.thermostatsText, neoHub: dc.rec.info.neoHub,
                serviceText: dc.rec.info.valuePropositionText,
                callKey: dc.rec.info.nextContactKey && dc.rec.info.nextContactKey >= todayKey ? dc.rec.info.nextContactKey : '' },
            token: ctx.token,
            actionUrl: ctx.baseUrl,
            backUrl: ctx.baseUrl,
            mode: dc.mode,
            sections: designSections(dc),
            errors: e.errors || {},
            notice: e.notice || '',
            confirmation: e.confirmation || null,
            completeness: completenessOf(dc),
            maxFiles: ctx.cfg.DESIGNINFO_MAX_FILES,
            accept: designinfo.ALLOWED_EXTENSIONS.map(function (x) { return '.' + x; }).join(','),
            uploadsEnabled: !!ctx.cfg.DESIGNINFO_FOLDER,
            drawingsUrl: ctx.cfg.DESIGNINFO_DRAWINGS_URL
        });
    }

    /** GET ?a=designinfo&opp= */
    function handleDesignInfoGet(ctx, oppId) {
        var dc = designContext(ctx, oppId, onceLogger());
        return dc.html || renderDesignInfo(ctx, dc);
    }

    /** A value as the Note and the Task show it: escaped, clipped. */
    function shown(text) {
        return render.esc(designinfo.clipValue(text));
    }

    /** The display text of an answer (old or new) for the Note. */
    function answerText(v, value) {
        var q = v.q;
        var opt;
        if (value === '' || value === null || value === undefined) {
            return '';
        }
        if (q.type === 'yesno') {
            return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : String(value);
        }
        if (q.type === 'date') {
            return designinfo.slashDate(value);
        }
        if (q.type === 'choice' && q.optionsFromField) {
            opt = (v.options || []).filter(function (o) { return o.value === String(value); })[0];
            return opt ? opt.text : String(value);
        }
        return String(value);
    }

    /**
     * The changes a post makes, before anything is written: { fields (fieldId -> value to write), fieldItems, items
     * ([{ qid, section, sectionTitle, label, oldText, newText }] for the Note and the Task, plain), answers (qid ->
     * value into the state), noted ([qid]), goods (null or { have, says }), notSaved ([text]) }.
     */
    function designChanges(dc, values) {
        var out = { fields: {}, fieldItems: [], items: [], answers: {}, noted: [], goods: null, notSaved: [], clipped: [] };
        dc.questions.forEach(function (v) {
            var q = v.q;
            var nv = values[q.qid];
            var cur;
            var write;
            var meta;
            var item;
            if (v.readOnly || q.type === 'info' || q.type === 'files' || nv === undefined || nv === '' || nv === null) {
                return;
            }
            cur = q.store === STORE.FIELD ? (dc.rec.values[q.qid] || '') : q.store === STORE.NOTE && q.type === 'long' ? '' :
                String(dc.state.answers[q.qid] === undefined ? '' : dc.state.answers[q.qid]);
            if (q.store !== STORE.NOTE || q.type !== 'long') {
                if (String(nv) === String(cur)) {
                    return;
                }
            }
            item = { qid: q.qid, section: q.section, sectionTitle: q.sectionTitle, label: q.label,
                oldText: q.type === 'choice' && !q.optionsFromField ? cur : answerText(v, cur),
                newText: q.type === 'choice' && !q.optionsFromField ? nv : answerText(v, nv) };
            if (q.qid === designinfo.GOODS_DATE_QID) {
                // Amendment 1 §1: the goods date never reaches custbody_opp_del_date.
                out.goods = { have: designinfo.slashDate(dc.rec.info.delDateKey), says: designinfo.slashDate(nv) };
                item.label = 'Goods needed';
                item.oldText = out.goods.have;
                item.newText = 'customer says ' + out.goods.says;
            }
            out.items.push(item);
            if (q.store === STORE.STATE || (q.store === STORE.NOTE && q.type !== 'long')) {
                out.answers[q.qid] = nv;
                return;
            }
            if (q.store === STORE.NOTE) {
                out.noted.push(q.qid);
                return;
            }
            meta = dc.rec.fields[q.qid];
            if (q.type === 'date') {
                write = dates.localDateForWrite(nv);
            } else if (q.type === 'yesno') {
                write = meta.type === 'CHECKBOX' ? nv === 'yes' : (nv === 'yes' ? 'Yes' : 'No');
            } else {
                write = String(nv);
                if (!data.fitsSpecialType(meta.type, write)) {
                    out.notSaved.push(q.qid + ' (the field takes a ' + meta.type.toLowerCase() + ' only)');
                    item.newText += ' (NOT saved to the record: the field takes a ' + meta.type.toLowerCase() + ' only)';
                    return;
                }
                if (meta.limit && write.length > meta.limit) {
                    write = write.slice(0, meta.limit);
                    out.clipped.push(q.qid + ' (to ' + meta.limit + ' characters)');
                    item.newText += ' (clipped to ' + meta.limit + ' characters on the record)';
                }
            }
            out.fields[q.field] = write;
            out.fieldItems.push(item);
        });
        return out;
    }

    /**
     * The state after this post (a fresh object each call): the answers, the noted marks, the files, each touched
     * section's status (from valuesNow), and the change list since the last Send (pending). On Send it is written as
     * sent — sent and lastTaskAt now, pending empty — and pendingAll keeps the list for the Task; a failed Task puts
     * the state back (unsend()).
     * @returns {{state: Object, pendingAll: Object[]}}
     */
    function nextState(dc, ch, touched, valuesNow, newFiles, nowIso, send) {
        var base = dc.state;
        var s = designinfo.parseState(designinfo.stateText(base)).state;
        var qs = dc.questions.map(function (v) { return v.q; });
        var pendingAll;
        var k;
        for (k in ch.answers) {
            if (ch.answers.hasOwnProperty(k)) {
                s.answers[k] = ch.answers[k];
            }
        }
        ch.noted.forEach(function (qid) { s.noted[qid] = nowIso; });
        s.files = s.files.concat(newFiles);
        designinfo.sectionsOf(qs).forEach(function (sec) {
            if (touched.indexOf(sec.id) >= 0) {
                s.sections[sec.id] = { saved: nowIso, status: designinfo.sectionStatus(sec.questions, valuesNow, s) };
            }
        });
        s.pending = s.pending.concat(ch.items.map(function (c) {
            return { s: c.sectionTitle, l: c.label, o: designinfo.clipValue(c.oldText), n: designinfo.clipValue(c.newText), at: nowIso };
        })).slice(-80);
        pendingAll = s.pending;
        if (send) {
            s.sent = nowIso;
            s.lastTaskAt = nowIso;
            s.pending = [];
        }
        return { state: s, pendingAll: pendingAll };
    }

    /** The state as it was before a Send whose Task failed: sent and lastTaskAt back, the change list kept. */
    function unsend(s, before, pendingAll) {
        s.sent = before.sent;
        s.lastTaskAt = before.lastTaskAt;
        s.pending = pendingAll;
        return s;
    }

    /** Writes the state on its own (the second write); '' or why it failed. */
    function writeState(dc, s) {
        try {
            data.writeDesignInfo(dc.opp.id, {}, designinfo.stateText(s));
            return '';
        } catch (e) {
            log.error({ title: title('DESIGNINFO_STATE_FAILED'), details: 'Opportunity ' + dc.opp.id + ': ' + errorText(e) });
            return errorText(e);
        }
    }

    /** Step 2: one file — saved into the folder, then attached. Returns the state's entry and what happened. */
    function saveOneFile(dc, qid, part, folderId, now) {
        var stamp = designinfo.londonTime(now.getTime()).stamp;
        var name = designinfo.uploadName(dc.rec.info.tranId || dc.opp.tranId, qid, stamp, part.name);
        var original = String(part.name || '');
        var size = Number(part.size) || 0;
        var out = { entry: null, failed: '', attachFailed: '', original: original, size: size };
        var id;
        try {
            id = data.saveUpload(part, name, folderId);
        } catch (e) {
            out.failed = errorText(e);
            log.error({ title: title('DESIGNINFO_FILE'), details: 'Opportunity ' + dc.opp.id + ', ' + qid + ', "' + original +
                '": NOT saved (' + out.failed + ')' });
            return out;
        }
        try {
            data.attachUpload(id, dc.opp.id);
        } catch (e2) {
            out.attachFailed = errorText(e2);
        }
        out.entry = { qid: qid, id: id, name: name, at: now.toISOString(), size: size, attached: !out.attachFailed };
        log.audit({ title: title('DESIGNINFO_FILE'), details: 'Opportunity ' + dc.opp.id + ', ' + qid + ': file ' + id + ' "' + name +
            '" (' + designinfo.sizeText(size) + ') in folder ' + folderId + (out.attachFailed ? ', NOT attached to the ' +
            'opportunity (' + out.attachFailed + '): it is in the folder only' : ', attached to the opportunity') });
        return out;
    }

    /** POST a=designinfo */
    function handleDesignInfoPost(ctx, params, files) {
        var once = onceLogger();
        var dc = designContext(ctx, params.opp, once);
        var cfg = ctx.cfg;
        var now = new Date();
        var nowIso = now.toISOString();
        var send = String(params.send || '') === '1';
        var editable;
        var stored = {};
        var options = {};
        var check;
        var ch;
        var sectionIds;
        var touched = [];
        var sec = String(params.sec || '');
        var valuesNow;
        var hasFiles = false;
        var fileResults = [];
        var newFiles = [];
        var filesRefused = false;
        var failures = [];
        var stateWritten = false;
        var stateFailed = '';
        var next;
        var s;
        var before;
        var noteResult;
        var noteFailed = false;
        var taskFailed = false;
        var taskId = '';
        var comp;
        var k;
        var lines;

        if (dc.html) {
            return dc.html;
        }
        before = { sent: dc.state.sent, lastTaskAt: dc.state.lastTaskAt };
        if (dc.mode !== 'edit') {
            log.audit({ title: title('DESIGNINFO_REFUSED'), details: 'Customer ' + ctx.customer.id + ', opportunity ' + dc.opp.id +
                ': a post in view mode (the design is under way); nothing written' });
            return renderDesignInfo(ctx, dc, { notice: render.DESIGN_TEXT.VIEW_BANNER });
        }

        // Validate everything first: any error re-renders the page and NOTHING is written.
        editable = dc.questions.filter(function (v) { return !v.readOnly && v.q.type !== 'info'; });
        editable.forEach(function (v) {
            stored[v.q.qid] = currentValue(dc, v.q);
            if (v.q.optionsFromField) {
                options[v.q.qid] = v.options || [];
            }
        });
        check = data.validateDesignInfo(params, files, editable.map(function (v) { return v.q; }), {
            todayKey: dates.londonTodayKey(Date.now()), maxFiles: cfg.DESIGNINFO_MAX_FILES, stored: stored, options: options });
        if (!check.ok) {
            log.audit({ title: title('DESIGNINFO_REJECTED'), details: clip('Customer ' + ctx.customer.id + ', opportunity ' +
                dc.opp.id + ': ' + JSON.stringify(check.errors)) });
            return renderDesignInfo(ctx, dc, { values: check.values, errors: check.errors });
        }

        ch = designChanges(dc, check.values);
        for (k in check.files) {
            if (check.files.hasOwnProperty(k) && check.files[k].length) {
                hasFiles = true;
            }
        }
        if (hasFiles && !cfg.DESIGNINFO_FOLDER) {
            filesRefused = true;
            hasFiles = false;
            log.audit({ title: title('DESIGNINFO_NO_FOLDER'), details: 'Opportunity ' + dc.opp.id + ': setting DESIGNINFO_FOLDER ' +
                'is empty, so the files posted were refused; the answers were saved' });
        }

        // The sections this post saves: the one pressed, every one with a change or a file; Send saves them all.
        sectionIds = designinfo.sectionsOf(dc.questions.map(function (v) { return v.q; })).map(function (x) { return x.id; });
        sectionIds.forEach(function (id) {
            var hit = send || id === sec || ch.items.some(function (c) { return c.section === id; }) ||
                (hasFiles && dc.questions.some(function (v) {
                    return v.q.section === id && (check.files[v.q.qid] || []).length;
                }));
            if (hit) {
                touched.push(id);
            }
        });

        // The record's values as they will be once the fields are written.
        valuesNow = answerValues(dc);
        ch.fieldItems.forEach(function (c) {
            valuesNow[c.qid] = check.values[c.qid];
        });
        Object.keys(ch.answers).forEach(function (qid) { valuesNow[qid] = ch.answers[qid]; });

        // Step 1: the fields — with the state in the same write when there are no files (one write).
        if (Object.keys(ch.fields).length) {
            try {
                if (!hasFiles) {
                    next = nextState(dc, ch, touched, valuesNow, [], nowIso, send);
                    data.writeDesignInfo(dc.opp.id, ch.fields, designinfo.stateText(next.state));
                    stateWritten = true;
                } else {
                    data.writeDesignInfo(dc.opp.id, ch.fields);
                }
                ch.fieldItems.forEach(function (c) {
                    dc.rec.values[c.qid] = check.values[c.qid];
                });
            } catch (e) {
                failures.push('the answers for the Project Specification tab (' + errorText(e) + '): ' + ch.fieldItems.map(function (c) {
                    return c.label;
                }).join(', '));
                log.error({ title: title('DESIGNINFO_WRITE_FAILED'), details: 'Opportunity ' + dc.opp.id + ': NOT written (' +
                    errorText(e) + '). Attempted: ' + Object.keys(ch.fields).join(', ') + '. The Note and the Task say so.' });
                valuesNow = answerValues(dc);
                Object.keys(ch.answers).forEach(function (qid) { valuesNow[qid] = ch.answers[qid]; });
            }
        }

        // Step 2: the files.
        if (hasFiles) {
            dc.questions.forEach(function (v) {
                (check.files[v.q.qid] || []).forEach(function (part) {
                    var r = saveOneFile(dc, v.q.qid, part, cfg.DESIGNINFO_FOLDER, now);
                    r.qid = v.q.qid;
                    r.section = v.q.section;
                    r.label = v.q.label;
                    fileResults.push(r);
                    if (r.entry) {
                        newFiles.push(r.entry);
                    } else {
                        failures.push('file "' + render.esc(r.original) + '" (' + r.failed + ')');
                    }
                });
            });
        }

        // Step 3: the state (a second write when step 1 could not carry it).
        if (!stateWritten) {
            next = nextState(dc, ch, touched, valuesNow, newFiles, nowIso, send);
            stateFailed = writeState(dc, next.state);
            if (stateFailed) {
                failures.push('the page’s progress (' + stateFailed + ')');
            }
        }
        s = next.state;
        dc.state = s;

        // Step 4: the Note, every save.
        noteResult = task.buildDesignInfoNote({
            sectionsSaved: designinfo.sectionsOf(dc.questions.map(function (v) { return v.q; })).filter(function (x) {
                return touched.indexOf(x.id) >= 0;
            }).map(function (x) { return x.title; }),
            sent: send,
            blocks: designinfo.sectionsOf(dc.questions.map(function (v) { return v.q; })).map(function (x) {
                return {
                    title: x.title,
                    changes: ch.items.filter(function (c) { return c.section === x.id; }).map(function (c) {
                        return { label: c.label, oldText: shown(c.oldText), newText: shown(c.newText) };
                    }),
                    files: fileResults.filter(function (r) { return r.section === x.id && r.entry; }).map(function (r) {
                        return { name: render.esc(r.entry.name), sizeText: designinfo.sizeText(r.size) };
                    })
                };
            }),
            notSaved: dc.notSaved.concat(ch.notSaved),
            extra: failures.map(function (f) { return 'NOT saved: ' + f; }).concat(ch.clipped.length ? ['Clipped: ' +
                ch.clipped.join(', ')] : []).concat(fileResults.filter(function (r) { return r.attachFailed; }).map(function (r) {
                return 'File ' + r.entry.id + ' NOT attached to the opportunity (' + r.attachFailed + '): it is in the folder only.';
            })),
            bigFiles: s.answers[designinfo.BIG_FILES_QID] === 'yes'
        });
        if (noteResult.clipped) {
            log.audit({ title: title('DESIGNINFO_NOTE_CLIPPED'), details: 'Opportunity ' + dc.opp.id + ': the Note was clipped to ' +
                task.NOTE_MAX + ' characters' });
        }
        try {
            task.createNote({ title: task.buildDesignInfoNoteTitle(designinfo.londonTime(now.getTime()).text), note: noteResult.body,
                opportunityId: dc.opp.id, authorId: dc.recipient.id, noteTypeId: cfg.NOTE_TYPE });
        } catch (e3) {
            noteFailed = true;
            log.error({ title: title('DESIGNINFO_NOTE_FAILED'), details: 'Opportunity ' + dc.opp.id + ': the audit Note was NOT ' +
                'created (' + errorText(e3) + '). The save went ahead.' });
        }

        comp = completenessOf(dc);

        // Step 5: the Task, only on Send.
        if (send) {
            try {
                taskId = task.createTask({
                    title: task.buildDesignInfoTitle(dc.rec.info.title || dc.opp.title, dc.rec.info.tranId || dc.opp.tranId),
                    assigneeId: dc.recipient.id,
                    customerId: ctx.customer.id,
                    opportunityId: dc.opp.id,
                    message: designTaskMessage(dc, s, next.pendingAll, before.lastTaskAt, comp, failures, noteFailed, ch,
                        cfg.DESIGNINFO_FOLDER),
                    todayKey: dates.londonTodayKey(Date.now()),
                    priority: task.PRIORITY.MEDIUM
                }).id;
            } catch (e4) {
                taskFailed = true;
                log.error({ title: title('TASK_FAILED'), details: 'Opportunity ' + dc.opp.id + ': the DESIGN INFO Task was not ' +
                    'created (' + errorText(e4) + '). Assignee ' + dc.recipient.id + ' (' + dc.recipient.source + '). The state ' +
                    'is put back so the next Send carries the changes.' });
            }
            if (taskFailed && !stateFailed) {
                // Not sent after all: the state goes back, keeping the change list for the next Send.
                s = unsend(s, before, next.pendingAll);
                dc.state = s;
                writeState(dc, s);
            }
        }

        log.audit({ title: title('DESIGNINFO_SAVED'), details: clip('Opportunity ' + dc.opp.id + ' (' + (dc.rec.info.tranId || '') +
            '), customer ' + ctx.customer.id + ': sections ' + (touched.join(', ') || '(none)') + '; fields ' +
            (Object.keys(ch.fields).join(', ') || '(none)') + (failures.length ? ' (NOT all written)' : '') + '; files ' +
            newFiles.length + (filesRefused ? ' (refused: no folder)' : '') + '; send ' + (send ? (taskFailed ? 'FAILED' :
            'yes, Task ' + taskId) : 'no') + '; note ' + (noteFailed ? 'FAILED' : 'created') + ' (v' + VERSION + ')') });

        lines = send && !taskFailed ? [render.DESIGN_TEXT.SENT.replace('{name}', dc.recipient.name || 'your Project Engineer'),
            dc.recipient.firstName ? render.DESIGN_TEXT.SENT_NEXT.replace('{first}', dc.recipient.firstName) :
                render.DESIGN_TEXT.SENT_NEXT_NO_NAME] :
            [render.DESIGN_TEXT.SAVED + ' ' + (comp.complete ? render.DESIGN_TEXT.ALL_HERE :
                render.DESIGN_TEXT.CARD_TODO.replace('{list}', comp.missing.join(', ')))];
        if (send && taskFailed) {
            lines.push('We couldn’t pass it on just now. Please press Send again in a few minutes.');
        }
        if (filesRefused) {
            lines.push(render.DESIGN_TEXT.UPLOADS_OFF);
        }
        fileResults.filter(function (r) { return !r.entry; }).forEach(function (r) {
            lines.push('We couldn’t save “' + r.original + '”. Please try again, or email it to ' +
                (dc.recipient.name || 'us') + '.');
        });
        if (failures.length && !fileResults.some(function (r) { return !r.entry; })) {
            lines.push('Some answers couldn’t be saved to your project just now, but ' + (dc.recipient.name || 'we') +
                ' has them.');
        }
        // The page again, from what is now stored (the uploads listed, the noted marks, the answers).
        dc.questions = dc.questions.map(function (v) { return questionView(dc, v.q); });
        return renderDesignInfo(ctx, dc, { confirmation: { lines: lines } });
    }

    /** The DESIGN INFO Task's message (brief §5.5; amendment 1 §1): the changes and files since the last Send. */
    function designTaskMessage(dc, s, pendingAll, since, comp, failures, noteFailed, ch, folderId) {
        var goods = s.answers[designinfo.GOODS_DATE_QID] && s.answers[designinfo.GOODS_DATE_QID] !== dc.rec.info.delDateKey ?
            'Customer says goods are needed by ' + designinfo.slashDate(s.answers[designinfo.GOODS_DATE_QID]) + ' (we hold ' +
            (designinfo.slashDate(dc.rec.info.delDateKey) || 'no date') + '). Check and update the opportunity date yourself; the ' +
            'dashboard did not change it.' : '';
        return task.buildDesignInfoMessage({
            complete: comp.complete,
            missing: comp.missing,
            sections: comp.sections,
            serviceText: render.esc(dc.rec.info.valuePropositionText),
            changes: pendingAll.map(function (p) {
                return { section: p.s, label: p.l, oldText: render.esc(p.o), newText: render.esc(p.n) };
            }),
            files: s.files.filter(function (f) { return !since || f.at > since; }).map(function (f) {
                return { name: render.esc(f.name), sizeText: designinfo.sizeText(f.size), label: f.qid,
                    attachNote: f.attached === false ? '(NOT attached: in the folder only)' : '' };
            }),
            folderText: 'File Cabinet folder ' + folderId + ', attached to this opportunity unless marked',
            goodsLine: goods,
            bigFiles: s.answers[designinfo.BIG_FILES_QID] === 'yes',
            warnings: dc.facts.warnings,
            notSaved: dc.notSaved.concat(ch.notSaved),
            failures: failures,
            noteFailed: noteFailed
        });
    }

    /**
     * @param {Object} context - Suitelet context
     */
    function onRequest(context) {
        var request = context.request;
        var params = request.parameters || {};
        var cfg;
        var verdict;
        var customer;
        var ctx;
        var html;
        var action = String(params.a || '');

        try {
            cfg = config.load(log);
        } catch (e) {
            log.error({ title: title('CONFIG_FAILED'), details: e && e.message ? e.message : String(e) });
            send(context.response, render.errorPage(''));
            return;
        }

        try {
            verdict = token.verify(params.t);
            customer = verdict.ok ? data.getCustomer(verdict.customerId) : null;
            if (!verdict.ok || !customer) {
                log.audit({
                    title: title('INVALID_LINK'),
                    details: 'Customer ' + (verdict.customerId || '(unknown)') + ': ' +
                        (verdict.ok ? 'customer could not be read' : verdict.reason) +
                        ' (' + request.method + ')'
                });
                send(context.response, render.invalidPage(cfg.LOGO_URL));
                return;
            }

            ctx = {
                cfg: cfg,
                customer: customer,
                token: String(params.t),
                baseUrl: token.linkForToken(String(params.t))
            };

            if (action === 'delivery' && request.method === 'POST') {
                html = handleDeliveryPost(ctx, params);
            } else if (action === 'delivery') {
                html = handleDeliveryGet(ctx, params.so);
            } else if (action === 'update' && request.method === 'POST') {
                html = handleUpdatePost(ctx, params);
            } else if (action === 'update') {
                html = handleUpdateGet(ctx, params.opp);
            } else if (action === 'designinfo' && request.method === 'POST') {
                html = handleDesignInfoPost(ctx, params, request.files || {});
            } else if (action === 'designinfo') {
                html = handleDesignInfoGet(ctx, params.opp);
            } else {
                html = renderDashboard(ctx);
            }
            send(context.response, html);
        } catch (e) {
            log.error({
                title: title('REQUEST_FAILED'),
                details: request.method + ' a=' + action + ' so=' + (params.so || '') + ' opp=' + (params.opp || '') + ': ' +
                    (e && e.message ? e.message : String(e)) + (e && e.stack ? ' ' + e.stack : '')
            });
            send(context.response, render.errorPage(cfg.LOGO_URL));
        } finally {
            log.audit({
                title: title('USAGE'),
                details: request.method + ' a=' + (action || 'dashboard') + ': ' +
                    runtime.getCurrentScript().getRemainingUsage() + ' units remaining (v' + VERSION + ')'
            });
        }
    }

    return { onRequest: onRequest };
});
