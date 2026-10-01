/**
 * cdb_sl_dashboard.js
 *
 * The customer dashboard. Suitelet, deployed Available Without Login, Execute As Administrator.
 *
 *   GET  ?t=<token>                         the dashboard
 *   GET  ?t=<token>&a=delivery&so=<id>      the delivery form
 *   POST  t, a=delivery, so, form fields    the request: SO fields, then a Task, then confirmation
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
 * WHAT THIS SCRIPT WRITES — and nothing else:
 *   - the sales order fields in brief B5 (setOrderFields below), plus, from 1.1, two OPTIONAL
 *     fields written only when so.getField() finds them on the loaded record:
 *     custbody_cdb_awaiting_payment := true (never cleared by anything in this repo) and
 *     custbody_edd_certainty := custscript_cdb_edd_definite_value (skipped when that is empty);
 *   - one Task per request (lib/cdb_lib_task.js).
 * It NEVER writes custbody_del_date (the confirmed date: a workflow runs from it),
 * custbody_finance_status, any opportunity field or any customer field.
 *
 * ANY LINK FAILURE shows one generic page and logs the reason at audit. A failure of our own
 * (a missing parameter, a search that throws) shows a generic error page and logs at ERROR.
 *
 * GOVERNANCE. 1,000 units per request. A GET is about 60, a POST about 120. The remaining usage
 * is logged at the end of every request as CDB USAGE.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @version 2.0.1
 */
define(['N/record', 'N/runtime', 'N/log', './lib/cdb_lib_config', './lib/cdb_lib_token',
    './lib/cdb_lib_dates', './lib/cdb_lib_data', './lib/cdb_lib_render', './lib/cdb_lib_task'],
    function (record, runtime, log, config, token, dates, data, render, task) {

    'use strict';

    var VERSION = '2.0.1';

    var SO = config.FIELDS.SALES_ORDER;

    /** How each payment choice reads to staff: the change log and the Task. */
    var PAYMENT_TEXT = { BACS: 'BACS', CARD: 'Card, account manager to call', ACCOUNT: 'Add to account' };
    var PAYMENT_CHOICE = { BACS: 'BACS', CARD: 'Card', ACCOUNT: 'Add to account' };

    var NOTICES = {
        GENERIC: 'That order can\'t be booked online at the moment. Your account manager will be in touch.',
        BOOKED: 'Delivery for order {tranid} is already booked.',
        ALREADY: 'You\'ve already requested delivery for order {tranid}. Your account manager will be in touch.'
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
        // 1.3: one more search per page (recently delivered; fail-safe), and still ONE extras search
        // for every order on the page, recent rows included. A failed extras search leaves them
        // pay-up-front.
        data.decorateAll(groups, data.getRecentlyDelivered(ctx.customer.id, data.oppIdsOf(groups), ctx.cfg, todayKey),
            typeLabels(ctx), ctx.cfg, ctx.customer.termsId, todayKey, amountOdd);
        // 1.3.2: "Projects for delivery" keeps what needs the customer; the rest is "Booked deliveries".
        data.arrangeSections(groups);
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
            payment: params.payment
        };
    }

    /**
     * Sets the B5 fields on the loaded order, then the two optional 1.1 fields, and returns
     * old -> new for each field written.
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
                newText: textOf(fc.options.address, v.address) },
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

        am = fc.assignee;
        try {
            for (i = 0; i < changes.length; i++) {
                if (changes[i].changed && changes[i].fieldId !== SO.SPECIAL_REQUESTS) {
                    taskChanges.push(changes[i]);
                }
            }
            taskResult = task.createDeliveryTask({
                title: task.buildTitle(guard.order.tranId, render.orderTitle(guard.order)),
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
                        amountText: check.values.payment !== data.PAYMENT.ACCOUNT ? render.amountText(guard.order.amount) : ''
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
            backUrl: ctx.baseUrl
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
            } else {
                html = renderDashboard(ctx);
            }
            send(context.response, html);
        } catch (e) {
            log.error({
                title: title('REQUEST_FAILED'),
                details: request.method + ' a=' + action + ' so=' + (params.so || '') + ': ' +
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
