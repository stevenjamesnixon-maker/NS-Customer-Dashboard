/**
 * cdb_mr_link_backfill.js
 *
 * Writes custentity_cdb_link — each customer's base dashboard link — wherever it is missing or wrong
 * ("Request an update" part A, 2 Oct 2026). Rerunnable: a run over customers whose links are already
 * right writes nothing.
 *
 * RUN IT (docs/context.md, "The stored link"):
 *   - once at go-live, after the customer User Event is deployed;
 *   - after EVERY Sandbox refresh: the refresh copies Production's links into Sandbox, and the User Event
 *     cannot tell (the stored payload is right, the domain is not);
 *   - after any change to the API Secret's value or to the dashboard deployment (or its domain).
 *
 * INPUT (getInputData), by the record-only setting LINK_BACKFILL_SCOPE:
 *   OPEN  (the default, and what an empty or invalid row means) the customers with an open opportunity
 *         or an open sales order — the digest's LIVE definition, the same two searches
 *         (cdb_lib_data customersWithOpenOpportunity / customersWithOpenOrder), so the two cannot drift.
 *         Those searches do not filter on the customer, so an inactive one is skipped in map (counted
 *         'inactive').
 *   ALL   every active customer: one customer search, isinactive F.
 * The OPEN searches need the "open" settings (WON_STATUSES, LOST_STATUSES, DESIGN_SUBSTATUS,
 * DELIVERY_SUBSTATUS, EXCLUDED_STATUSES, EXCLUDED_QUOTE_TYPES, RELEASED_STATUSES) on the settings record:
 * this script has no parameters, so a missing one stops the run at the start (CDB_PARAMETER_MISSING),
 * whatever the scope, and nothing is written.
 *
 * PER CUSTOMER (map): lib/cdb_lib_link.js ensure(), the User Event's check-and-write, with exact: true —
 * the whole built link is compared with the stored one, not just its payload, so a new secret, deployment
 * or domain, or a refreshed Sandbox, is rewritten. Governance per customer: the lookup (1) and buildLink()
 * (its lookup, 1) always; a write adds submitFields (5). Never throws: a failure is logged CDB LINK_FAILED.
 *
 * SUMMARY (summarize): CDB LINK_BACKFILL with the counts — checked, already right, written, failed,
 * inactive — and the first 10 failures.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/search', 'N/runtime', 'N/log', './lib/cdb_lib_config', './lib/cdb_lib_data', './lib/cdb_lib_link'],
    function (search, runtime, log, config, data, link) {

    'use strict';

    var VERSION = '1.0.0';

    /** How many failures summarize lists. */
    var FAILURES_LISTED = 10;

    function title(name) {
        return config.logTitle(name);
    }

    /**
     * Pure: the customer IDs of the two "open" sets, once each, in ID order.
     * @param {Object} withOpp - set of customer IDs
     * @param {Object} withOrder - set of customer IDs
     * @returns {string[]}
     */
    function unionIds(withOpp, withOrder) {
        var set = {};
        var key;
        var ids = [];
        for (key in withOpp) {
            if (withOpp.hasOwnProperty(key)) {
                set[key] = true;
            }
        }
        for (key in withOrder) {
            if (withOrder.hasOwnProperty(key)) {
                set[key] = true;
            }
        }
        for (key in set) {
            if (set.hasOwnProperty(key) && /^\d+$/.test(key)) {
                ids.push(key);
            }
        }
        return ids.sort(function (a, b) {
            return parseInt(a, 10) - parseInt(b, 10);
        });
    }

    function getInputData() {
        var cfg = config.load(log);
        var ids;

        if (cfg.LINK_BACKFILL_SCOPE === config.LINK_SCOPES.ALL) {
            log.audit({ title: title('LINK_BACKFILL_INPUT'), details: 'Scope ALL: every active customer (v' +
                VERSION + ')' });
            return search.create({
                type: search.Type.CUSTOMER,
                filters: [['isinactive', 'is', 'F']],
                columns: ['internalid']
            });
        }

        ids = unionIds(data.customersWithOpenOpportunity(cfg), data.customersWithOpenOrder(cfg));
        log.audit({ title: title('LINK_BACKFILL_INPUT'), details: 'Scope OPEN: ' + ids.length +
            ' customers with an open opportunity or an open sales order (v' + VERSION + ')' });
        return ids.map(function (id) {
            return { customerId: id };
        });
    }

    function map(context) {
        var value = JSON.parse(context.value);
        // OPEN gives { customerId }; ALL gives a search result, { id, ... }.
        var customerId = String(value.customerId || value.id || '');
        var result = link.ensure(customerId, null, { exact: true, log: log, source: 'backfill' });
        context.write({
            key: result.outcome,
            value: result.outcome === link.OUTCOMES.FAILED ? customerId + ': ' + result.error : customerId
        });
    }

    /**
     * Pure: the CDB LINK_BACKFILL line from the outcomes.
     * @param {Array<{key: string, value: string}>} outputs - map's writes
     * @param {string[]} errors - 'key: error' for each map call that threw (never expected)
     * @returns {string}
     */
    function summaryLine(outputs, errors) {
        var O = link.OUTCOMES;
        var counts = {};
        var failures = [];
        var i;
        counts[O.MATCHED] = 0;
        counts[O.WRITTEN] = 0;
        counts[O.FAILED] = 0;
        counts[O.INACTIVE] = 0;
        for (i = 0; i < outputs.length; i++) {
            counts[outputs[i].key] = (counts[outputs[i].key] || 0) + 1;
            if (outputs[i].key === O.FAILED) {
                failures.push(outputs[i].value);
            }
        }
        for (i = 0; i < errors.length; i++) {
            counts[O.FAILED] += 1;
            failures.push(errors[i]);
        }
        return 'checked ' + (outputs.length + errors.length) + '; already right ' + counts[O.MATCHED] +
            '; written ' + counts[O.WRITTEN] + '; failed ' + counts[O.FAILED] + '; inactive ' + counts[O.INACTIVE] +
            (failures.length ? '. First ' + Math.min(failures.length, FAILURES_LISTED) + ' failures: ' +
                failures.slice(0, FAILURES_LISTED).join(' | ') : '');
    }

    function summarize(summary) {
        var outputs = [];
        var errors = [];

        if (summary.inputSummary.error) {
            log.error({ title: title('LINK_BACKFILL_INPUT_FAILED'), details: summary.inputSummary.error });
        }
        summary.mapSummary.errors.iterator().each(function (k, error) {
            errors.push('key ' + k + ': ' + error);
            return true;
        });
        summary.output.iterator().each(function (k, v) {
            outputs.push({ key: k, value: v });
            return true;
        });
        log.audit({
            title: title('LINK_BACKFILL'),
            details: summaryLine(outputs, errors) + ' (v' + VERSION + ', ' +
                runtime.getCurrentScript().getRemainingUsage() + ' units remaining in summarize)'
        });
    }

    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };
});
