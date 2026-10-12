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
 * WRITES ONE FIELD: the state's `requested` (custbody_cdb_designinfo_state), MERGED into what is there. 1.0.1
 * (amendment 2): an unparsable state is treated as empty, as the dashboard does — logged once
 * (CDB DESIGNINFO_STATE_INVALID) and replaced by a fresh state with `req`. 1.0.2 (amendment 3): the state is version 2,
 * compact, in a Text Area (designinfo 1.0.2); a version 1 state is migrated as it is read. Never the sub-status or
 * anything else.
 *
 * GOVERNANCE (units): a GET is about 25 — the settings search 10, the opportunity lookup 1, the customer and contact
 * lookups 2, the registry's file.load 10, the employee lookups 1–3. A POST adds the two links' customer lookups 2,
 * email.send 20 and the state write 10: about 60.
 *
 * 1.1.0 (release 2.3c §B4):
 *   - THE STEPS ASKED ABOUT. One checkbox (custpage_step_<id>) per step designinfo.stepsFor(questions, facts, []) gives,
 *     project and other left out (always asked), labelled with the step's title; pre-ticked from the previous request's
 *     rq, else all. On Send the ticks are intersected with the allowed steps AGAIN on the server and stored as the state's
 *     rq (with project and other, so "nothing ticked" is stored as asking about those two, never as "everything"); the
 *     email's "What we'll ask" and the log line come from stepsFor(…, rq). The hard-coded insulation / heat pump rule is
 *     gone.
 *   - FIX THE FACTS. When custbody_heat_source_type_26 AND custbody_mi_heat_source are both empty or unmapped, or
 *     custbody_mi_opp_fc is empty or unmapped, those fields show as selects of the field's own options (one dynamic
 *     record.load, 10) with "Update and recheck" (custpage_recheck): it writes ONLY those fields (config.FACTS_FIX_FIELDS,
 *     data.writeFacts(), one submitFields, 10), each value checked against the field's options, then redraws the page
 *     with the facts recalculated. Send stays the form's own submit.
 *   - The heat facts read custbody_heat_source_type_26 (DI_HEAT26_MAP), the Sales MI the fallback.
 * GOVERNANCE 1.1.0 (modelled in test/r2-5.test.js): the facts form adds the record.load (10) to a GET; "Update and recheck"
 * is the write (10) plus the redraw (a GET again).
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * 1.1.1 (2.3c amendment 1): the email's subtitle time is the asked steps' minutes summed (none: no time).
 *
 * 1.1.2 (2.3c amendment 2): the step tick boxes in one block under "Steps to ask for" (Your project and Anything else as
 * fixed lines); the email lists the steps' long titles.
 *
 * 1.2.0 (2.3c amendment 3): six steps (the tick boxes are Heat loss, Heating and Heat pump); the email's intro names the
 * system in plain words (designinfo.systemWords(), lower-case; none: "heating system") and assumes no design call.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @version 1.2.0
 */
define(['N/record', 'N/email', 'N/redirect', 'N/url', 'N/log', 'N/ui/serverWidget', './lib/cdb_lib_config',
    './lib/cdb_lib_token', './lib/cdb_lib_data', './lib/cdb_lib_render', './lib/cdb_lib_designinfo'],
    function (record, email, redirect, url, log, serverWidget, config, token, data, render, designinfo) {

    'use strict';

    var VERSION = '1.2.0';

    var OUTCOME = { SENT: 'sent', FAILED: 'failed' };

    var FIELD_OPP = 'custpage_opp';

    /** 1.1.0: the step checkboxes' prefix, the facts form's fields and its submit. */
    var FIELD_STEP = 'custpage_step_';
    var FIELD_RECHECK = 'custpage_recheck';
    var FIX = { HEAT26: 'custpage_fix_heat26', HEAT: 'custpage_fix_heat', FC: 'custpage_fix_fc' };
    var OPPF = config.FIELDS.OPPORTUNITY;

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
        reg = data.loadRegistry(cfg.DESIGNINFO_REGISTRY, cfg);
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
            heatSource: check.opp.heatSource, heatSource26: check.opp.heatSource26, market: check.opp.market,
            subStatus: check.opp.subStatus }, cfg);
        out = { ok: true, check: check, opp: check.opp, customer: customer, recipient: recipient, reg: reg, facts: facts,
            sender: sender, state: designinfo.parseState(check.opp.stateRaw), maps: designinfo.parseMaps(cfg) };
        // 1.1.0: the steps that can be asked about (ticks), and which the previous request asked about.
        out.allowed = designinfo.stepsFor(reg.questions, facts, []);
        out.tickable = out.allowed.filter(function (st) { return designinfo.ALWAYS_STEPS.indexOf(st.id) < 0; });
        out.preticked = out.state.state.rq.length ? out.tickable.filter(function (st) {
            return out.state.state.rq.indexOf(st.id) >= 0;
        }) : out.tickable;
        out.titles = askedSteps(out, out.preticked.map(function (st) { return st.id; })).map(function (st) { return st.title; });
        out.fix = factsToFix(out);
        return out;
    }

    /** 1.1.0: the steps a request with these ticks asks about (stepsFor() with rq; project and other always). */
    function askedSteps(p, ticks) {
        return designinfo.stepsFor(p.reg.questions, p.facts, requestedIds(p, ticks));
    }

    /** 1.1.0: the rq stored — the ticks that are allowed steps (checked on the server), with project and other. */
    function requestedIds(p, ticks) {
        var ok = p.tickable.map(function (st) { return st.id; }).filter(function (id) { return (ticks || []).indexOf(id) >= 0; });
        return designinfo.ALWAYS_STEPS.slice(0, 1).concat(ok).concat(designinfo.ALWAYS_STEPS.slice(1));
    }

    /**
     * 1.1.0: the facts the sender should fix first — the heat source (Heat Source Type AND the Sales MI both empty or
     * unmapped) and the floor construction (empty or unmapped). { heat: boolean, fc: boolean }
     */
    function factsToFix(p) {
        var heatMi = String(p.opp.heatSource || '');
        return {
            heat: p.facts.heatFrom === 'mi' && (heatMi === '' || !p.maps.heat.hasOwnProperty(heatMi)),
            fc: p.facts.fc.length === 1 && p.facts.fc[0] === 'unknown'
        };
    }

    /** 1.1.0: the facts fields' options, from the opportunity's own fields (one dynamic record.load). {} when unreadable. */
    function factOptions(oppId) {
        var out = {};
        var rec;
        try {
            rec = record.load({ type: record.Type.OPPORTUNITY, id: oppId, isDynamic: true });
        } catch (e) {
            log.audit({ title: title('DESIGNINFO_FACTS_OPTIONS'), details: 'Opportunity ' + oppId + ': not loaded (' + message(e) +
                '); the facts form is not shown' });
            return out;
        }
        config.FACTS_FIX_FIELDS.forEach(function (fieldId) {
            var f;
            try {
                f = rec.getField({ fieldId: fieldId });
                out[fieldId] = f ? (f.getSelectOptions() || []).filter(function (o) {
                    return o && String(o.value).replace(/^\s+|\s+$/g, '') !== '';
                }).map(function (o) { return { value: String(o.value), text: String(o.text || o.value) }; }) : [];
            } catch (e2) {
                out[fieldId] = [];
            }
        });
        return out;
    }

    function refuse(response, oppId, reason) {
        log.audit({ title: title('DESIGNINFO_REQUEST_REFUSED'), details: 'Opportunity ' + oppId + ': ' + reason });
        showMessage(response, oppId, reason);
    }

    /**
     * GET: the confirm page. 1.1.0: the step checkboxes, and the facts form when a fact needs fixing. notice: a line above
     * the table (after "Update and recheck").
     */
    function confirmPage(response, p, notice) {
        var form = serverWidget.createForm({ title: 'Request design information' });
        var rows = [
            ['Customer', p.customer.name],
            ['Project', [p.opp.title, p.opp.tranId].filter(function (x) { return !!x; }).join(' · ')],
            ['From', p.sender.employee.name + (p.sender.role === 'pe' ? ' (Project Engineer)' : ' (account manager)')],
            ['To', p.recipient],
            ['The customer will be asked about', p.titles.join(', ')]
        ];
        var ticked = p.preticked.map(function (st) { return st.id; });
        var options;
        if (p.facts.warnings.length) {
            rows.push(['Check first', p.facts.warnings.join(' ')]);
        }
        form.addField({ id: 'custpage_summary', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue =
            (notice ? '<p style="font-size:14px;font-weight:600">' + render.esc(notice) + '</p>' : '') +
            '<table style="font-size:14px;border-collapse:collapse">' + rows.map(function (r) {
                return '<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top">' + render.esc(r[0]) +
                    '</td><td style="padding:4px 0">' + render.esc(r[1]) + '</td></tr>';
            }).join('') + '</table>';
        // 1.1.2 (amendment 2): the step tick boxes in ONE block, one per line, in step order, under "Steps to ask for"; Your
        // project and Anything else as fixed lines. Plain checkboxes posting custpage_step_<id>=T, as the CHECKBOX fields did.
        form.addField({ id: 'custpage_steps', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue =
            '<div style="font-size:14px;margin:16px 0 0"><p style="font-weight:600;margin:0 0 6px">Steps to ask for</p>' +
            p.allowed.map(function (st) {
                var always = designinfo.ALWAYS_STEPS.indexOf(st.id) >= 0;
                return '<label style="display:block;padding:3px 0' + (always ? ';color:#666' : '') + '"><input type="checkbox"' +
                    (always ? ' checked disabled' : ' name="' + FIELD_STEP + render.esc(st.id) + '" value="T"' +
                    (ticked.indexOf(st.id) >= 0 ? ' checked' : '')) + '> ' + render.esc(st.title) +
                    (always ? ' (always included)' : '') + '</label>';
            }).join('') + '</div>';
        // 1.1.0: fix the facts first, when they are missing or unmapped.
        if (p.fix.heat || p.fix.fc) {
            options = factOptions(p.opp.id);
            form.addField({ id: 'custpage_fix_intro', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue =
                '<p style="font-size:14px;margin:16px 0 0"><b>Fix the facts first.</b> ' + render.esc([p.fix.heat ?
                'The heat source is not set (or not mapped) in Heat Source Type or the Sales MI.' : '', p.fix.fc ?
                'The floor construction is not set (or not mapped).' : ''].filter(function (x) { return !!x; }).join(' ')) +
                ' Set it here and press Update and recheck; Send the email stays separate.</p>';
            if (p.fix.heat) {
                selectField(form, FIX.HEAT26, serverWidget.FieldType.MULTISELECT, 'Heat Source Type', options[OPPF.HEAT_SOURCE_TYPE]);
                selectField(form, FIX.HEAT, serverWidget.FieldType.SELECT, 'Heat source (Sales MI)', options[OPPF.HEAT_SOURCE]);
            }
            if (p.fix.fc) {
                selectField(form, FIX.FC, serverWidget.FieldType.SELECT, 'Floor construction (Sales MI)', options[OPPF.FC]);
            }
            form.addField({ id: 'custpage_fix_go', type: serverWidget.FieldType.INLINEHTML, label: ' ' }).defaultValue =
                '<p><input type="submit" name="' + FIELD_RECHECK + '" value="Update and recheck" style="font-size:14px"></p>';
        }
        form.addField({ id: FIELD_OPP, type: serverWidget.FieldType.TEXT, label: 'Opportunity' }).updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = p.opp.id;
        form.addSubmitButton({ label: 'Send the email' });
        response.writePage(form);
    }

    /** 1.1.0: a select of a field's own options (blank first for a single select). */
    function selectField(form, id, type, label, options) {
        var f = form.addField({ id: id, type: type, label: label });
        if (type === serverWidget.FieldType.SELECT) {
            f.addSelectOption({ value: '', text: '' });
        }
        (options || []).forEach(function (o) {
            f.addSelectOption({ value: o.value, text: o.text });
        });
        return f;
    }

    /** 1.1.0: a posted select or multi-select as IDs (NetSuite joins a multi-select's values with \u0005). */
    function postedIds(value) {
        return designinfo.idsOf(value);
    }

    /**
     * 1.1.0: "Update and recheck" — ONLY the facts that needed fixing, each value one of the field's options, empty never
     * written (data.writeFacts(): config.FACTS_FIX_FIELDS). Then the page again, with the facts recalculated.
     * @returns {string} the notice for the redraw
     */
    function recheck(p, params) {
        var options = factOptions(p.opp.id);
        var values = {};
        var bad = [];
        function pick(fieldId, posted, multi) {
            var ok = (options[fieldId] || []).map(function (o) { return o.value; });
            var ids = postedIds(posted);
            if (!ids.length) {
                return;
            }
            if (!ids.every(function (id) { return ok.indexOf(id) >= 0; })) {
                bad.push(fieldId);
                return;
            }
            values[fieldId] = multi ? ids : ids[0];
        }
        if (p.fix.heat) {
            pick(OPPF.HEAT_SOURCE_TYPE, params[FIX.HEAT26], true);
            pick(OPPF.HEAT_SOURCE, params[FIX.HEAT], false);
        }
        if (p.fix.fc) {
            pick(OPPF.FC, params[FIX.FC], false);
        }
        if (bad.length) {
            log.audit({ title: title('DESIGNINFO_FACTS_REFUSED'), details: 'Opportunity ' + p.opp.id + ': not one of the field\'s ' +
                'options: ' + bad.join(', ') + '; nothing written' });
            return 'Nothing was changed: a value was not one of the field\'s options.';
        }
        if (!Object.keys(values).length) {
            return 'Nothing was changed: choose a value first.';
        }
        try {
            data.writeFacts(p.opp.id, values);
        } catch (e) {
            log.error({ title: title('DESIGNINFO_FACTS_FAILED'), details: 'Opportunity ' + p.opp.id + ': ' + message(e) });
            return 'The facts could not be updated: ' + message(e);
        }
        log.audit({ title: title('DESIGNINFO_FACTS_UPDATED'), details: 'Opportunity ' + p.opp.id + ': ' + Object.keys(values).map(function (k) {
            return k + '=' + [].concat(values[k]).join(',');
        }).join('; ') + ' (v' + VERSION + ')' });
        return 'Updated. The facts below are recalculated.';
    }

    /** POST: the email, the state, the log. @returns {string} an OUTCOME */
    function sendFor(p, cfg, params) {
        var parsed = config.parseDesignInfoEmail(cfg.DESIGNINFO_EMAIL);
        // 1.1.0: the ticks, checked against the allowed steps again here; what the email lists and the state keeps.
        var ticks = p.tickable.filter(function (st) { return String((params || {})[FIELD_STEP + st.id] || '') === 'T'; })
            .map(function (st) { return st.id; });
        var rq = requestedIds(p, ticks);
        var asked = askedSteps(p, ticks);
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
                // 1.1.2 (amendment 2): the long titles (the step bar has the short ones).
                askList: asked.map(function (st) { return st.title; }),
                // 1.1.1: the subtitle's time, the same sum as the card's ("about N minutes"; 0: no time).
                minutes: designinfo.stepsMinutes(asked),
                // 1.2.0 (amendment 3): "your {system}" in the intro.
                system: designinfo.systemWords(p.facts).lower
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

        // The state's `requested`, merged; an unparsable state is treated as empty, as on the dashboard (1.0.1).
        state = designinfo.parseState(p.opp.stateRaw);
        if (state.status === 'invalid') {
            log.audit({ title: title('DESIGNINFO_STATE_INVALID'), details: 'Opportunity ' + p.opp.id + ': ' + state.detail +
                '; treated as empty and replaced by a fresh state with "requested"' });
        }
        state.state.requested = new Date().toISOString();
        state.state.rq = rq;
        try {
            data.writeDesignInfo(p.opp.id, {}, designinfo.stateTextGuarded(state.state).text);
        } catch (e2) {
            log.error({ title: title('DESIGNINFO_STATE_FAILED'), details: 'Opportunity ' + p.opp.id + ': the email WAS sent; ' +
                '"requested" not recorded (' + message(e2) + ')' });
        }

        log.audit({ title: title('DESIGNINFO_REQUESTED'), details: 'Opportunity ' + p.opp.id + ' (' + p.opp.tranId +
            '), customer ' + p.opp.customerId + ', to ' + p.recipient + ', from employee ' + emp.id + ' (' + p.sender.source +
            '), asking about: ' + asked.map(function (st) { return st.title; }).join(', ') + ' (rq ' + rq.join(',') + ') (v' +
            VERSION + ')' });
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
        var notice;

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
        // 1.1.0: "Update and recheck" writes the facts and redraws the page; Send is the form's own submit.
        if (params[FIELD_RECHECK]) {
            notice = recheck(p, params);
            try {
                p = prepare(oppId, cfg);
            } catch (e3) {
                log.error({ title: title('DESIGNINFO_REQUEST_FAILED'), details: 'Opportunity ' + oppId + ': ' + message(e3) });
                showMessage(context.response, oppId, 'something went wrong (CDB DESIGNINFO_REQUEST_FAILED)');
                return;
            }
            if (!p.ok) {
                refuse(context.response, oppId, p.reason);
                return;
            }
            confirmPage(context.response, p, notice);
            return;
        }
        back(oppId, sendFor(p, cfg, params));
    }

    return { onRequest: onRequest };
});
