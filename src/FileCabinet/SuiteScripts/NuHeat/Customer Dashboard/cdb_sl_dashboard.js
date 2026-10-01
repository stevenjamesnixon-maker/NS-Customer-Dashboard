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
 *   - 2.2, the opportunity's title (the project name), by the dashboard ITSELF — data.writeProjectName(),
 *     a single-field write of { title } only, after guardOpportunity(), after the library's write;
 *   - 2.2, with "Add a new address…": one line on the customer's address book (data.addToAddressBook(),
 *     unless the same address is already there), and custbody_cdb_delivery_address on the order's
 *     opportunity (data.writeDeliveryAddress(), only when the field exists).
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
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @version 2.2.0
 */
define(['N/record', 'N/runtime', 'N/log', './lib/cdb_lib_config', './lib/cdb_lib_token',
    './lib/cdb_lib_dates', './lib/cdb_lib_data', './lib/cdb_lib_render', './lib/cdb_lib_task', 'require'],
    function (record, runtime, log, config, token, dates, data, render, task, requireModule) {

    'use strict';

    var VERSION = '2.2.0';

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
            } : null
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

        // 1.2: the extras for this one order, once per request. Sets typeLabel, uniqueRef, prepay
        // and amount on the guard's order row.
        data.decorateOrder(guard.order, data.getOrderExtras([guard.order.id]), typeLabels(ctx), ctx.cfg,
            ctx.customer.termsId, amountOdd);

        // Once per request (formContext runs once per GET or POST). Never fails the page.
        if (hints.status === 'invalid') {
            log.audit({ title: title('OPTION_HINTS_INVALID'), details: 'custscript_cdb_option_hints ignored: ' +
                hints.detail });
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
            paymentOptions: paymentOptions(guard.order)
        });
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
            address: String(so.getValue({ fieldId: SO.SHIP_ADDRESS }) || ''),
            contactName: so.getValue({ fieldId: SO.CONTACT_NAME }) || '',
            contactPhone: so.getValue({ fieldId: SO.CONTACT_PHONE }) || '',
            contactEmail: so.getValue({ fieldId: SO.CONTACT_EMAIL }) || ''
        }, {});
    }

    /** The submitted form fields, raw. */
    function formInput(params) {
        return {
            date: params.date,
            time: params.time,
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

        if (!guard.ok) {
            return renderDashboard(ctx, guardNotice(ctx, guard, orderId));
        }
        fc = formContext(ctx, guard);
        check = data.validateDelivery(formInput(params), {
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
                        newAddress: na ? newAddressTask(na, oppLine) : null
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
            newAddress: !!na
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
     * The update path: the changed opportunity values through writeOppUpdate, then (2.2) the project name
     * through data.writeProjectName(), then the Task, then the confirmation. A failed write is not the
     * customer's problem: the Task still goes, saying what was NOT saved — the library's values and the
     * name each on their own — so the account manager makes the change.
     */
    function applyUpdate(ctx, guard, uc, check, lib) {
        var opp = guard.opportunity;
        var v = check.values;
        var values = {};
        var attempted = [];
        var saved = [];
        var notSaved = '';
        var written = null;
        var name = check.changes.projectName ? { key: 'title', label: 'Project name', oldText: opp.title,
            newText: check.changes.projectName, notSaved: '' } : null;
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

        // 2.2: the title, after the library's write, on its own: its failure is reported apart from theirs.
        if (name) {
            try {
                data.writeProjectName(opp.id, name.newText);
            } catch (e1) {
                name.notSaved = errorText(e1);
                log.error({ title: title('OPP_NAME_FAILED'), details: 'Opportunity ' + opp.id + ', customer ' +
                    ctx.customer.id + ': title NOT updated (' + name.notSaved + '). Attempted: ' +
                    JSON.stringify(name.newText) + '. The Task says so.' });
            }
        }

        // What reached the record, the name first (the page's order).
        savedAll = (name && !name.notSaved ? [name] : []).concat(saved);
        if (written || (name && !name.notSaved)) {
            log.audit({ title: title('OPP_UPDATED'), details: clip('Opportunity ' + opp.id + ' (' + opp.tranId +
                '), customer ' + ctx.customer.id + ': ' + (savedAll.length ? savedAll.map(function (c) {
                    return c.label + ' ' + (c.oldText || '(empty)') + ' -> ' + c.newText;
                }).join('; ') : 'nothing changed on the record') + ' | written ' + JSON.stringify(written || {}) +
                (name && !name.notSaved ? ' | title written' : '')) });
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
                    // 2.2: the old name and the new are escaped too (the new one the customer typed).
                    name: name ? { label: name.label, oldText: render.esc(name.oldText), newText: render.esc(name.newText),
                        notSaved: name.notSaved } : null }),
                todayKey: uc.todayKey,
                priority: task.PRIORITY.MEDIUM
            });
            log.audit({ title: title('UPDATE_TASK'), details: 'Task ' + taskResult.id + ' (customer update) for ' +
                'opportunity ' + opp.id + ', assigned to ' + am.id + ' (' + am.source + '), sendemail ' +
                (taskResult.sendEmailSet ? 'set' : 'NOT set') + ', call ' + (call ? 'requested' : 'not requested') });
        } catch (e2) {
            log.error({ title: title('TASK_FAILED'), details: 'Opportunity ' + opp.id + ': the customer update Task ' +
                'was not created. Opportunity ' + (notSaved ? 'NOT updated' : 'updated as logged') +
                (name && name.notSaved ? ', title NOT updated' : '') + '. Assignee ' +
                am.id + ' (' + am.source + '). ' + errorText(e2) });
        }

        return render.updateDone({
            logoUrl: ctx.cfg.LOGO_URL,
            am: uc.am,
            // Amendment 2: the customer sees the stage without the list's numbering; the Task above keeps it.
            saved: savedAll.map(function (c) {
                return { label: c.label, text: c.key === 'build_stage' ? render.stageLabel(c.newText) : c.newText };
            }),
            notSaved: !!(notSaved || (name && name.notSaved)),
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
            current: { title: guard.opportunity.title, buildStage: guard.opportunity.buildStage,
                delDateKey: guard.opportunity.delDateKey },
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
