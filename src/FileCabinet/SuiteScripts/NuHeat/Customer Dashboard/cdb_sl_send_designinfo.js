/**
 * cdb_sl_send_designinfo.js
 *
 * "Request design information" (release 2.3): emails the customer the "Tell us about your property" email with a
 * direct link to the design information page for ONE opportunity. Internal Suitelet, LOGIN REQUIRED (never
 * Available Without Login), reached from the button cdb_ue_opportunity.js adds to the opportunity. Built like
 * cdb_sl_send_link.js. Released only after testing.
 *
 *   GET  ?opp=<id>                     the confirm page: customer, project, sender, recipient, what will be asked
 *   POST custpage_opp=<id>             the email; then back to the opportunity with the banner
 *
 * EVERY REQUEST re-checks on the server (data.designInfoRequest(), one lookupFields, and data.requestRefusal(), the
 * button's rule): Won; sub-status in NEEDINFO_SUBSTATUS; FC_MAP set and the FC not none. Then: the customer active
 * with a usable email (data.emailRecipient(), the digest's rule), and the registry readable (the link would show
 * "not available" without it). Any failure: a page with the reason, nothing sent (CDB DESIGNINFO_REQUEST_REFUSED).
 *
 * SENDER (brief §5.3): data.resolveRecipient() — the PE for a PE value proposition with a PE, else the sales rep,
 * else FALLBACK_EMPLOYEE; an unreadable or inactive employee falls back too. The email's author and its card. When
 * the sender is the PE and DESIGN_EMAIL_ADDRESS is set, the card prints that address. RECIPIENT: emailRecipient()
 * only. relatedRecords: the customer and the opportunity (both Communication tabs).
 *
 * WRITES ONE FIELD: the state's `requested` (custbody_cdb_designinfo_state), MERGED into what is there; an
 * unparsable state is left alone (logged), never clobbered. Never the sub-status or anything else.
 *
 * GOVERNANCE (units): a GET is about 25 — the settings search 10, the opportunity lookup 1, the customer and contact
 * lookups 2, the registry's file.load 10, the employee lookups 1–3. A POST adds the two links' customer lookups 2,
 * email.send 20 and the state write 10: about 60.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/record', 'N/email', 'N/redirect', 'N/url', 'N/log', 'N/ui/serverWidget', './lib/cdb_lib_config',
    './lib/cdb_lib_token', './lib/cdb_lib_data', './lib/cdb_lib_render', './lib/cdb_lib_designinfo'],
    function (record, email, redirect, url, log, serverWidget, config, token, data, render, designinfo) {

    'use strict';

    var VERSION = '1.0.0';

    var OUTCOME = { SENT: 'sent', FAILED: 'failed' };

    var FIELD_OPP = 'custpage_opp';

    function title(name) {
        return config.logTitle(name);
    }

    function message(e) {
        return e && e.message ? e.message : String(e);
    }

    /** Back to the opportunity, with the banner code and the time it was set. */
    function back(oppId, outcome) {
        redirect.toRecord({
            type: record.Type.OPPORTUNITY,
            id: oppId,
            parameters: { cdbdi: outcome, cdbdt: String(Date.now()) }
        });
    }

    /** The opportunity's own page, for the "back" link. '' when it cannot be resolved. */
    function oppUrl(oppId) {
        try {
            return url.resolveRecord({ recordType: record.Type.OPPORTUNITY, recordId: oppId });
        } catch (e) {
            return '';
        }
    }

    /** A page with the reason nothing was sent (the showMessagePage pattern). Every value escaped. */
    function showMessage(response, oppId, text) {
        var form = serverWidget.createForm({ title: 'Design information NOT requested' });
        var back = /^\d+$/.test(String(oppId || '')) ? oppUrl(oppId) : '';
        form.addField({ id: 'custpage_message', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue =
            '<p style="font-size:14px">Nothing was sent: ' + render.esc(text) + '.</p>' +
            (back ? '<p style="font-size:14px"><a href="' + render.esc(back) + '">Back to the opportunity</a></p>' : '');
        response.writePage(form);
    }

    /** The sender: the PE or the rep (or the fallback), active, with the photo for the card. */
    function senderOf(opp, cfg) {
        var r = data.resolveRecipient(opp, cfg);
        var emp = data.getEmployee(r.employeeId, true);
        if (!emp || emp.isInactive) {
            r = { employeeId: String(cfg.FALLBACK_EMPLOYEE), source: 'fallback' };
            emp = data.getEmployee(r.employeeId, true);
        }
        return emp ? { employee: emp, role: r.source === 'pe' ? 'pe' : 'am', source: r.source } : null;
    }

    /**
     * Every check, for GET and POST alike. { ok, reason } or { ok, check, customer, recipient, reg, facts, titles,
     * sender }.
     */
    function prepare(oppId, cfg) {
        var check = data.designInfoRequest(oppId, cfg);
        var out = { ok: false, reason: '' };
        var customer;
        var recipient;
        var reg;
        var facts;
        var sender;
        if (!check.ok) {
            out.reason = check.reason;
            return out;
        }
        customer = data.getCustomer(check.opp.customerId);
        if (!customer || customer.isInactive) {
            out.reason = 'customer ' + check.opp.customerId + (customer ? ' is inactive' : ' could not be read');
            return out;
        }
        recipient = data.emailRecipient(customer);
        if (!recipient || !data.looksLikeEmail(recipient)) {
            out.reason = 'the customer has no valid email (dashboard contact ' + (customer.dashboardContact || '(none)') +
                ', customer email "' + customer.email + '")';
            return out;
        }
        reg = data.loadRegistry(cfg.DESIGNINFO_REGISTRY);
        if (reg.status !== 'ok') {
            out.reason = 'the question registry is unavailable (' + reg.status + (reg.detail ? ': ' + reg.detail : '') +
                '), so the link would not open';
            return out;
        }
        sender = senderOf(check.opp, cfg);
        if (!sender) {
            out.reason = 'no active employee to send from (PE, sales rep and FALLBACK_EMPLOYEE unreadable or inactive)';
            return out;
        }
        facts = designinfo.buildFacts({ valueProposition: check.opp.valueProposition, fc: check.opp.fc,
            heatSource: check.opp.heatSource, market: check.opp.market, subStatus: check.opp.subStatus }, cfg);
        return { ok: true, check: check, opp: check.opp, customer: customer, recipient: recipient, reg: reg, facts: facts,
            titles: designinfo.sectionsOf(designinfo.visibleQuestions(reg.questions, facts)).map(function (s) { return s.title; }),
            sender: sender };
    }

    function refuse(response, oppId, reason) {
        log.audit({ title: title('DESIGNINFO_REQUEST_REFUSED'), details: 'Opportunity ' + oppId + ': ' + reason });
        showMessage(response, oppId, reason);
    }

    /** GET: the confirm page. */
    function confirmPage(response, p) {
        var form = serverWidget.createForm({ title: 'Request design information' });
        var rows = [
            ['Customer', p.customer.name],
            ['Project', [p.opp.title, p.opp.tranId].filter(function (x) { return !!x; }).join(' · ')],
            ['From', p.sender.employee.name + (p.sender.role === 'pe' ? ' (Project Engineer)' : ' (account manager)')],
            ['To', p.recipient],
            ['The customer will be asked about', p.titles.join(', ')]
        ];
        if (p.facts.warnings.length) {
            rows.push(['Check first', p.facts.warnings.join(' ')]);
        }
        form.addField({ id: 'custpage_summary', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue =
            '<table style="font-size:14px;border-collapse:collapse">' + rows.map(function (r) {
                return '<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top">' + render.esc(r[0]) +
                    '</td><td style="padding:4px 0">' + render.esc(r[1]) + '</td></tr>';
            }).join('') + '</table>';
        form.addField({ id: FIELD_OPP, type: serverWidget.FieldType.TEXT, label: 'Opportunity' }).updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = p.opp.id;
        form.addSubmitButton({ label: 'Send the email' });
        response.writePage(form);
    }

    /** POST: the email, the state, the log. @returns {string} an OUTCOME */
    function sendFor(p, cfg) {
        var parsed = config.parseDesignInfoEmail(cfg.DESIGNINFO_EMAIL);
        var emp = p.sender.employee;
        var am;
        var pe;
        var body;
        var state;
        var todayKey = designinfo.londonTime(Date.now()).key;
        if (parsed.status === 'invalid') {
            log.audit({ title: title('DESIGNINFO_EMAIL_INVALID'), details: 'Setting DESIGNINFO_EMAIL ignored: ' + parsed.detail });
        }
        try {
            am = data.emailAm(emp, 'Design information request, opportunity ' + p.opp.id);
            if (p.sender.role === 'pe' && cfg.DESIGN_EMAIL_ADDRESS) {
                am.email = cfg.DESIGN_EMAIL_ADDRESS;
            }
            pe = p.sender.role === 'am' && p.opp.pe ? data.getEmployee(p.opp.pe) : null;
            body = render.designInfoRequestEmail({
                text: parsed.text,
                customerName: p.customer.name,
                greetingName: p.customer.greetingName,
                logoUrl: cfg.LOGO_URL,
                opp: { tranId: p.opp.tranId, title: p.opp.title, siteAddress: p.opp.siteAddress },
                havingText: [p.opp.fcText, p.opp.heatSourceText].filter(function (x) { return !!x; }).join(' · '),
                callKey: p.opp.nextContactKey && p.opp.nextContactKey >= todayKey ? p.opp.nextContactKey : '',
                goodsKey: p.opp.delDateKey,
                link: token.buildLink(p.opp.customerId, { a: 'designinfo', opp: p.opp.id }),
                dashboardLink: token.buildLink(p.opp.customerId),
                sender: am,
                senderRole: p.sender.role,
                peName: pe && !pe.isInactive ? pe.name : '',
                steps: { insulation: p.facts.service !== 'ufh', heatPump: p.facts.heat === 'nuheat_hp' }
            });
            email.send({
                author: parseInt(emp.id, 10),
                recipients: [p.recipient],
                subject: render.designInfoRequestSubject(parsed.text),
                body: body,
                relatedRecords: { entityId: parseInt(p.opp.customerId, 10), transactionId: parseInt(p.opp.id, 10) }
            });
        } catch (e) {
            log.error({ title: title('DESIGNINFO_REQUEST_FAILED'), details: 'Opportunity ' + p.opp.id + ', customer ' +
                p.opp.customerId + ', to ' + p.recipient + ': ' + message(e) });
            return OUTCOME.FAILED;
        }

        // The state's `requested`, merged; an unparsable state is never overwritten.
        state = designinfo.parseState(p.opp.stateRaw);
        if (state.status === 'invalid') {
            log.audit({ title: title('DESIGNINFO_STATE_INVALID'), details: 'Opportunity ' + p.opp.id + ': ' + state.detail +
                '; "requested" not recorded, the state left as it is' });
        } else {
            state.state.requested = new Date().toISOString();
            try {
                data.writeDesignInfo(p.opp.id, {}, designinfo.stateText(state.state));
            } catch (e2) {
                log.error({ title: title('DESIGNINFO_STATE_FAILED'), details: 'Opportunity ' + p.opp.id + ': the email WAS sent; ' +
                    '"requested" not recorded (' + message(e2) + ')' });
            }
        }

        log.audit({ title: title('DESIGNINFO_REQUESTED'), details: 'Opportunity ' + p.opp.id + ' (' + p.opp.tranId +
            '), customer ' + p.opp.customerId + ', to ' + p.recipient + ', from employee ' + emp.id + ' (' + p.sender.source +
            '), asking about: ' + p.titles.join(', ') + ' (v' + VERSION + ')' });
        return OUTCOME.SENT;
    }

    /**
     * @param {Object} context - Suitelet context
     */
    function onRequest(context) {
        var request = context.request;
        var params = request.parameters || {};
        var post = request.method === 'POST';
        var oppId = String((post ? params[FIELD_OPP] : params.opp) || '').replace(/^\s+|\s+$/g, '');
        var cfg;
        var p;

        if (!/^\d+$/.test(oppId)) {
            refuse(context.response, '', 'no opportunity was given');
            return;
        }
        try {
            cfg = config.load(log);
        } catch (e) {
            log.error({ title: title('CONFIG_FAILED'), details: message(e) });
            showMessage(context.response, oppId, 'a setting is missing (see the script log, CDB PARAMETER_MISSING)');
            return;
        }
        try {
            p = prepare(oppId, cfg);
        } catch (e2) {
            log.error({ title: title('DESIGNINFO_REQUEST_FAILED'), details: 'Opportunity ' + oppId + ': ' + message(e2) +
                (e2 && e2.stack ? ' ' + e2.stack : '') });
            showMessage(context.response, oppId, 'something went wrong (CDB DESIGNINFO_REQUEST_FAILED)');
            return;
        }
        if (!p.ok) {
            refuse(context.response, oppId, p.reason);
            return;
        }
        if (!post) {
            confirmPage(context.response, p);
            return;
        }
        back(oppId, sendFor(p, cfg));
    }

    return { onRequest: onRequest };
});
