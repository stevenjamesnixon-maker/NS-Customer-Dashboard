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
 *   author     the customer's sales rep if active, otherwise the fallback employee. Never the
 *              current user.
 *   skip       no recipient, or nothing to show — logged at audit with the reason
 *   send       email.send with relatedRecords.entityId = customer, so it lands on the customer's
 *              Communication tab
 *   stamp      custentity_cdb_last_digest = today (London). THE ONLY CUSTOMER FIELD THIS REPO
 *              WRITES.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @version 1.0.1
 */
define(['N/search', 'N/record', 'N/email', 'N/runtime', 'N/log', './lib/cdb_lib_config',
    './lib/cdb_lib_token', './lib/cdb_lib_dates', './lib/cdb_lib_data', './lib/cdb_lib_render'],
    function (search, record, email, runtime, log, config, token, dates, data, render) {

    'use strict';

    var VERSION = '1.0.1';

    var CUST = config.FIELDS.CUSTOMER;
    var OPP = config.FIELDS.OPPORTUNITY;
    var SO = config.FIELDS.SALES_ORDER;

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
     * Customers with an open opportunity: not Lost, and either not Won, or Won at a design or
     * delivery sub-status. The same opportunities the dashboard shows. Grouped by customer.
     * @returns {Object} set of customer IDs
     */
    function customersWithOpenOpportunity(cfg) {
        var set = {};
        each(search.create({
            type: search.Type.OPPORTUNITY,
            // No mainline: the opportunity search rejects it. See cdb_lib_data.getOpportunities().
            filters: [
                [OPP.STATUS, 'noneof', cfg.LOST_STATUSES], 'AND',
                [[OPP.STATUS, 'noneof', cfg.WON_STATUSES], 'OR',
                    [OPP.SUB_STATUS, 'anyof', cfg.DESIGN_SUBSTATUS.concat(cfg.DELIVERY_SUBSTATUS)]]
            ],
            columns: [search.createColumn({ name: 'entity', summary: search.Summary.GROUP })]
        }), function (r) {
            set[String(r.getValue({ name: 'entity', summary: search.Summary.GROUP }))] = true;
        });
        return set;
    }

    /**
     * Customers with an open sales order: every rule of "open" (cdb_lib_data.js header),
     * including the addendum's native status filter. Grouped by the order's own customer.
     * @returns {Object} set of customer IDs
     */
    function customersWithOpenOrder(cfg) {
        var set = {};
        each(search.create({
            type: search.Type.SALES_ORDER,
            filters: data.openOrderFilters().concat([
                'AND', [[SO.RECORD_STATUS, 'anyof', '@NONE@'], 'OR',
                    [SO.RECORD_STATUS, 'noneof', cfg.EXCLUDED_STATUSES]],
                'AND', [[SO.QUOTE_TYPE, 'anyof', '@NONE@'], 'OR',
                    [SO.QUOTE_TYPE, 'noneof', cfg.EXCLUDED_QUOTE_TYPES]]
            ]),
            columns: [search.createColumn({ name: 'entity', summary: search.Summary.GROUP })]
        }), function (r) {
            set[String(r.getValue({ name: 'entity', summary: search.Summary.GROUP }))] = true;
        });
        return set;
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

    function getInputData() {
        var cfg = config.load(log);
        var todayKey = dates.londonTodayKey(Date.now());
        var withOpp;
        var withOrder;
        var eligible;
        var chosen = [];
        var i;

        if (cfg.DIGEST_MODE === config.DIGEST_MODES.TEST) {
            log.audit({ title: title('DIGEST_INPUT'), details: 'TEST mode: customers ' +
                cfg.DIGEST_TEST_CUSTOMERS.join(', ') + ' (v' + VERSION + ')' });
            return cfg.DIGEST_TEST_CUSTOMERS.map(function (id) {
                return { customerId: id };
            });
        }

        withOpp = customersWithOpenOpportunity(cfg);
        withOrder = customersWithOpenOrder(cfg);
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
            return { customerId: row.customerId };
        });
    }

    /**
     * The sales rep if active, otherwise the fallback employee.
     */
    function author(customer, cfg) {
        var rep = customer.salesRep ? data.getEmployee(customer.salesRep) : null;
        if (rep && !rep.isInactive) {
            return rep;
        }
        return data.getEmployee(String(cfg.FALLBACK_EMPLOYEE)) ||
            { id: String(cfg.FALLBACK_EMPLOYEE), name: '', phone: '', email: '' };
    }

    function skip(context, customerId, reason) {
        log.audit({ title: title('DIGEST_SKIPPED'), details: 'Customer ' + customerId + ': ' + reason });
        context.write({ key: OUTCOME.SKIPPED_PREFIX + reason, value: customerId });
    }

    function map(context) {
        var cfg = config.load(log, true);
        var customerId = String(JSON.parse(context.value).customerId);
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
            recipient = data.getContactEmail(customer.dashboardContact) || customer.email;
            if (!recipient) {
                skip(context, customerId, 'no recipient email');
                return;
            }
            groups = data.getProjects(customerId, cfg);
            if (groups.isEmpty) {
                skip(context, customerId, 'nothing to show');
                return;
            }
            from = author(customer, cfg);

            body = render.digestEmail({
                customerName: customer.name,
                logoUrl: cfg.LOGO_URL,
                rows: render.digestRows(groups, cfg.PAY_BACS),
                anyReady: groups.anyReady,
                link: token.buildLink(customerId),
                am: from,
                digestDays: cfg.DIGEST_DAYS
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
