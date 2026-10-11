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
 * 2.3.1 (amendment 2): the design information Note and Task are plain text (control characters stripped, clipped,
 * never HTML-escaped; every HTML surface still escapes); the Task message is clipped at 3,900
 * (CDB DESIGNINFO_TASK_CLIPPED) and the change list since the last Send is capped (designinfo.capPending()); an answer
 * is compared with its line endings normalised, so an untouched textarea is never "changed"; the state is size-guarded
 * (CDB DESIGNINFO_STATE_TRIMMED); when the one write of the fields and the state fails, the fields are retried on
 * their own, so the state never blocks them.
 *
 * 2.3.2 (amendment 3): the state field is a Text Area (a Long Text field is not a valid search or lookupFields column)
 * and the state is version 2, compact (designinfo 1.0.2): no change list; the answers kept are the yes/no state answers
 * and the Note-only dates (other Note-only answers are only marked as given, in `n`); times to the minute. The DESIGN
 * INFO Task is a snapshot of every shown section's current answers, with a pointer to the Notes for the changes since
 * the last send.
 *
 * 2.4.0 (release 2.3b, the stepper): a=designinfo shows ONE step (a visible registry section) at a time, then Review.
 *   GET  &step=<section>|review      that step; none -> the first step still to do, else Review; unknown or hidden -> the
 *                                    first step (log.debug). View mode: always Review. &more_<qid>=n shows n file inputs;
 *                                    &saved=1 and &w=files|uploads|partial are the whitelisted notices after a save.
 *   POST step=<section>, nav=next|back|exit|stay, or goto=<section|review> (the step bar), or more=<qid> (+ Add another
 *        file: nav=stay with one more input): the step is saved as a section save always was (validate, write, files,
 *        state, Note), then a redirect to the step it names (Back saves first). A validation error re-renders the step.
 *        step=review with send=1 is the Send (Task), then Review with the confirmation.
 * The redirect is redirect.redirect() (a 302, which the browser follows with a GET: the effect of the brief's 303).
 * Nothing in what is written changes.
 *
 * 2.4.1 (2.3b amendment 1): a navigation post (not a Send) with no change and no file writes nothing — no fields, no
 * state, no Note — logs CDB DESIGNINFO_NO_CHANGE (debug) and redirects without &saved=1.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * 2.5.0 (release 2.3c): the steps are designinfo.stepsFor()'s — only those the request asked about (the state's rq; none:
 * all), project and other always. `reveal` (applyReveal()): a question shows on the customer's own earlier answers —
 * posted in this request, else stored; with script off every reveal panel renders under an "If you chose …" heading and
 * the page's script hides the false ones; a POST ignores a hidden question's answer (not validated, not written, not
 * noted) and its required counts only when revealed. Heat facts from custbody_heat_source_type_26 (DI_HEAT26_MAP), the
 * Sales MI the fallback. Step 3 "Understanding the heat loss of your property": @setting choices (the property type and
 * new build / renovation, written under the fill rule DI_FILL_REPLACEABLE: otherwise "customer says" in the Note and the
 * Task), two fixed extension sets, and the element cards (a preset, an exact U, notes, a source; pre-filled from the age
 * band, the Building Regulations rows or the EPC, never over the customer's own choice; routed to the New / Existing
 * fields by designinfo.elementTargets(), compared by (label, U, notes); staff prose kept until the customer changes it).
 * The EPC lookup (config.EPCLIB, NS-Quick-Estimate's epc_lib.js, and setting EPC_BEARER_TOKEN — never logged): its own
 * POSTs — nav=epc (epc_postcode: the address list) and nav=epc_use (epc_cert: the certificate, its summary and the
 * pre-fill) — each saving the step first as a stay save, then re-rendering the step (no redirect); the certificate rides
 * in epc_number / epc_date until a save writes custbody_epc_number and custbody_epc_date (the rating is never stored).
 * Step 5's picture choices: one file search per request for the step's images (url.resolveDomain for the absolute URL;
 * a missing one: CDB DESIGNINFO_PICTURE_MISSING, the card without its image).
 * GOVERNANCE 2.5.0 (units, modelled in test/r2-5.test.js with NetSuite's documented costs): step 3 GET adds the presets
 * and age bands (two file.loads, 20); a step 3 save with element cards the same 20; the EPC search POST adds the https
 * call (10) and the certificate POST the https call and the EPC map (20); step 5 GET with pictures adds one file search (10).
 *
 * 2.5.1 (2.3c amendment 1): the request email's time is computed (the send Suitelet); ext<N>_what is kept in the state, so
 * the Task's extension line always has it; epcLookup's bearer token is `epcToken` (it shadowed the imported `token` module);
 * a preset of U 0 shows as "about U 0.00".
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * 2.5.2 (2.3c amendment 2): the element dropdown keeps Not sure and I'll describe it (and Built to current Building
 * Regulations on an extension's card only; never Typical for the age); a card pre-filled with typical or regs shows that
 * entry; Review rows carry required (an optional one not answered is left out).
 *
 * @version 2.5.2
 */
define(['N/record', 'N/runtime', 'N/log', 'N/redirect', './lib/cdb_lib_config', './lib/cdb_lib_token',
    './lib/cdb_lib_dates', './lib/cdb_lib_data', './lib/cdb_lib_render', './lib/cdb_lib_task', './lib/cdb_lib_designinfo',
    'require', 'N/url'],
    function (record, runtime, log, redirect, config, token, dates, data, render, task, designinfo, requireModule, url) {

    'use strict';

    var VERSION = '2.5.2';

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
        // 2.5.0: the registry also for a card that needs information (its "about N minutes" is the requested steps' sum).
        var needRegistry = groups.inDesign.some(function (d) {
            var st = designinfo.parseState((extras[d.opp.id] || {}).state).state;
            return data.contains(ctx.cfg.NEEDINFO_SUBSTATUS, d.opp.subStatus) && !st.sent;
        });
        var reg = needRegistry && ctx.cfg.DESIGNINFO_REGISTRY ? data.loadRegistry(ctx.cfg.DESIGNINFO_REGISTRY, ctx.cfg) : null;
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
    var OPPF = config.FIELDS.OPPORTUNITY;

    /** 2.5.0: the EPC certificate number's shape (epc_lib's validCertificateNumber, checked here before any call). */
    var EPC_NUMBER_RE = /^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/;

    /** Logged once per request: the lines that would otherwise repeat for every question. */
    function onceLogger() {
        var seen = {};
        var fn = function (key, details) {
            if (!seen[key]) {
                seen[key] = true;
                log.audit({ title: title(key), details: details });
            }
        };
        // 2.5.0: the same, at debug level.
        fn.debug = function (key, details) {
            if (!seen[key]) {
                seen[key] = true;
                log.debug({ title: title(key), details: details });
            }
        };
        return fn;
    }

    /**
     * 2.5.0 (release 2.3c §B9): the shared EPC library (config.EPCLIB, NS-Quick-Estimate's epc_lib.js), required at request
     * time by absolute path, as the Online-quote library is (oppLib()): a missing file or an old LIB_VERSION costs the EPC
     * lookup only. { lib, reason }.
     */
    var epcLibState = null;
    function epcLib() {
        var lib = null;
        var reason = '';
        if (epcLibState) {
            return epcLibState;
        }
        try {
            requireModule([config.EPCLIB.PATH], function (m) {
                lib = m;
            });
            if (!lib) {
                reason = 'require() returned no module';
            }
        } catch (e) {
            reason = 'could not be loaded: ' + (e && e.message ? e.message : String(e));
        }
        if (lib && !data.versionAtLeast(lib.LIB_VERSION, config.EPCLIB.MIN_VERSION)) {
            reason = 'LIB_VERSION ' + (lib.LIB_VERSION ? '"' + lib.LIB_VERSION + '"' : 'missing') + ', ' +
                config.EPCLIB.MIN_VERSION + ' or later needed';
        }
        epcLibState = { lib: reason ? null : lib, reason: reason };
        return epcLibState;
    }

    /** 2.5.0: is the EPC lookup available? '' when it is, else why not (for CDB DESIGNINFO_EPC_UNAVAILABLE). Never the token. */
    function epcUnavailable(cfg) {
        var l = epcLib();
        if (!l.lib) {
            return config.EPCLIB.PATH + ': ' + l.reason;
        }
        return cfg.EPC_BEARER_TOKEN ? '' : 'setting EPC_BEARER_TOKEN is empty';
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
     * 2.5.0: the fill rule (setting DI_FILL_REPLACEABLE, {"<fieldId>": ["<id>", ...]}): such a field is written only when
     * empty or holding one of the IDs. Invalid: no field is governed (logged once).
     */
    function fillRule(cfg, once) {
        var raw = String(cfg.DI_FILL_REPLACEABLE || '').replace(/^\s+|\s+$/g, '');
        var v;
        var out = {};
        if (!raw) {
            return out;
        }
        try {
            v = JSON.parse(raw);
        } catch (e) {
            v = null;
        }
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
            once('DESIGNINFO_FILL_INVALID', 'Setting DI_FILL_REPLACEABLE is not a JSON object: ignored (no field is governed)');
            return out;
        }
        Object.keys(v).forEach(function (k) {
            out[k] = Array.isArray(v[k]) ? v[k].map(function (x) { return String(x); }) : [];
        });
        return out;
    }

    /**
     * Everything the design information page needs, for GET and POST alike: the guard, the registry, the ONE record
     * load, the state, the facts, the questions shown. { html } when the page cannot be shown.
     * 2.5.0: the questions are designinfo.stepsFor()'s (the requested steps); each carries revealed (applyReveal()).
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
        reg = data.loadRegistry(cfg.DESIGNINFO_REGISTRY, cfg);
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
        // 2.4.0: answers stored under qids the registry no longer has (the v2 registry) are ignored, logged once.
        if (designinfo.unknownStateQids(parsed.state, reg.questions).length) {
            once('DESIGNINFO_STATE_QID_UNKNOWN', 'Opportunity ' + guard.opportunity.id + ': ignored, not in the registry: ' +
                designinfo.unknownStateQids(parsed.state, reg.questions).join(', '));
        }
        facts = designinfo.buildFacts({ valueProposition: rec.info.valueProposition, fc: rec.info.fc,
            heatSource: rec.info.heatSource, heatSource26: rec.info.heatSource26, market: rec.info.market,
            subStatus: rec.info.subStatus || guard.opportunity.subStatus, manifolds: rec.info.manifolds }, cfg);
        if (facts.mapProblems.length) {
            once('DESIGNINFO_MAP_INVALID', facts.mapProblems.join(' | '));
        }
        // 2.5.0 (§B2): Heat Source Type values DI_HEAT26_MAP does not list are ignored (debug).
        if (facts.unmapped26.length) {
            once.debug('DESIGNINFO_HEAT26_UNMAPPED', 'Opportunity ' + guard.opportunity.id + ': custbody_heat_source_type_26 ' +
                'values not in DI_HEAT26_MAP, ignored: ' + facts.unmapped26.join(', '));
        }
        // 2.5.0 (§B3): the requested steps only.
        shown = designinfo.stepQuestions(designinfo.stepsFor(reg.questions, facts, parsed.state.rq));
        dc = { guard: guard, opp: guard.opportunity, mode: guard.mode, reg: reg, rec: rec, state: parsed.state, facts: facts,
            recipient: designRecipient(guard.opportunity, cfg), notSaved: [], cfg: cfg, once: once,
            fill: fillRule(cfg, once) };
        logFieldProblems(dc, shown, once);
        dc.questions = shown.filter(function (q) { return rec.missing.indexOf(q.qid) < 0; }).map(function (q) {
            return questionView(dc, q);
        });
        applyReveal(dc, null);
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
        } else if (q.type === 'choice' && q.optionsFromSetting) {
            // 2.5.0: the setting's options — the id is the value (written to a List field, or stored), the key for reveal.
            v.options = q.optionIds.map(function (id, i) {
                return { value: id, text: q.options[i], key: q.optionKeys[i], sub: q.optionSubs[i], file: q.optionFiles[i] };
            });
        } else if (q.type === 'choice') {
            v.options = (q.options || []).map(function (label, i) {
                return { value: String(i), text: label, key: (q.optionKeys || [])[i] || '' };
            });
            v.value = literalIndex(q, v.value);
        }
        if (q.type === 'files') {
            v.uploaded = dc.state.files.filter(function (f) { return f.qid === q.qid; }).map(function (f) {
                return { name: f.name, dateText: isoSlash(f.at) };
            });
        }
        if (q.qid === designinfo.GOODS_DATE_QID && dc.rec.info.delDateKey) {
            v.goodsHave = display(dc.rec.info.delDateKey);
        }
        // 2.5.0: the page's script pre-fills the house's element cards from the route and the age.
        v.role = q.field === OPPF.EPC_SAP ? 'route' : q.field === OPPF.PROPERTY_AGE ? 'age' : '';
        if (q.store === STORE.NOTE && q.type !== 'date' && q.type !== 'choice' && dc.state.noted[q.qid]) {
            v.notedText = render.DESIGN_TEXT.NOTED_NO_DATE;
        }
        return v;
    }

    /** 2.5.0: a literal choice's stored label (perhaps with a " · …" suffix) as the index the page posts; '' for none. */
    function literalIndex(q, label) {
        var key = designinfo.keyOfValue(q, label);
        var i = key ? (q.optionKeys || []).indexOf(key) : -1;
        return i >= 0 ? String(i) : '';
    }

    /**
     * A question's stored answer: the record's (field), else the state's (state; a Note-only date; 2.5.0: a Note-only
     * choice, kept because a reveal or a pre-fill may read it; and a governed field's declined answer, DI_FILL_REPLACEABLE).
     * An element: its current line; the EPC: the certificate number held.
     */
    function currentValue(dc, q) {
        if (q.store === STORE.FIELD) {
            if (dc.fill.hasOwnProperty(q.field) && dc.state.answers.hasOwnProperty(q.qid) && dc.state.answers[q.qid] !== '') {
                return String(dc.state.answers[q.qid]);
            }
            return dc.rec.values.hasOwnProperty(q.qid) ? dc.rec.values[q.qid] : '';
        }
        if (q.store === STORE.ELEMENT) {
            return elementStored(dc, q, marketKey(dc, null)).line;
        }
        if (q.store === STORE.EPC) {
            return extraValue(dc, OPPF.EPC_NUMBER);
        }
        // 2.3.2: of the Note-only answers only the dates are kept (state v2); the rest are in the Note. 2.5.0: and choices.
        if (q.store === STORE.NOTE && q.type !== 'date' && q.type !== 'choice') {
            return '';
        }
        return dc.state.answers.hasOwnProperty(q.qid) ? String(dc.state.answers[q.qid]) : '';
    }

    /** 2.5.0: an element or EPC field's current value ('' when it is not on the record). */
    function extraValue(dc, fieldId) {
        var x = (dc.rec.extra || {})[fieldId];
        return x && x.present ? String(x.value || '') : '';
    }

    // ---------------------------------------------------------------- 2.5.0: reveal

    /**
     * 2.5.0 (§B5): a question's current answer KEY for `reveal` — the value posted in this request when there is one (and
     * the question could be posted), else the stored one.
     */
    function keyOfQuestion(dc, v, params) {
        var q = v.q;
        var name = 'q_' + q.qid;
        var raw;
        if (params && params.hasOwnProperty(name) && !v.readOnly) {
            raw = String(params[name] === null || params[name] === undefined ? '' : params[name]).replace(/^\s+|\s+$/g, '');
            if (q.type === 'yesno') {
                raw = raw.toLowerCase();
            } else if (q.type === 'choice' && !q.optionsFromSetting && !q.optionsFromField) {
                raw = /^\d+$/.test(raw) && q.options[parseInt(raw, 10)] !== undefined ? q.options[parseInt(raw, 10)] : '';
            }
            return designinfo.keyOfValue(q, raw);
        }
        return designinfo.keyOfValue(q, currentValue(dc, q));
    }

    /** 2.5.0: each question's revealed (v.q.revealed) from the answers posted (params) or stored (null). */
    function applyReveal(dc, params) {
        var byQid = {};
        var map;
        dc.questions.forEach(function (v) { byQid[v.q.qid] = v; });
        map = designinfo.revealMap(dc.questions.map(function (v) { return v.q; }), function (q) {
            return keyOfQuestion(dc, byQid[q.qid], params);
        });
        dc.questions.forEach(function (v) {
            var src = {};
            v.q.revealed = map[v.q.qid] !== false;
            if (v.q.reveal && v.q.reveal.alternatives && v.q.reveal.alternatives.length) {
                dc.questions.forEach(function (x) { src[x.q.qid] = x.q; });
                v.revealHeading = designinfo.revealHeading(v.q, src);
                v.revealSpec = v.q.reveal.alternatives.map(function (alt) {
                    return alt.map(function (c) { return [c.qid, c.keys]; });
                });
            }
        });
        dc.marketParams = params;
        return map;
    }

    /**
     * 2.5.0: new build or renovation, as the customer says (the question writing custbody_mis_opp_market, posted or
     * stored); without that question, the facts' newbuild. 'new' | 'reno' | ''.
     */
    function marketKey(dc, params) {
        var v = (dc.questions || []).filter(function (x) { return x.q.field === OPPF.MARKET; })[0];
        if (!v) {
            return dc.facts.newbuild ? 'new' : 'reno';
        }
        return keyOfQuestion(dc, v, params === null ? null : (params || dc.marketParams));
    }

    // ---------------------------------------------------------------- 2.5.0: the element cards

    /** 2.5.0: the content a step needs (presets, age bands, EPC map), once per request; problems logged once. */
    function content(dc, which) {
        var c = data.loadContent(dc.cfg.DESIGNINFO_REGISTRY, which);
        if (c.status !== 'ok') {
            dc.once('DESIGNINFO_CONTENT_UNAVAILABLE', 'Opportunity ' + dc.opp.id + ': ' + which + ' ' + c.status +
                (c.detail ? ' (' + c.detail + ')' : '') + '; the element cards offer the specials only and do not pre-fill');
        }
        if ((c.rejected || []).length) {
            dc.once('DESIGNINFO_CONTENT_REJECTED_' + which.toUpperCase(), clip(c.path + ': ' + c.rejected.length + ' row(s) ' +
                'ignored: ' + c.rejected.map(function (r) { return 'line ' + r.line + ': ' + r.reason; }).join('; ')));
        }
        return c;
    }

    /** 2.5.0: an element question's stored line in its target field (the house's, or "Extension N: "'s), and the field. */
    function elementStored(dc, q, market) {
        var fid = designinfo.elementField(market, q.element, q.ext);
        var text = fid ? extraValue(dc, fid) : '';
        var parts;
        if (!text) {
            return { field: fid, line: '' };
        }
        if (q.ext || market === 'new') {
            parts = designinfo.splitExtensionLines(text);
            return { field: fid, line: q.ext ? (parts[q.ext] || '') : parts.main };
        }
        return { field: fid, line: text };
    }

    /** 2.5.0: the age band the main house's answers give ('' none, or not sure). */
    function bandOf(dc, params) {
        var v = dc.questions.filter(function (x) { return x.q.field === OPPF.PROPERTY_AGE; })[0];
        var key = v ? keyOfQuestion(dc, v, params) : '';
        var bands = key && key !== 'unsure' ? content(dc, 'ageBands').bands || {} : {};
        return bands.hasOwnProperty(key) ? bands[key] : null;
    }

    /** 2.5.0: the insulation route's key (the question writing custbody_pq_cylinder_location that is revealed). */
    function routeKey(dc, params) {
        var v = dc.questions.filter(function (x) { return x.q.field === OPPF.EPC_SAP && x.q.revealed !== false; })[0];
        return v ? keyOfQuestion(dc, v, params) : '';
    }

    /** 2.5.0: an extension's age key (ext<N>_age), for the regs_ext default. */
    function extAgeKey(dc, ext, params) {
        var v = dc.questions.filter(function (x) { return x.q.qid === ext + '_age'; })[0];
        return v ? keyOfQuestion(dc, v, params) : '';
    }

    /**
     * 2.5.0 (§B8): what a card is pre-filled with, if anything — the route typical: the age band's (house cards); regs:
     * regs_new (a new build) or regs_ext; an extension's "Different" card: regs_ext while it is being built now.
     */
    function prefillFor(dc, v, market, params) {
        var q = v.q;
        var route = routeKey(dc, params);
        var ages = content(dc, 'ageBands').bands || {};
        if (q.ext) {
            return extAgeKey(dc, q.ext, params) === 'now' ? designinfo.bandFill('regs', ages.regs_ext, q.element) : null;
        }
        if (route === 'typical' && market === 'reno') {
            return designinfo.bandFill('age', bandOf(dc, params), q.element);
        }
        if (route === 'regs') {
            return designinfo.bandFill('regs', market === 'new' ? ages.regs_new : ages.regs_ext, q.element);
        }
        return null;
    }

    /** 2.5.0: the context composeElement() needs for a question's card. */
    function composeCtx(dc, q, market, params) {
        var ages = content(dc, 'ageBands').bands || {};
        return { presets: content(dc, 'presets'), element: q.element, band: q.ext ? null : bandOf(dc, params),
            regs: q.ext || market !== 'new' ? ages.regs_ext : ages.regs_new };
    }

    /**
     * 2.5.0: the card a page shows for an element question — from the posted card (a re-render), an EPC pre-fill, or the
     * stored line; then the route's pre-fill where the card is empty or still pre-filled. Staff prose shows as "We have".
     */
    function elementView(dc, v, posted, epcFill) {
        var q = v.q;
        var market = marketKey(dc);
        var stored = elementStored(dc, q, market);
        var ctxC = composeCtx(dc, q, market, dc.marketParams);
        var card = posted || null;
        var prose = '';
        var fill;
        if (!card) {
            card = stored.line ? designinfo.cardOfLine(stored.line, ctxC) : { key: '', u: '', notes: '', src: 'you' };
            if (!card) {
                prose = designinfo.clipValue(stored.line, designinfo.ELEMENT_NOTES_MAX);
                card = { key: '', u: '', notes: '', src: 'you' };
            }
        }
        fill = epcFill ? { kind: 'epc', key: epcFill.key, u: epcFill.u } : prefillFor(dc, v, market, dc.marketParams);
        card = designinfo.fillPrefill(card, fill);
        v.card = card;
        v.prose = prose;
        v.tag = designinfo.sourceTag(card, ctxC.band);
        v.epcSays = epcFill && epcFill.text && (epcFill.mixed || card.key === 'unsure') ? epcFill.text : '';
        v.epcMissing = !!(epcFill && epcFill.missing) && designinfo.cardSource(card) !== 'you';
        // 2.5.2 (amendment 2, Steve to confirm): the presets, then Not sure and I'll describe it; Built to current Building
        // Regulations only on an extension's card (there is no route question for it); Typical for the age never offered.
        // A card pre-filled with typical or regs (a band or regs value that is a U-value) shows that one entry, as filled.
        v.elementOptions = ((ctxC.presets.byElement || {})[q.element] || []).map(function (p) {
            return { value: p.key, text: p.label + ' — about U ' + designinfo.uShow(p.u) };
        }).concat(designinfo.ELEMENT_SPECIALS.filter(function (x) {
            return x.key === 'unsure' || x.key === 'describe' || (x.key === 'regs' && q.ext) || x.key === card.key;
        }).map(function (x) {
            return { value: x.key, text: x.key === 'typical' || x.key === 'regs' ? specialText(card.key === x.key ? card : { key: x.key },
                ctxC) : x.label };
        }));
        // The JavaScript pre-fill (route or age changed on the page): what each choice would give this card.
        v.fillData = elementFillData(dc, v, market);
        return v;
    }

    /** 2.5.2: a typical / regs entry's text, as its line reads ("Typical for 1991 – 2002 — about U 0.45"). */
    function specialText(card, ctxC) {
        var parts = designinfo.composeElement({ key: card.key, u: '', notes: '', src: card.src }, ctxC);
        return parts.label + (parts.u ? ' — about U ' + designinfo.uShow(parts.u) : '');
    }

    /** 2.5.0: the data the page's script uses to pre-fill a house card when the route or the age changes. */
    function elementFillData(dc, v, market) {
        var ages = content(dc, 'ageBands').bands || {};
        var out = { age: {}, regs: null, tags: { age: {}, regs: 'Building Regulations' } };
        if (v.q.ext) {
            return null;
        }
        var presets = content(dc, 'presets');
        var regsRow = market === 'new' ? ages.regs_new : ages.regs_ext;
        // "src|key|text": text only for typical / regs, which the select does not list until the script adds them (2.5.2).
        function entry(f, band, regs) {
            return designinfo.srcString(f.kind, f.key, f.u) + '|' + f.key + '|' + (f.key === 'typical' || f.key === 'regs' ?
                specialText({ key: f.key }, { presets: presets, element: v.q.element, band: band, regs: regs }) : '');
        }
        Object.keys(ages).forEach(function (k) {
            var f = /^regs_/.test(k) ? null : designinfo.bandFill('age', ages[k], v.q.element);
            if (f) {
                out.age[k] = entry(f, ages[k], null);
                out.tags.age[k] = 'Typical for ' + designinfo.bandText(ages[k]);
            }
        });
        var r = designinfo.bandFill('regs', regsRow, v.q.element);
        out.regs = r ? entry(r, null, regsRow) : null;
        return out;
    }

    /** qid -> the answer, for the progress (the record's for fields; the state's otherwise; 2.5.0: element lines). */
    function answerValues(dc) {
        var values = {};
        var market = marketKey(dc, null);
        dc.questions.forEach(function (v) {
            if (v.q.store === STORE.ELEMENT) {
                values[v.q.qid] = elementStored(dc, v.q, market).line;
            } else if (v.q.store === STORE.EPC) {
                values[v.q.qid] = extraValue(dc, OPPF.EPC_NUMBER);
            } else {
                values[v.q.qid] = v.q.store === STORE.FIELD ? (dc.rec.values[v.q.qid] || '') : (dc.state.answers[v.q.qid] || '');
            }
        });
        return values;
    }

    /** The questions' sections, each with its status. 2.5.0: a question hidden by its reveal does not count. */
    function designSections(dc) {
        var values = answerValues(dc);
        var qs = dc.questions.map(function (v) { return v.q; });
        return designinfo.sectionsOf(qs).map(function (s) {
            return { id: s.id, title: s.title, short: s.short, intro: s.intro, minutes: s.minutes,
                status: designinfo.sectionStatus(s.questions, values, dc.state),
                questions: dc.questions.filter(function (v) { return v.q.section === s.id; }) };
        });
    }

    function completenessOf(dc) {
        return designinfo.completeness(dc.questions.map(function (v) { return v.q; }), answerValues(dc), dc.state);
    }

    /** "<FC text> · <heat source text>" (2.5.0: Heat Source Type's text first, else the Sales MI's). */
    function havingText(info) {
        return [info.fcText, info.heatSource26Text || info.heatSourceText].filter(function (x) { return !!x; }).join(' · ');
    }

    /** 2.4.0: the URL of a step ('review' for the review). */
    function stepUrl(ctx, dc, stepId, extra) {
        return ctx.baseUrl + '&a=designinfo&opp=' + encodeURIComponent(dc.opp.id) + '&step=' + encodeURIComponent(stepId) +
            (extra || '');
    }

    /** 2.4.0: the steps — the visible sections in registry order, each with its status and its URL. */
    function designSteps(ctx, dc) {
        return designSections(dc).map(function (sec) {
            sec.href = stepUrl(ctx, dc, sec.id);
            return sec;
        });
    }

    /** 2.4.0: the first step still to do, else 'review'. */
    function firstTodo(steps) {
        var todo = steps.filter(function (x) { return x.status === 'todo'; })[0];
        return todo ? todo.id : 'review';
    }

    /** 2.4.0: one question's value on Review — as the Task's snapshot reads it; "Given" for a Note-only answer sent. */
    function reviewValue(dc, v) {
        if (v.q.store === STORE.NOTE && v.q.type !== 'date' && v.q.type !== 'files' && v.q.type !== 'choice') {
            return dc.state.noted[v.q.qid] ? render.STEP_TEXT.GIVEN : '';
        }
        return snapshotValue(dc, v, dc.state, { posted: {} });
    }

    /**
     * 2.5.0 (§B7): the step's picture URLs — ONE file search for every file ID its picture questions use, absolute with the
     * account's application domain; a failed search or a file not returned: no image (CDB DESIGNINFO_PICTURE_MISSING once).
     */
    function pictureUrls(dc, questions) {
        var ids = [];
        var rel = {};
        var out = {};
        var domain = '';
        var missing;
        questions.forEach(function (v) {
            (v.options || []).forEach(function (o) {
                if (v.q.pictures && o.file && ids.indexOf(o.file) < 0) {
                    ids.push(o.file);
                }
            });
        });
        if (!ids.length) {
            return out;
        }
        try {
            rel = data.fileUrls(ids);
            domain = url.resolveDomain({ hostType: url.HostType.APPLICATION });
        } catch (e) {
            dc.once('DESIGNINFO_PICTURE_MISSING', 'Opportunity ' + dc.opp.id + ': the picture search failed (' + errorText(e) +
                '); the options show without images');
            return {};
        }
        ids.forEach(function (id) {
            var u = rel[id];
            if (u) {
                out[id] = /^https?:\/\//i.test(u) ? u : 'https://' + String(domain).replace(/^https?:\/\//i, '').replace(/\/$/, '') +
                    (u.charAt(0) === '/' ? '' : '/') + u;
            }
        });
        missing = ids.filter(function (id) { return !out[id]; });
        if (missing.length) {
            dc.once('DESIGNINFO_PICTURE_MISSING', 'Opportunity ' + dc.opp.id + ': file(s) ' + missing.join(', ') + ' not found; ' +
                'those options show without images');
        }
        return out;
    }

    /**
     * 2.5.0 (§B9): the EPC question's view — available or why not (logged once), the postcode, the address list or the
     * certificate summary of this request, the certificate held (posted in the hidden fields, else stored).
     */
    function epcView(dc, v, e, params) {
        var why = epcUnavailable(dc.cfg);
        var p = params || {};
        var number = EPC_NUMBER_RE.test(String(p.epc_number || '')) ? String(p.epc_number) : extraValue(dc, OPPF.EPC_NUMBER);
        var dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(p.epc_date || '')) ? String(p.epc_date) : extraValue(dc, OPPF.EPC_DATE);
        if (why) {
            dc.once('DESIGNINFO_EPC_UNAVAILABLE', 'Opportunity ' + dc.opp.id + ': the EPC lookup is unavailable (' + why + ')');
        }
        v.epc = { available: !why, postcode: (e.epc && e.epc.postcode) || String(p.epc_postcode || ''),
            rows: (e.epc && e.epc.rows) || null, cert: (e.epc && e.epc.cert) || null, notice: (e.epc && e.epc.notice) || '',
            number: (e.epc && e.epc.cert && e.epc.cert.number) || number,
            dateKey: (e.epc && e.epc.cert && e.epc.cert.dateKey) || dateKey };
        v.epc.validText = v.epc.dateKey ? designinfo.slashDate(addYears(v.epc.dateKey, 10)) : '';
        return v;
    }

    /** 2.5.0: a 'yyyy-mm-dd' key plus whole years (29 Feb -> 28 Feb). */
    function addYears(key, n) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
        var day;
        if (!m) {
            return '';
        }
        day = m[2] === '02' && m[3] === '29' ? '28' : m[3];
        return (parseInt(m[1], 10) + n) + '-' + m[2] + '-' + day;
    }

    /**
     * The design information page: one step (extra.step a visible section) or Review (anything else). extra: { step,
     * values (posted, after a validation error), errors, notice, confirmation, more (qid -> file inputs); 2.5.0: epc (the
     * lookup's rows or certificate), cards (qid -> a pre-filled card), epcFill (qid -> epcElement()) }.
     */
    function renderDesignInfo(ctx, dc, extra) {
        var e = extra || {};
        var todayKey = dates.londonTodayKey(Date.now());
        var steps;
        var callKey = dc.rec.info.nextContactKey && dc.rec.info.nextContactKey >= todayKey ? dc.rec.info.nextContactKey : '';
        var index = -1;
        var cur;
        var m;
        var urls;
        if (e.values) {
            dc.questions.forEach(function (v) {
                if (e.values.hasOwnProperty(v.q.qid) && !v.readOnly && v.q.type !== 'element') {
                    v.value = v.q.type === 'choice' && !v.q.optionsFromField && !v.q.optionsFromSetting ?
                        literalIndex(v.q, e.values[v.q.qid]) : e.values[v.q.qid];
                }
            });
        }
        steps = designSteps(ctx, dc);
        m = {
            logoUrl: ctx.cfg.LOGO_URL,
            recipient: dc.recipient,
            opp: { id: dc.opp.id, tranId: dc.rec.info.tranId || dc.opp.tranId, title: dc.rec.info.title || dc.opp.title,
                siteAddress: dc.rec.info.siteAddress },
            project: { havingText: havingText(dc.rec.info), thermostatsText: dc.rec.info.thermostatsText, neoHub: dc.rec.info.neoHub,
                serviceText: dc.rec.info.valuePropositionText, callKey: callKey },
            token: ctx.token,
            actionUrl: ctx.baseUrl,
            backUrl: ctx.baseUrl,
            mode: dc.mode,
            errors: e.errors || {},
            notice: e.notice || '',
            confirmation: e.confirmation || null,
            maxFiles: ctx.cfg.DESIGNINFO_MAX_FILES,
            accept: designinfo.ALLOWED_EXTENSIONS.map(function (x) { return '.' + x; }).join(',') + ',image/*',
            uploadsEnabled: !!ctx.cfg.DESIGNINFO_FOLDER,
            drawingsUrl: ctx.cfg.DESIGNINFO_DRAWINGS_URL,
            steps: steps,
            firstId: steps.length ? steps[0].id : '',
            reviewHref: stepUrl(ctx, dc, 'review'),
            callKey: callKey,
            more: e.more || {}
        };
        steps.forEach(function (x, i) {
            if (x.id === e.step) {
                index = i;
            }
        });
        if (dc.mode !== 'edit' || index < 0) {
            m.currentId = 'review';
            m.todo = steps.filter(function (x) { return x.status === 'todo'; });
            m.review = steps.map(function (x) {
                // In question order; an unanswered row has value '' (Review shows "Not answered yet" in a todo step only).
                // 2.5.0: only the revealed questions.
                var rows = [];
                x.questions.forEach(function (v) {
                    if (v.q.type !== 'info' && v.q.revealed !== false) {
                        rows.push({ label: v.q.label, value: reviewValue(dc, v), required: !!v.q.required });
                    }
                });
                return { id: x.id, title: x.title, status: x.status, href: x.href, rows: rows };
            });
            return render.designInfoReview(m);
        }
        cur = steps[index];
        // 2.5.0: the element cards, the EPC question and the pictures of THIS step.
        cur.questions.forEach(function (v) {
            if (v.q.type === 'element') {
                elementView(dc, v, (e.cards || {})[v.q.qid] || null, (e.epcFill || {})[v.q.qid] || null);
            } else if (v.q.type === 'epc') {
                epcView(dc, v, e, e.params);
            }
        });
        urls = pictureUrls(dc, cur.questions);
        cur.questions.forEach(function (v) {
            if (v.q.pictures) {
                v.options = v.options.map(function (o) {
                    var c = {};
                    Object.keys(o).forEach(function (k) { c[k] = o[k]; });
                    c.src = o.file ? urls[o.file] || '' : '';
                    return c;
                });
            }
        });
        m.currentId = cur.id;
        m.step = { id: cur.id, title: cur.title, intro: cur.intro, minutes: cur.minutes, n: index + 1, questions: cur.questions,
            prev: index > 0 ? { id: steps[index - 1].id, title: steps[index - 1].title } : null, last: index === steps.length - 1 };
        return render.designInfoStep(m);
    }

    /** 2.4.0: the step a validation failure shows: the posted one when it has an error, else the first with one. */
    function errorStep(dc, sec, errors) {
        var withError = dc.questions.filter(function (v) { return errors.hasOwnProperty(v.q.qid); }).map(function (v) {
            return v.q.section;
        });
        return withError.length && withError.indexOf(sec) < 0 ? withError[0] : sec;
    }

    /** 2.4.0: the file inputs to show per files question (&more_<qid>=n, or the posted more_<qid>). */
    function moreOf(params, dc) {
        var more = {};
        dc.questions.forEach(function (v) {
            var n = parseInt((params || {})['more_' + v.q.qid], 10);
            if (v.q.type === 'files' && n > 0) {
                more[v.q.qid] = n;
            }
        });
        return more;
    }

    /** 2.4.0: the whitelisted notice after a redirect (&saved=1, &w=files|uploads|partial). Nothing from the URL is shown. */
    function noticeOf(params, dc) {
        var w = String((params || {}).w || '');
        var name = dc.recipient.name || 'us';
        var lines = String((params || {}).saved || '') === '1' ? [render.STEP_TEXT.SAVED] : [];
        if (w === 'files') {
            lines.push(render.STEP_TEXT.W_FILES.replace('{name}', name));
        } else if (w === 'uploads') {
            lines.push(render.DESIGN_TEXT.UPLOADS_OFF);
        } else if (w === 'partial') {
            lines.push(render.STEP_TEXT.W_PARTIAL.replace('{name}', name));
        }
        return lines.length ? { lines: lines } : null;
    }

    /** GET ?a=designinfo&opp=[&step=] (2.4.0: the stepper's routing). */
    function handleDesignInfoGet(ctx, params) {
        var dc = designContext(ctx, params.opp, onceLogger());
        var steps;
        var step = String(params.step || '');
        var ids;
        if (dc.html) {
            return dc.html;
        }
        // View mode: Review is the page; a step's URL goes to it.
        if (dc.mode !== 'edit') {
            if (step && step !== 'review') {
                return { redirect: stepUrl(ctx, dc, 'review') };
            }
            return renderDesignInfo(ctx, dc, { step: 'review' });
        }
        steps = designSteps(ctx, dc);
        ids = steps.map(function (x) { return x.id; });
        if (!step) {
            step = firstTodo(steps);
        } else if (step !== 'review' && ids.indexOf(step) < 0) {
            log.debug({ title: title('DESIGNINFO_STEP_UNKNOWN'), details: 'Opportunity ' + dc.opp.id + ': step "' + step +
                '" is unknown or hidden; the first step is shown' });
            step = ids[0] || 'review';
        }
        return renderDesignInfo(ctx, dc, { step: step, more: moreOf(params, dc), confirmation: noticeOf(params, dc) });
    }

    /**
     * A value as the Note and the Task show it: PLAIN TEXT (2.3.1) — control characters stripped, clipped; never
     * HTML-escaped (both are shown to staff as text).
     */
    function shown(text) {
        return designinfo.plainValue(text);
    }

    /** The state's text for a write, size-guarded (CDB DESIGNINFO_STATE_TRIMMED). */
    function stateForWrite(dc, s) {
        var g = designinfo.stateTextGuarded(s);
        if (g.trimmed) {
            log.audit({ title: title('DESIGNINFO_STATE_TRIMMED'), details: 'Opportunity ' + dc.opp.id + ': the state was over ' +
                designinfo.STATE_TRIM_AT + ' characters; it keeps only its last files (older ones stay on the opportunity and in ' +
                'the Notes)' });
        }
        return g.text;
    }

    /** The display text of an answer (old or new) for the Note. */
    function answerText(v, value) {
        var q = v.q;
        var opt;
        var i;
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
        // 2.5.0: an @setting choice holds the id; its label is what people read.
        if (q.type === 'choice' && q.optionsFromSetting) {
            i = (q.optionIds || []).indexOf(String(value));
            return i >= 0 ? q.options[i] : String(value);
        }
        return String(value);
    }

    /** 2.5.0: an element field's label for the Note — "Walls (existing)", "Roof (new)". */
    function elementFieldLabel(fieldId) {
        var label = '';
        designinfo.ELEMENTS.forEach(function (el) {
            if (designinfo.ELEMENT_FIELDS.existing[el] === fieldId) {
                label = designinfo.ELEMENT_NAMES[el] + ' (existing)';
            } else if (designinfo.ELEMENT_FIELDS.new[el] === fieldId) {
                label = designinfo.ELEMENT_NAMES[el] + ' (new)';
            }
        });
        return label || fieldId;
    }

    /** 2.5.0: a New / Existing field's text from its parts { main, ext1, ext2, ... }, the house first. */
    function joinParts(parts) {
        var lines = [];
        if (parts.main) {
            lines.push(parts.main);
        }
        Object.keys(parts).filter(function (k) { return /^ext\d+$/.test(k) && parts[k]; }).sort().forEach(function (k) {
            lines.push('Extension ' + k.replace(/^ext/, '') + ': ' + parts[k]);
        });
        return lines.join('\n');
    }

    /** 2.5.0: a question's label for the Note and the Task — an extension's rows say which extension. */
    function itemLabel(q) {
        var m = /^ext(\d+)$/.exec(q.panel || '');
        return m && !/^Extension /.test(q.label) ? 'Extension ' + m[1] + ' ' + q.label.charAt(0).toLowerCase() + q.label.slice(1) :
            q.label;
    }

    /**
     * The changes a post makes, before anything is written: { fields (fieldId -> value to write), fieldItems, items
     * ([{ qid, section, sectionTitle, label, oldText, newText }] for the Note and the Task, plain), answers (qid ->
     * value into the state), noted ([qid]), goods (null or { have, says }), notSaved ([text]) }.
     * 2.5.0: only revealed questions (the caller passes those); the fill rule (declined: the answer into the state and a
     * "customer says" line); the element cards (composed, routed, compared by (label, U, notes)); the EPC pair; the
     * insulation route's "· EPC <number>, lodged <date>".
     */
    function designChanges(dc, values, params) {
        var out = { fields: {}, fieldItems: [], items: [], answers: {}, noted: [], posted: {}, goods: null, notSaved: [],
            clipped: [], declined: [], extraNow: {} };
        var p = params || {};
        var epcNumber = EPC_NUMBER_RE.test(String(p.epc_number || '')) ? String(p.epc_number) : '';
        var epcDate = epcNumber && /^\d{4}-\d{2}-\d{2}$/.test(String(p.epc_date || '')) ? String(p.epc_date) : '';
        var epcShown = dc.questions.some(function (v) { return v.q.type === 'epc' && v.q.revealed !== false; });
        dc.questions.forEach(function (v) {
            var q = v.q;
            var nv = values[q.qid];
            var cur;
            var write;
            var meta;
            var item;
            var held;
            var num;
            if (v.readOnly || q.type === 'info' || q.type === 'files' || q.type === 'element' || q.type === 'epc' ||
                    q.revealed === false || nv === undefined || nv === '' || nv === null) {
                return;
            }
            // 2.5.0: the insulation route records the EPC it used.
            if (q.field === OPPF.EPC_SAP && designinfo.keyOfValue(q, nv) === 'epc') {
                num = epcNumber || (epcShown ? extraValue(dc, OPPF.EPC_NUMBER) : '');
                if (num) {
                    nv = nv + ' · EPC ' + num + ((epcNumber ? epcDate : extraValue(dc, OPPF.EPC_DATE)) ? ', lodged ' +
                        designinfo.slashDate(epcNumber ? epcDate : extraValue(dc, OPPF.EPC_DATE)) : '');
                }
            }
            // 2.5.1: a text answer kept in the state (ext<N>_what) is clipped there, so it is compared clipped.
            if (q.store === STORE.STATE && q.type === 'text') {
                nv = designinfo.clipValue(nv, designinfo.STATE_TEXT_MAX);
            }
            cur = currentValue(dc, q);
            // 2.3.1: line endings normalised on both sides — NetSuite may give back \r\n for what was posted as \n.
            // 2.3.2: a Note-only answer other than a date is not kept, so it is always new content (2.5.0: a choice is kept).
            if (q.store !== STORE.NOTE || q.type === 'date' || q.type === 'choice') {
                if (designinfo.sameText(nv, cur)) {
                    return;
                }
            }
            item = { qid: q.qid, section: q.section, sectionTitle: q.sectionTitle, label: itemLabel(q),
                oldText: q.type === 'choice' && !q.optionsFromField && !q.optionsFromSetting ? cur : answerText(v, cur),
                newText: q.type === 'choice' && !q.optionsFromField && !q.optionsFromSetting ? nv : answerText(v, nv) };
            if (q.qid === designinfo.GOODS_DATE_QID) {
                // Amendment 1 §1: the goods date never reaches custbody_opp_del_date.
                out.goods = { have: designinfo.slashDate(dc.rec.info.delDateKey), says: designinfo.slashDate(nv) };
                item.label = 'Goods needed';
                item.oldText = out.goods.have;
                item.newText = 'customer says ' + out.goods.says;
            }
            out.items.push(item);
            if (q.store === STORE.STATE || (q.store === STORE.NOTE && (q.type === 'date' || q.type === 'choice'))) {
                out.answers[q.qid] = nv;
                if (q.store === STORE.NOTE && q.type === 'choice') {
                    out.noted.push(q.qid);
                    out.posted[q.qid] = item.newText;
                }
                return;
            }
            if (q.store === STORE.NOTE) {
                out.noted.push(q.qid);
                out.posted[q.qid] = q.type === 'choice' || q.type === 'yesno' ? item.newText : nv;
                return;
            }
            // 2.5.0 (§B5): the fill rule — a governed field is written only when empty or holding a replaceable value.
            if (dc.fill.hasOwnProperty(q.field)) {
                held = String(dc.rec.values[q.qid] || '');
                if (held !== '' && held !== String(nv) && !data.contains(dc.fill[q.field], held)) {
                    out.answers[q.qid] = nv;
                    item.oldText = answerText(v, held) || dc.rec.texts[q.qid] || held;
                    item.newText = 'customer says ' + answerText(v, nv) + '; the opportunity holds ' + item.oldText +
                        ' (NOT changed)';
                    out.declined.push(q.qid);
                    return;
                }
                if (dc.state.answers.hasOwnProperty(q.qid)) {
                    // Written now: the declined answer is no longer needed.
                    out.answers[q.qid] = '';
                }
            }
            meta = dc.rec.fields[q.qid];
            if (q.type === 'date') {
                write = dates.localDateForWrite(nv);
            } else if (q.type === 'yesno') {
                write = meta.type === 'CHECKBOX' ? nv === 'yes' : (nv === 'yes' ? 'Yes' : 'No');
            } else if (designinfo.isNumberQuestion(q) && ['FLOAT', 'INTEGER', 'CURRENCY', 'PERCENT'].indexOf(meta.type) >= 0) {
                write = meta.type === 'INTEGER' ? Math.round(parseFloat(nv)) : parseFloat(nv);
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
        elementChanges(dc, values, params, out);
        if (epcShown && epcNumber) {
            epcChanges(dc, epcNumber, epcDate, out);
        }
        return out;
    }

    /**
     * 2.5.0 (§B8): the element cards' writes. Each revealed card — posted (not empty), or an empty one the route pre-fills,
     * else what is stored — becomes its line; elementTargets() routes the lines; each target keeps the parts no card here
     * gives (staff prose in a New field, another extension), and is written only when (label, U, notes) changed.
     */
    function elementChanges(dc, values, params, out) {
        var market = marketKey(dc, params);
        var answers = {};
        var firstQid = {};
        var any = false;
        var targets;
        dc.questions.forEach(function (v) {
            var q = v.q;
            var card = values[q.qid];
            var stored;
            var fill;
            var line;
            if (q.type !== 'element' || q.revealed === false || v.readOnly) {
                return;
            }
            // Only a card on the page posted: a save of another step never fills or changes one.
            if (!(params || {}).hasOwnProperty('q_' + q.qid)) {
                card = null;
            }
            stored = elementStored(dc, q, market);
            if (card && (card.key || card.u || card.notes)) {
                line = designinfo.elementLine(designinfo.composeElement(card, composeCtx(dc, q, market, params)));
                any = true;
            } else if (card) {
                fill = prefillFor(dc, v, market, params);
                line = fill && !stored.line ? designinfo.elementLine(designinfo.composeElement(
                    designinfo.fillPrefill(card, fill), composeCtx(dc, q, market, params))) : stored.line;
                any = any || line !== stored.line;
            } else {
                line = stored.line;
            }
            answers[q.qid] = { element: q.element, ext: q.ext, line: line };
            firstQid[designinfo.elementField(market, q.element, q.ext)] = firstQid[designinfo.elementField(market, q.element,
                q.ext)] || q;
        });
        if (!any) {
            return;
        }
        targets = designinfo.elementTargets({ market: market }, answers);
        Object.keys(targets).forEach(function (fid) {
            var meta = dc.rec.extra[fid];
            var old = extraValue(dc, fid);
            var oldParts = designinfo.splitExtensionLines(old);
            var newParts = designinfo.splitExtensionLines(targets[fid]);
            var merged = {};
            var changed = false;
            var labels = designinfo.elementLabels(content(dc, 'presets'), firstQid[fid].element);
            var text;
            var q = firstQid[fid];
            Object.keys(oldParts).forEach(function (k) { merged[k] = oldParts[k]; });
            Object.keys(newParts).forEach(function (k) {
                if (newParts[k] && !designinfo.sameElement(oldParts[k] || '', newParts[k], labels)) {
                    merged[k] = newParts[k];
                    changed = true;
                }
            });
            // A new build: the house's line replaces the whole field (one element, one line); prose only when changed.
            if (!changed) {
                return;
            }
            text = joinParts(merged);
            if (!meta || !meta.present) {
                out.notSaved.push(fid + ' (field missing)');
                return;
            }
            if (meta.limit && text.length > meta.limit) {
                text = text.slice(0, meta.limit);
                out.clipped.push(fid + ' (to ' + meta.limit + ' characters)');
            }
            out.fields[fid] = text;
            out.extraNow[fid] = text;
            out.fieldItems.push({ qid: q.qid, section: q.section, sectionTitle: q.sectionTitle, label: elementFieldLabel(fid),
                oldText: old, newText: text, extra: fid });
            out.items.push(out.fieldItems[out.fieldItems.length - 1]);
        });
    }

    /** 2.5.0 (§B9): the EPC held — custbody_epc_number and custbody_epc_date, when they change (empty never overwrites). */
    function epcChanges(dc, number, dateKey, out) {
        var v = dc.questions.filter(function (x) { return x.q.type === 'epc'; })[0];
        var oldNumber = extraValue(dc, OPPF.EPC_NUMBER);
        var oldDate = extraValue(dc, OPPF.EPC_DATE);
        var base = { qid: v.q.qid, section: v.q.section, sectionTitle: v.q.sectionTitle };
        function item(label, oldText, newText) {
            var o = { qid: base.qid, section: base.section, sectionTitle: base.sectionTitle, label: label, oldText: oldText,
                newText: newText };
            out.items.push(o);
            out.fieldItems.push(o);
        }
        if (!(dc.rec.extra[OPPF.EPC_NUMBER] || {}).present) {
            out.notSaved.push(OPPF.EPC_NUMBER + ' (field missing)');
        } else if (!designinfo.sameText(number, oldNumber)) {
            out.fields[OPPF.EPC_NUMBER] = number;
            out.extraNow[OPPF.EPC_NUMBER] = number;
            item('EPC certificate', oldNumber, number);
        }
        if (dateKey && (dc.rec.extra[OPPF.EPC_DATE] || {}).present && dateKey !== oldDate) {
            out.fields[OPPF.EPC_DATE] = dates.localDateForWrite(dateKey);
            out.extraNow[OPPF.EPC_DATE] = dateKey;
            item('EPC lodged', designinfo.slashDate(oldDate), designinfo.slashDate(dateKey));
        }
    }

    /**
     * The state after this post (a fresh object each call): the answers, the noted marks, the files, each touched
     * section's status (from valuesNow); on Send, sent and the Task's time (task). 2.3.2: no change list — the Notes are
     * the audit trail, the Task a snapshot. A failed Task puts sent and task back (unsend()).
     */
    function nextState(dc, ch, touched, valuesNow, newFiles, nowIso, send) {
        var s = JSON.parse(JSON.stringify(dc.state));
        var qs = dc.questions.map(function (v) { return v.q; });
        var k;
        for (k in ch.answers) {
            if (ch.answers.hasOwnProperty(k)) {
                s.answers[k] = ch.answers[k];
            }
        }
        ch.noted.forEach(function (qid) { s.noted[qid] = true; });
        s.files = s.files.concat(newFiles);
        designinfo.sectionsOf(qs).forEach(function (sec) {
            if (touched.indexOf(sec.id) >= 0) {
                s.sections[sec.id] = { saved: nowIso, status: designinfo.sectionStatus(sec.questions, valuesNow, s) };
            }
        });
        if (send) {
            s.sent = nowIso;
            s.lastTaskAt = nowIso;
        }
        return s;
    }

    /** The state as it was before a Send whose Task failed: sent and the Task's time back. */
    function unsend(s, before) {
        s.sent = before.sent;
        s.lastTaskAt = before.lastTaskAt;
        return s;
    }

    /** Writes the state on its own (the second write); '' or why it failed. */
    function writeState(dc, s) {
        try {
            data.writeDesignInfo(dc.opp.id, {}, stateForWrite(dc, s));
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
        out.entry = { qid: qid, id: id, name: name, at: designinfo.shortIso(now), size: size, attached: !out.attachFailed };
        log.audit({ title: title('DESIGNINFO_FILE'), details: 'Opportunity ' + dc.opp.id + ', ' + qid + ': file ' + id + ' "' + name +
            '" (' + designinfo.sizeText(size) + ') in folder ' + folderId + (out.attachFailed ? ', NOT attached to the ' +
            'opportunity (' + out.attachFailed + '): it is in the folder only' : ', attached to the opportunity') });
        return out;
    }

    /**
     * 2.4.0: where a save (not a Send) goes: nav=exit -> the dashboard; goto=<step|review> -> there; more=<qid> -> the
     * same step with one more file input; nav=back -> the previous step; nav=next -> the next step, or Review after the
     * last; nav=stay (or nothing) -> the same step. Then &saved=1 (unless saved is false: 2.4.1, nothing was written),
     * and &w= for a warning.
     */
    function afterSave(ctx, dc, params, sec, warn, saved) {
        var steps = designSteps(ctx, dc);
        var ids = steps.map(function (x) { return x.id; });
        var nav = String(params.nav || '');
        var go = String(params.goto || '');
        var more = String(params.more || '');
        var i = ids.indexOf(sec);
        var target = i >= 0 ? sec : (ids[0] || 'review');
        var extra = '';
        var q;
        var n;
        if (nav === 'exit') {
            return ctx.baseUrl;
        }
        if (go && (go === 'review' || ids.indexOf(go) >= 0)) {
            target = go;
        } else if (more) {
            q = dc.questions.filter(function (v) { return v.q.qid === more && v.q.type === 'files' && v.q.section === sec; })[0];
            if (q) {
                n = parseInt(params['more_' + more], 10);
                n = Math.min((n > 0 ? n : 1) + 1, Math.max(1, ctx.cfg.DESIGNINFO_MAX_FILES - 1));
                extra = '&more_' + encodeURIComponent(more) + '=' + n;
            }
        } else if (nav === 'back') {
            target = i > 0 ? ids[i - 1] : target;
        } else if (nav === 'next') {
            target = i >= 0 && i < ids.length - 1 ? ids[i + 1] : 'review';
        }
        return stepUrl(ctx, dc, target, extra + (saved === false ? '' : '&saved=1') + (warn ? '&w=' + warn : ''));
    }

    /** 2.5.0: the record's values as they will be once these fields are written (element fields by their own map). */
    function valuesAfter(dc, ch, check, written) {
        var keep = {};
        var values;
        if (written) {
            Object.keys(ch.extraNow).forEach(function (fid) {
                keep[fid] = dc.rec.extra[fid] ? dc.rec.extra[fid].value : '';
                if (dc.rec.extra[fid]) {
                    dc.rec.extra[fid].before = keep[fid];
                    dc.rec.extra[fid].value = ch.extraNow[fid];
                }
            });
        }
        values = answerValues(dc);
        if (written) {
            ch.fieldItems.forEach(function (c) {
                if (!c.extra && check.values.hasOwnProperty(c.qid)) {
                    values[c.qid] = check.values[c.qid];
                }
            });
        }
        Object.keys(ch.answers).forEach(function (qid) {
            var v = dc.questions.filter(function (x) { return x.q.qid === qid; })[0];
            if (!(v && v.q.store === STORE.FIELD)) {
                values[qid] = ch.answers[qid];
            }
        });
        return values;
    }

    /** POST a=designinfo */
    function handleDesignInfoPost(ctx, params, files) {
        var once = onceLogger();
        var dc = designContext(ctx, params.opp, once);
        var cfg = ctx.cfg;
        var now = new Date();
        // 2.3.2: every time in the state is to the minute (designinfo.shortIso), so stored times compare as strings.
        var nowIso = designinfo.shortIso(now);
        var send = String(params.send || '') === '1';
        var nav = String(params.nav || '');
        var epcNav = nav === 'epc' || nav === 'epc_use';
        var editable;
        var stored = {};
        var options = {};
        var check;
        var ch;
        var sectionIds;
        var touched = [];
        var sec = String(params.step || '');
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
        var taskBody;
        var noteResult;
        var noteFailed = false;
        var taskFailed = false;
        var taskId = '';
        var comp;
        var k;
        var lines;
        var hasElements;

        if (dc.html) {
            return dc.html;
        }
        before = { sent: dc.state.sent, lastTaskAt: dc.state.lastTaskAt, requested: dc.state.requested };
        if (dc.mode !== 'edit') {
            log.audit({ title: title('DESIGNINFO_REFUSED'), details: 'Customer ' + ctx.customer.id + ', opportunity ' + dc.opp.id +
                ': a post in view mode (the design is under way); nothing written' });
            return renderDesignInfo(ctx, dc, { step: 'review', notice: render.DESIGN_TEXT.VIEW_BANNER });
        }

        // 2.5.0 (§B5): what is revealed, on the answers posted here (else stored). A hidden question's answer is ignored:
        // not validated, not written, not noted.
        applyReveal(dc, params);

        // Validate everything first: any error re-renders the page and NOTHING is written.
        editable = dc.questions.filter(function (v) { return !v.readOnly && v.q.type !== 'info' && v.q.revealed !== false; });
        hasElements = editable.some(function (v) { return v.q.type === 'element' && params.hasOwnProperty('q_' + v.q.qid); });
        editable.forEach(function (v) {
            stored[v.q.qid] = currentValue(dc, v.q);
            if (v.q.optionsFromField) {
                options[v.q.qid] = v.options || [];
            }
        });
        check = data.validateDesignInfo(params, files, editable.map(function (v) { return v.q; }), {
            todayKey: dates.londonTodayKey(Date.now()), maxFiles: cfg.DESIGNINFO_MAX_FILES, stored: stored, options: options,
            presets: hasElements ? content(dc, 'presets') : null, market: marketKey(dc, params) });
        if (!check.ok) {
            log.audit({ title: title('DESIGNINFO_REJECTED'), details: clip('Customer ' + ctx.customer.id + ', opportunity ' +
                dc.opp.id + ': ' + JSON.stringify(check.errors)) });
            // 2.4.0: the posted step again, with its errors; if every error is on another step (a crafted post), that step.
            return renderDesignInfo(ctx, dc, { step: errorStep(dc, sec, check.errors), values: check.values, errors: check.errors,
                more: moreOf(params, dc), cards: elementCards(check.values), params: params });
        }

        ch = designChanges(dc, check.values, params);
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

        // 2.4.1 (amendment 1): a navigation with nothing changed, no file and no Send writes nothing — no fields, no
        // state, no Note — and redirects without &saved=1.
        if (!ch.items.length && !hasFiles && !filesRefused && !send) {
            log.debug({ title: title('DESIGNINFO_NO_CHANGE'), details: 'Opportunity ' + dc.opp.id + ': step ' + sec +
                ', nothing changed; nothing written' });
            return epcNav ? epcLookup(ctx, dc, params, check, sec) : { redirect: afterSave(ctx, dc, params, sec, '', false) };
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
        valuesNow = valuesAfter(dc, ch, check, true);

        // Step 1: the fields — with the state in the same write when there are no files (one write).
        if (Object.keys(ch.fields).length) {
            try {
                if (!hasFiles) {
                    next = nextState(dc, ch, touched, valuesNow, [], nowIso, send);
                    try {
                        data.writeDesignInfo(dc.opp.id, ch.fields, stateForWrite(dc, next));
                        stateWritten = true;
                    } catch (eBoth) {
                        // 2.3.1: the state must never block the fields — retry them on their own (step 3 writes the state).
                        log.audit({ title: title('DESIGNINFO_WRITE_RETRY'), details: 'Opportunity ' + dc.opp.id + ': the fields ' +
                            'with the state failed (' + errorText(eBoth) + '); the fields are retried alone' });
                        data.writeDesignInfo(dc.opp.id, ch.fields);
                    }
                } else {
                    data.writeDesignInfo(dc.opp.id, ch.fields);
                }
                ch.fieldItems.forEach(function (c) {
                    if (!c.extra && check.values.hasOwnProperty(c.qid)) {
                        dc.rec.values[c.qid] = check.values[c.qid];
                    }
                });
            } catch (e) {
                failures.push('the answers for the Project Specification tab (' + errorText(e) + '): ' + ch.fieldItems.map(function (c) {
                    return c.label;
                }).join(', '));
                log.error({ title: title('DESIGNINFO_WRITE_FAILED'), details: 'Opportunity ' + dc.opp.id + ': NOT written (' +
                    errorText(e) + '). Attempted: ' + Object.keys(ch.fields).join(', ') + '. The Note and the Task say so.' });
                // The element and EPC fields go back to what the record holds.
                Object.keys(ch.extraNow).forEach(function (fid) {
                    if (dc.rec.extra[fid]) {
                        dc.rec.extra[fid].value = dc.rec.extra[fid].before;
                    }
                });
                valuesNow = valuesAfter(dc, ch, check, false);
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
                        failures.push('file "' + designinfo.plainValue(r.original) + '" (' + r.failed + ')');
                    }
                });
            });
        }

        // Step 3: the state (a second write when step 1 could not carry it).
        if (!stateWritten) {
            next = nextState(dc, ch, touched, valuesNow, newFiles, nowIso, send);
            stateFailed = writeState(dc, next);
            if (stateFailed) {
                failures.push('the page’s progress (' + stateFailed + ')');
            }
        }
        s = next;
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
                        return { name: designinfo.plainValue(r.entry.name), sizeText: designinfo.sizeText(r.size) };
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

        // Step 5: the Task, only on Send. 2.3.1: clipped as the Note is (Task.message holds 4,000 characters).
        if (send) {
            taskBody = task.clipBody(designTaskMessage(dc, s, before, comp, failures, noteFailed, ch, cfg.DESIGNINFO_FOLDER));
            if (taskBody.clipped) {
                log.audit({ title: title('DESIGNINFO_TASK_CLIPPED'), details: 'Opportunity ' + dc.opp.id + ': the Task message was ' +
                    'clipped to ' + task.NOTE_MAX + ' characters (the Notes hold every change)' });
            }
            try {
                taskId = task.createTask({
                    title: task.buildDesignInfoTitle(dc.rec.info.title || dc.opp.title, dc.rec.info.tranId || dc.opp.tranId),
                    assigneeId: dc.recipient.id,
                    customerId: ctx.customer.id,
                    opportunityId: dc.opp.id,
                    message: taskBody.body,
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
                s = unsend(s, before);
                dc.state = s;
                writeState(dc, s);
            }
        }

        log.audit({ title: title('DESIGNINFO_SAVED'), details: clip('Opportunity ' + dc.opp.id + ' (' + (dc.rec.info.tranId || '') +
            '), customer ' + ctx.customer.id + ': sections ' + (touched.join(', ') || '(none)') + '; fields ' +
            (Object.keys(ch.fields).join(', ') || '(none)') + (failures.length ? ' (NOT all written)' : '') + '; files ' +
            newFiles.length + (filesRefused ? ' (refused: no folder)' : '') + '; send ' + (send ? (taskFailed ? 'FAILED' :
            'yes, Task ' + taskId) : 'no') + '; note ' + (noteFailed ? 'FAILED' : 'created') + ' (v' + VERSION + ')') });

        if (!send) {
            if (epcNav) {
                dc.questions = dc.questions.map(function (v) { return questionView(dc, v.q); });
                applyReveal(dc, null);
                return epcLookup(ctx, dc, params, check, sec);
            }
            return { redirect: afterSave(ctx, dc, params, sec, fileResults.some(function (r) { return !r.entry; }) ? 'files' :
                filesRefused ? 'uploads' : failures.length ? 'partial' : '') };
        }
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
        applyReveal(dc, null);
        return renderDesignInfo(ctx, dc, { step: 'review', confirmation: { lines: lines } });
    }

    /** 2.5.0: the element cards among validated values (qid -> card), to show them again after an error. */
    function elementCards(values) {
        var out = {};
        Object.keys(values || {}).forEach(function (k) {
            if (values[k] && typeof values[k] === 'object') {
                out[k] = values[k];
            }
        });
        return out;
    }

    /** 2.5.0: "dd Mon yyyy" of a key, for the address list. */
    function longDate(key) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return m ? parseInt(m[3], 10) + ' ' + months[parseInt(m[2], 10) - 1] + ' ' + m[1] : '';
    }

    /**
     * 2.5.0 (§B9, recon A12): the EPC lookup — its own POST, after the step was saved as a stay save would. nav=epc: the
     * postcode's certificates (newest first) as an address list; nav=epc_use with epc_cert: that certificate, its summary,
     * and the age and the four house cards pre-filled from it (never over the customer's own). Any failure: the step with
     * the "no certificate" notice, nothing written. The step is re-rendered here (no redirect).
     */
    function epcLookup(ctx, dc, params, check, sec) {
        var why = epcUnavailable(dc.cfg);
        var lib = epcLib().lib;
        // 2.5.1: not `token` — that is the imported token module (the shadowing behind the 1.8.1 defect).
        var epcToken = dc.cfg.EPC_BEARER_TOKEN;
        var nav = String(params.nav || '');
        var postcode = String(params.epc_postcode || '').replace(/^\s+|\s+$/g, '').slice(0, 10);
        var number = String(params.epc_cert || '').replace(/^\s+|\s+$/g, '');
        var r;
        var extra = { step: sec, params: params, epc: { postcode: postcode } };
        var d;
        var ageV;
        var ages;
        function notFound(statusCode) {
            log.debug({ title: title('DESIGNINFO_EPC_NONE'), details: 'Opportunity ' + dc.opp.id + ': no certificate (' +
                (nav === 'epc' ? 'search' : 'certificate') + (statusCode ? ', status ' + statusCode : '') + ')' });
            extra.epc.notice = render.STEP_TEXT.EPC_NONE;
            return renderDesignInfo(ctx, dc, extra);
        }
        if (why) {
            dc.once('DESIGNINFO_EPC_UNAVAILABLE', 'Opportunity ' + dc.opp.id + ': the EPC lookup is unavailable (' + why + ')');
            return renderDesignInfo(ctx, dc, extra);
        }
        try {
            if (nav === 'epc') {
                if (!postcode) {
                    return notFound('');
                }
                r = lib.search(postcode, epcToken);
                if (!r.ok || !r.rows || !r.rows.length) {
                    return notFound(r.statusCode);
                }
                extra.epc.rows = r.rows.map(function (x) {
                    return { value: x.certificateNumber, text: [x.address, x.postcode].filter(function (y) { return !!y; }).join(', ') +
                        ' · certificate from ' + longDate(x.registrationDate) };
                });
                return renderDesignInfo(ctx, dc, extra);
            }
            if (!EPC_NUMBER_RE.test(number)) {
                return notFound('');
            }
            r = lib.certificate(number, epcToken);
            if (!r.ok || !r.data) {
                return notFound(r.statusCode);
            }
        } catch (e) {
            log.debug({ title: title('DESIGNINFO_EPC_NONE'), details: 'Opportunity ' + dc.opp.id + ': the lookup threw (' +
                errorText(e) + ')' });
            extra.epc.notice = render.STEP_TEXT.EPC_NONE;
            return renderDesignInfo(ctx, dc, extra);
        }
        d = r.data;
        // One-off field-name capture: the certificate's top-level keys, once per request.
        dc.once.debug('DESIGNINFO_EPC_RAW_KEYS', 'Opportunity ' + dc.opp.id + ', certificate ' + number + ': ' +
            (d.rawKeys || []).join(', '));
        extra.epc.cert = { number: d.certificateNumber || number, dateKey: String(d.lodgementDate || '').slice(0, 10),
            rating: /^[A-G]$/.test(String(d.currentEnergyRating || '')) ? String(d.currentEnergyRating) : '',
            floorArea: d.totalFloorArea ? String(d.totalFloorArea) : '', ageBand: d.constructionAgeBand || '',
            address: d.address || '' };
        // The pre-fill: the age (only when not answered) and the four house cards.
        ages = designinfo.ageBandKey(d.constructionAgeBand);
        ageV = dc.questions.filter(function (x) { return x.q.field === OPPF.PROPERTY_AGE; })[0];
        extra.values = {};
        if (ageV && !currentValue(dc, ageV.q) && ages !== 'unsure') {
            extra.values[ageV.q.qid] = ageV.q.options[(ageV.q.optionKeys || []).indexOf(ages)] || '';
        }
        extra.epcFill = {};
        dc.questions.forEach(function (v) {
            var text;
            if (v.q.type !== 'element' || v.q.ext) {
                return;
            }
            text = { walls: d.wallsDescription, windows: d.windowsDescription, roof: d.roofDescription,
                floor: d.floorDescription }[v.q.element];
            extra.epcFill[v.q.qid] = designinfo.epcElement(text, content(dc, 'epcMap'), v.q.element);
        });
        return renderDesignInfo(ctx, dc, extra);
    }

    /** "dd/mm/yyyy HH:mm" (London) of a stored time, '' for none. */
    function londonText(iso) {
        var ms = Date.parse(iso || '');
        return isNaN(ms) ? '' : designinfo.londonTime(ms).text;
    }

    /**
     * 2.3.2 (amendment 3): one question's current answer for the Task's snapshot — the record's value (or its text when
     * read-only), the state's answer, the files from the state, or this post's Note-only answer; a Note-only answer given
     * earlier says so. '' when there is none. Plain text, clipped at 200. 2.5.0: an element's line, the EPC, a declined
     * answer ("customer says"), an @setting choice's label; a question hidden by its reveal has none.
     */
    function snapshotValue(dc, v, s, ch) {
        var q = v.q;
        var value;
        if (q.type === 'info' || q.revealed === false) {
            return '';
        }
        if (q.type === 'files') {
            value = s.files.filter(function (f) { return f.qid === q.qid; }).map(function (f) { return f.name; }).join(', ');
        } else if (q.store === STORE.ELEMENT) {
            value = elementStored(dc, q, marketKey(dc, null)).line;
        } else if (q.store === STORE.EPC) {
            value = extraValue(dc, OPPF.EPC_NUMBER) ? 'Certificate ' + extraValue(dc, OPPF.EPC_NUMBER) +
                (extraValue(dc, OPPF.EPC_DATE) ? ', valid until ' + designinfo.slashDate(addYears(extraValue(dc, OPPF.EPC_DATE), 10)) :
                    '') : '';
        } else if (q.store === STORE.FIELD) {
            value = v.readOnly ? (dc.rec.texts[q.qid] || '') :
                q.type === 'choice' && !q.optionsFromField && !q.optionsFromSetting ? (dc.rec.values[q.qid] || '') :
                    answerText(v, dc.rec.values[q.qid]);
            if (dc.fill.hasOwnProperty(q.field) && s.answers[q.qid] && s.answers[q.qid] !== dc.rec.values[q.qid]) {
                value = 'customer says ' + answerText(v, s.answers[q.qid]) + '; the opportunity holds ' + (value || '(nothing)');
            }
        } else if (q.store === STORE.STATE || q.type === 'date' || q.type === 'choice') {
            value = answerText(v, s.answers[q.qid]);
        } else if (ch.posted.hasOwnProperty(q.qid)) {
            value = ch.posted[q.qid];
        } else {
            value = s.noted[q.qid] ? '(given earlier: in the Notes)' : '';
        }
        return designinfo.plainValue(value, 200);
    }

    /**
     * 2.5.0 (§B10): the Task's extra lines — the fill rule's "Customer says X; opportunity holds Y", each extension
     * ("Extension N: <what>, <age>, <where or 'marked on plans'>"), the EPC used.
     */
    function taskExtraLines(dc, s, ch) {
        var out = [];
        var byQid = {};
        dc.questions.forEach(function (v) { byQid[v.q.qid] = v; });
        dc.questions.forEach(function (v) {
            var q = v.q;
            if (q.store === STORE.FIELD && dc.fill.hasOwnProperty(q.field) && q.revealed !== false && s.answers[q.qid] &&
                    s.answers[q.qid] !== dc.rec.values[q.qid] && dc.rec.values[q.qid]) {
                out.push('Customer says ' + answerText(v, s.answers[q.qid]) + ' (' + q.label + '); the opportunity holds ' +
                    (answerText(v, dc.rec.values[q.qid]) || dc.rec.texts[q.qid] || dc.rec.values[q.qid]) + '. Not changed: ' +
                    'update it yourself if the customer is right.');
            }
        });
        [1, 2].forEach(function (n) {
            var what = byQid['ext' + n + '_what'];
            var age = byQid['ext' + n + '_age'];
            var marked = byQid['ext' + n + '_marked'];
            var where = byQid['ext' + n + '_where'];
            var whatText;
            var whereText;
            if (!what || what.q.revealed === false) {
                return;
            }
            // 2.5.1: "what is it" is kept in the state (field state), so the line always has it.
            whatText = what.q.store === STORE.STATE ? String(s.answers[what.q.qid] || '') :
                ch.posted.hasOwnProperty(what.q.qid) ? ch.posted[what.q.qid] : s.noted[what.q.qid] ? '(in the Notes)' : '';
            whereText = marked && s.answers[marked.q.qid] === 'yes' ? 'marked on plans' : where && ch.posted.hasOwnProperty(where.q.qid) ?
                ch.posted[where.q.qid] : where && s.noted[where.q.qid] ? 'described (in the Notes)' : '';
            out.push('Extension ' + n + ': ' + [whatText || '(not given)', age ? s.answers[age.q.qid] || '(age not given)' : '',
                whereText || '(where not given)'].filter(function (x) { return !!x; }).map(function (x) {
                return designinfo.plainValue(x, 200);
            }).join(', '));
        });
        if (extraValue(dc, OPPF.EPC_NUMBER)) {
            out.push('EPC used: certificate ' + extraValue(dc, OPPF.EPC_NUMBER) + (extraValue(dc, OPPF.EPC_DATE) ? ', lodged ' +
                designinfo.slashDate(extraValue(dc, OPPF.EPC_DATE)) + ', valid until ' +
                designinfo.slashDate(addYears(extraValue(dc, OPPF.EPC_DATE), 10)) : '') + '.');
        }
        return out;
    }

    /**
     * The DESIGN INFO Task's message (brief §5.5; amendments 1 §1 and 3): a snapshot of every shown section, the pointer
     * to the Notes for the changes since the last send, the files since the last Send. 2.5.0: revealed questions only;
     * the extra lines (taskExtraLines()); the heat warnings (facts.warnings).
     */
    function designTaskMessage(dc, s, before, comp, failures, noteFailed, ch, folderId) {
        var since = before.lastTaskAt || '';
        var statusOf = {};
        var goods = s.answers[designinfo.GOODS_DATE_QID] && s.answers[designinfo.GOODS_DATE_QID] !== dc.rec.info.delDateKey ?
            'Customer says goods are needed by ' + designinfo.slashDate(s.answers[designinfo.GOODS_DATE_QID]) + ' (we hold ' +
            (designinfo.slashDate(dc.rec.info.delDateKey) || 'no date') + '). Check and update the opportunity date yourself; the ' +
            'dashboard did not change it.' : '';
        var extraLines = taskExtraLines(dc, s, ch);
        comp.sections.forEach(function (x) { statusOf[x.id] = x.status; });
        return task.buildDesignInfoMessage({
            complete: comp.complete,
            missing: comp.missing,
            sections: designinfo.sectionsOf(dc.questions.map(function (v) { return v.q; })).map(function (sec) {
                return {
                    title: sec.title,
                    status: statusOf[sec.id] || '',
                    lines: dc.questions.filter(function (v) { return v.q.section === sec.id; }).map(function (v) {
                        var value = snapshotValue(dc, v, s, ch);
                        return value ? itemLabel(v.q) + ': ' + value : '';
                    }).filter(function (l) { return !!l; })
                };
            }),
            sinceText: londonText(before.sent) || londonText(before.requested),
            serviceText: designinfo.plainValue(dc.rec.info.valuePropositionText),
            files: s.files.filter(function (f) { return !since || f.at > since; }).map(function (f) {
                return { name: designinfo.plainValue(f.name), label: f.qid,
                    attachNote: f.attached === false ? '(NOT attached: in the folder only)' : '' };
            }),
            folderText: 'File Cabinet folder ' + folderId + ', attached to this opportunity unless marked',
            goodsLine: [goods].concat(extraLines).filter(function (x) { return !!x; }).join('\n'),
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
                html = handleDesignInfoGet(ctx, params);
            } else {
                html = renderDashboard(ctx);
            }
            if (html && html.redirect) {
                // 2.4.0: after a stepper save, and a step URL in view mode (a 302: N/redirect has no 303).
                redirect.redirect({ url: html.redirect });
                return;
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
