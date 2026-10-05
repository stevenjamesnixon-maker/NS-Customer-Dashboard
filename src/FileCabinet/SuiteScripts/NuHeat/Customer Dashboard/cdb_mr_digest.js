/**
 * cdb_mr_digest.js
 *
 * The digest: every <digest_days> days, one email per customer with an open project or order,
 * showing the same sections as the dashboard and one button to it.
 *
 * MODES (custscript_cdb_digest_mode, required):
 *   TEST  exactly the customers in custscript_cdb_digest_test_customers, whatever else applies:
 *         no opt-out, last-digest or cap check. Required in TEST; the run throws without it.
 *   LIVE  customers with an open opportunity or an open sales order, not opted out, whose last
 *         digest is empty or at least digest_days old, and who have a recipient email. Oldest
 *         last digest first (never sent counts as oldest); digest_cap per run; the remainder is
 *         logged and picked up by the next run.
 *
 * FAILS AT THE START. getInputData loads the configuration first; a missing parameter throws
 * there, naming every missing one, and nothing is sent.
 *
 * PER CUSTOMER (map):
 *   recipient  the dashboard contact's email, otherwise the customer's email
 *              (data.emailRecipient(), 2.0: shared with the Send delivery link email)
 *   author     the customer's sales rep if active, otherwise the fallback employee. Never the
 *              current user. (data.emailAuthor(), 2.0: moved there unchanged, and shared)
 *   skip       no recipient, or nothing to show — logged at audit with the reason
 *   extras     1.2: data.getOrderExtras() once per customer (fail-safe) for the split reference;
 *              the short type labels come from custscript_cdbmr_quote_type_labels. No amounts.
 *   body       render.digestEmail(): the Email artboard of docs/design/canvas/ (1.1), in the customer
 *              email standard (2.0.2: Send Quote 2.2.0's card, footer and robustness rules). The AM
 *              card is the author, with firstname and photo from the same lookup (data.emailAm(),
 *              CDB AM_PHOTO once per email). 2.0.3: the v2 design (EmailDigestV2.dc.html): summary
 *              tiles, the ready orders each with its own direct delivery link (at most 3), one card
 *              per project with a progress bar
 *   send       email.send with relatedRecords.entityId = customer, so it lands on the customer's
 *              Communication tab
 *   stamp      custentity_cdb_last_digest = today (London). The only customer field THE DIGEST
 *              writes. (2.0.4: not the only one this repo writes: custentity_cdb_link, the customer's
 *              base dashboard link, is written by cdb_ue_customer.js and cdb_mr_link_backfill.js
 *              through lib/cdb_lib_link.js; and the dashboard adds address book lines, 2.2.)
 *
 * 2.0.4: the LIVE input's two "open customer" searches moved, unchanged, to cdb_lib_data.js
 * (customersWithOpenOpportunity, customersWithOpenOrder), shared with the link backfill.
 *
 * 2.1.0 (release 2.3): the design cards' four states, as on the dashboard (data.decorateDesign(): the fail-safe
 * extras search, once per customer with a project in design). The registry is read ONCE PER RUN, in getInputData,
 * and passed to each map value in compact form (section, title, qid, type, required, store, when); unavailable, a
 * card in progress says "Still to do: a few more details" (CDB DESIGNINFO_NO_REGISTRY, once). The card's button is the
 * customer's direct a=designinfo link, only while DESIGNINFO_REGISTRY is set.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @version 2.1.0
 */
define(['N/search', 'N/record', 'N/email', 'N/runtime', 'N/log', './lib/cdb_lib_config',
    './lib/cdb_lib_token', './lib/cdb_lib_dates', './lib/cdb_lib_data', './lib/cdb_lib_render'],
    function (search, record, email, runtime, log, config, token, dates, data, render) {

    'use strict';

    var VERSION = '2.1.0';

    var CUST = config.FIELDS.CUSTOMER;

    var SUBJECT = 'Your Nu-Heat projects: an update';

    var OUTCOME = {
        SENT: 'sent',
        FAILED: 'failed',
        SKIPPED_PREFIX: 'skipped: '
    };

    function title(name) {
        return config.logTitle(name);
    }

    /** Runs a search to completion. */
    function each(searchObj, fn) {
        var paged = searchObj.runPaged({ pageSize: 1000 });
        paged.pageRanges.forEach(function (range) {
            paged.fetch({ index: range.index }).data.forEach(fn);
        });
    }

    /**
     * Customers who may receive a digest today: active, not opted out, last digest empty or at
     * least digest_days ago, and an email to send to (their own, or a dashboard contact whose
     * email map() checks).
     * @returns {Array<{customerId: string, lastKey: string}>}
     */
    function eligibleCustomers(cfg, todayKey) {
        var rows = [];
        var cutoff = data.dateFilterValue(dates.addDays(todayKey, -cfg.DIGEST_DAYS));
        each(search.create({
            type: search.Type.CUSTOMER,
            filters: [
                ['isinactive', 'is', 'F'], 'AND',
                [CUST.DIGEST_OPTOUT, 'is', 'F'], 'AND',
                [[CUST.LAST_DIGEST, 'isempty', ''], 'OR', [CUST.LAST_DIGEST, 'onorbefore', cutoff]], 'AND',
                [['email', 'isnotempty', ''], 'OR', [CUST.DASHBOARD_CONTACT, 'noneof', '@NONE@']]
            ],
            columns: [CUST.LAST_DIGEST]
        }), function (r) {
            rows.push({ customerId: String(r.id), lastKey: data.dateKey(r.getValue(CUST.LAST_DIGEST)) });
        });
        return rows;
    }

    /**
     * Pure: oldest last digest first, never-sent first of all, then by ID so a run is repeatable.
     */
    function byOldestDigest(a, b) {
        if (a.lastKey !== b.lastKey) {
            return a.lastKey < b.lastKey ? -1 : 1;
        }
        return parseInt(a.customerId, 10) - parseInt(b.customerId, 10);
    }

    /**
     * 2.1.0: the registry, once per run, compact (what the card states need: no wording but the section titles).
     * null when it is not set or cannot be used (logged once).
     */
    function compactRegistry(cfg) {
        var reg;
        if (!cfg.DESIGNINFO_REGISTRY) {
            return null;
        }
        reg = data.loadRegistry(cfg.DESIGNINFO_REGISTRY);
        if (reg.status !== 'ok') {
            log.audit({ title: title('DESIGNINFO_NO_REGISTRY'), details: 'Digest: registry ' + reg.status + (reg.detail ? ' (' +
                reg.detail + ')' : '') + '; design cards in progress say "a few more details" this run' });
            return null;
        }
        return reg.questions.map(function (q) {
            return { section: q.section, sectionTitle: q.sectionTitle, qid: q.qid, type: q.type, required: q.required,
                store: q.store, when: q.when };
        });
    }

    /** One map input: the customer, and (2.1.0) the run's compact registry when there is one. */
    function inputValue(customerId, reg) {
        return reg ? { customerId: customerId, reg: reg } : { customerId: customerId };
    }

    function getInputData() {
        var cfg = config.load(log);
        var labels = config.parseTypeLabels(cfg.QUOTE_TYPE_LABELS);
        var reg = compactRegistry(cfg);
        var todayKey = dates.londonTodayKey(Date.now());
        var withOpp;
        var withOrder;
        var eligible;
        var chosen = [];
        var i;

        // Once per run, not once per customer: map() parses the same value quietly.
        if (labels.status === 'invalid') {
            log.audit({ title: title('TYPE_LABELS_INVALID'), details: 'custscript_cdbmr_quote_type_labels ignored: ' +
                labels.detail });
        }

        if (cfg.DIGEST_MODE === config.DIGEST_MODES.TEST) {
            log.audit({ title: title('DIGEST_INPUT'), details: 'TEST mode: customers ' +
                cfg.DIGEST_TEST_CUSTOMERS.join(', ') + ' (v' + VERSION + ')' });
            return cfg.DIGEST_TEST_CUSTOMERS.map(function (id) {
                return inputValue(id, reg);
            });
        }

        withOpp = data.customersWithOpenOpportunity(cfg);
        withOrder = data.customersWithOpenOrder(cfg);
        eligible = eligibleCustomers(cfg, todayKey);
        for (i = 0; i < eligible.length; i++) {
            if (withOpp[eligible[i].customerId] || withOrder[eligible[i].customerId]) {
                chosen.push(eligible[i]);
            }
        }
        chosen.sort(byOldestDigest);

        log.audit({
            title: title('DIGEST_INPUT'),
            details: 'LIVE mode: ' + chosen.length + ' customers due; sending to ' +
                Math.min(chosen.length, cfg.DIGEST_CAP) + ' (cap ' + cfg.DIGEST_CAP + '); ' +
                Math.max(0, chosen.length - cfg.DIGEST_CAP) + ' left over for the next run (v' + VERSION + ')'
        });
        return chosen.slice(0, cfg.DIGEST_CAP).map(function (row) {
            return inputValue(row.customerId, reg);
        });
    }

    function skip(context, customerId, reason) {
        log.audit({ title: title('DIGEST_SKIPPED'), details: 'Customer ' + customerId + ': ' + reason });
        context.write({ key: OUTCOME.SKIPPED_PREFIX + reason, value: customerId });
    }

    /** 2.1.0: the design rows' card states (one fail-safe extras search; the PE/AM's first name for "received"). */
    function decorateDesign(groups, cfg, reg, customerId, todayKey) {
        var logged = false;
        data.decorateDesign(groups, {
            extras: data.getOpportunityExtras(groups.inDesign.map(function (d) { return d.opp.id; })),
            questions: reg,
            cfg: cfg,
            todayKey: todayKey,
            firstNameOf: function (opp) {
                var e = data.getEmployee(data.resolveRecipient(opp, cfg).employeeId);
                return e && !e.isInactive ? e.firstName : '';
            },
            onStateInvalid: function (oppId, detail) {
                if (!logged) {
                    logged = true;
                    log.audit({ title: title('DESIGNINFO_STATE_INVALID'), details: 'Customer ' + customerId + ', opportunity ' +
                        oppId + ': ' + detail + '; shown as nothing received' });
                }
            }
        });
    }

    function map(context) {
        var cfg = config.load(log, true);
        var input = JSON.parse(context.value);
        var customerId = String(input.customerId);
        var todayKey = dates.londonTodayKey(Date.now());
        var customer;
        var recipient;
        var groups;
        var from;
        var body;
        var sent = false;

        try {
            customer = data.getCustomer(customerId);
            if (!customer) {
                skip(context, customerId, 'customer not found');
                return;
            }
            if (customer.isInactive) {
                skip(context, customerId, 'customer inactive');
                return;
            }
            recipient = data.emailRecipient(customer);
            if (!recipient) {
                skip(context, customerId, 'no recipient email');
                return;
            }
            groups = data.getProjects(customerId, cfg);
            // 1.3: decided BEFORE the recent search. Recent deliveries alone are not a reason to
            // email, so a customer with nothing else is skipped (and costs no further searches).
            if (groups.isEmpty) {
                skip(context, customerId, 'nothing to show');
                return;
            }
            // 1.2/1.3: the split reference and short type label from the one fail-safe extras search,
            // recent rows included. The email never shows amounts.
            data.decorateAll(groups, data.getRecentlyDelivered(customerId, data.oppIdsOf(groups), cfg, todayKey),
                config.parseTypeLabels(cfg.QUOTE_TYPE_LABELS).labels, cfg, customer.termsId, todayKey);
            // 1.3.2: the email follows the page's two delivery groups. Who gets a digest is unchanged:
            // groups.isEmpty was decided above, before this split.
            data.arrangeSections(groups);
            // 2.1.0: the four design card states.
            if (groups.inDesign.length) {
                decorateDesign(groups, cfg, input.reg || null, customerId, todayKey);
            }
            from = data.emailAuthor(customer, cfg);

            body = render.digestEmail({
                customerName: customer.name,
                greetingName: customer.greetingName,
                logoUrl: cfg.LOGO_URL,
                groups: groups,
                payBacs: cfg.PAY_BACS,
                link: token.buildLink(customerId),
                // 2.0.3: each ready order's own direct link, for the action box (at most 3 calls).
                orderLink: function (soId) {
                    return token.buildLink(customerId, { a: 'delivery', so: soId });
                },
                title: SUBJECT,
                am: data.emailAm(from, 'Digest, customer ' + customerId),
                digestDays: cfg.DIGEST_DAYS,
                // 2.1.0: a design card's button, only while the design information page can open.
                designLink: cfg.DESIGNINFO_REGISTRY ? function (oppId) {
                    return token.buildLink(customerId, { a: 'designinfo', opp: oppId });
                } : null
            });

            email.send({
                author: parseInt(from.id, 10),
                recipients: [recipient],
                subject: SUBJECT,
                body: body,
                relatedRecords: { entityId: parseInt(customerId, 10) }
            });
            sent = true;

            record.submitFields({
                type: record.Type.CUSTOMER,
                id: customerId,
                values: (function () {
                    var v = {};
                    v[CUST.LAST_DIGEST] = dates.localDateForWrite(todayKey);
                    return v;
                }()),
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });

            log.audit({
                title: title('DIGEST_SENT'),
                details: 'Customer ' + customerId + ' to ' + recipient + ' from employee ' + from.id +
                    '; last digest stamped ' + todayKey
            });
            context.write({ key: OUTCOME.SENT, value: customerId });
        } catch (e) {
            log.error({
                title: title(sent ? 'DIGEST_STAMP_FAILED' : 'DIGEST_FAILED'),
                details: 'Customer ' + customerId + (sent ?
                    ': the email WAS sent but custentity_cdb_last_digest was not stamped, so the next ' +
                    'LIVE run will send again. ' : ': ') + (e && e.message ? e.message : String(e))
            });
            context.write({ key: OUTCOME.FAILED, value: customerId });
        }
    }

    function summarize(summary) {
        var counts = {};
        var parts = [];
        var key;

        if (summary.inputSummary.error) {
            log.error({ title: title('DIGEST_INPUT_FAILED'), details: summary.inputSummary.error });
        }
        summary.mapSummary.errors.iterator().each(function (k, error) {
            log.error({ title: title('DIGEST_MAP_ERROR'), details: 'Key ' + k + ': ' + error });
            return true;
        });
        summary.output.iterator().each(function (k) {
            counts[k] = (counts[k] || 0) + 1;
            return true;
        });
        for (key in counts) {
            if (counts.hasOwnProperty(key)) {
                parts.push(key + ' ' + counts[key]);
            }
        }
        log.audit({
            title: title('DIGEST_SUMMARY'),
            details: (parts.length ? parts.join('; ') : 'nothing processed') + ' (v' + VERSION + ', ' +
                runtime.getCurrentScript().getRemainingUsage() + ' units remaining in summarize)'
        });
    }

    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };
});
