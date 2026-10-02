/**
 * cdb_lib_link.js
 *
 * The customer's stored dashboard link, custentity_cdb_link: check it, and write it when it is wrong.
 * The ONE place it is written. cdb_ue_customer.js (every customer save) and cdb_mr_link_backfill.js (the
 * rerunnable backfill) both call ensure(), so the two cannot drift. ("Request an update" part A,
 * 2 Oct 2026.)
 *
 * WHAT IS STORED. token.buildLink(customerId) with no extra: the BASE dashboard link, no a=. Online-quote's
 * Update Opportunity page reads it and appends &a=update&opp=<id> (see cdb_lib_token.js, EXTERNAL
 * CONSUMER). The link is deterministic (c<id>.v<version>, stable, no expiry), so it only goes out of date
 * when the customer's link version changes, the API Secret's value changes, the dashboard deployment or
 * domain changes, or the account is a refreshed Sandbox.
 *
 * TWO CHECKS. ensure(customerId, state, { exact: false }) — the User Event's — is token.linkMatches(): pure,
 * no crypto, no lookup, so a save whose link is already right costs nothing. It sees a version change
 * (revocation: incrementing custentity_cdb_link_version rewrites the link on the same save), another
 * customer's link (a copied customer) and an empty link. It CANNOT see a new secret, a new deployment or
 * domain, or a Sandbox refresh: the payload is unchanged. ensure(..., { exact: true }) — the backfill's —
 * builds the link and compares the whole URL, so it sees those too. That is why the backfill is run after
 * each of them (docs/context.md, "The stored link").
 *
 * THE WRITE is one record.submitFields of custentity_cdb_link only, with enableSourcing: false and
 * ignoreMandatoryFields: true. NetSuite does not run user events for a save made by a user event, and the
 * next check would find a match anyway, so it never loops.
 *
 * NEVER THROWS. Any failure — the customer not found, buildLink(), submitFields() — is the outcome
 * 'failed' with the reason, logged CDB LINK_FAILED (error). A write logs CDB LINK_WRITTEN (audit) with the
 * customer, the version signed and the governance units the write used.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/search', 'N/record', 'N/runtime', './cdb_lib_config', './cdb_lib_token'],
    function (search, record, runtime, config, token) {

    'use strict';

    var VERSION = '1.0.0';

    var CUST = config.FIELDS.CUSTOMER;

    /** What ensure() did. The backfill's summarize counts these. */
    var OUTCOMES = {
        INACTIVE: 'inactive',
        MATCHED: 'already right',
        WRITTEN: 'written',
        FAILED: 'failed'
    };

    function trim(value) {
        return String(value === null || value === undefined ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    function isTicked(value) {
        return value === true || value === 'T';
    }

    function message(e) {
        return e && e.message ? e.message : String(e);
    }

    /**
     * Pure: the state ensure() needs, from a record or a lookupFields result.
     * @param {function(string): *} get - returns a field's raw value
     * @returns {{isInactive: boolean, version: number, link: string}}
     */
    function stateFrom(get) {
        return {
            isInactive: isTicked(get('isinactive')),
            version: token.normaliseVersion(get(CUST.LINK_VERSION)),
            link: trim(get(CUST.LINK))
        };
    }

    /**
     * The state from a record (the User Event's newRecord on create and edit). No governance.
     * @param {Object} rec
     * @returns {{isInactive: boolean, version: number, link: string}}
     */
    function stateFromRecord(rec) {
        return stateFrom(function (fieldId) {
            return rec.getValue({ fieldId: fieldId });
        });
    }

    /**
     * The state from the database: ONE lookupFields (1 unit). Throws when the customer is not found.
     * @param {string} customerId
     * @returns {{isInactive: boolean, version: number, link: string}}
     */
    function readState(customerId) {
        var result = search.lookupFields({
            type: search.Type.CUSTOMER,
            id: customerId,
            columns: ['isinactive', CUST.LINK_VERSION, CUST.LINK]
        });
        return stateFrom(function (fieldId) {
            return result ? result[fieldId] : '';
        });
    }

    function usage() {
        try {
            return runtime.getCurrentScript().getRemainingUsage();
        } catch (e) {
            return null;
        }
    }

    /**
     * Checks the customer's stored link and writes it when it is wrong. Never throws.
     *
     * @param {string|number} customerId
     * @param {{isInactive: boolean, version: number, link: string}|null} state - null: readState() (1 unit)
     * @param {Object} options
     * @param {boolean} [options.exact] - compare the whole built link (the backfill), not just the payload
     * @param {Object} options.log - N/log
     * @param {string} options.source - who called, for the log ('User Event (edit)', 'backfill')
     * @returns {{outcome: string, version: (number|null), error: string}}
     */
    function ensure(customerId, state, options) {
        var id = trim(customerId);
        var before = usage();
        var link;
        var parts;
        var parsed;
        var values = {};
        var after;

        try {
            if (!/^\d+$/.test(id)) {
                throw new Error('not a customer ID: "' + id + '"');
            }
            if (!state) {
                state = readState(id);
            }
            if (state.isInactive) {
                return { outcome: OUTCOMES.INACTIVE, version: state.version, error: '' };
            }
            if (!options.exact && token.linkMatches(state.link, id, state.version)) {
                return { outcome: OUTCOMES.MATCHED, version: state.version, error: '' };
            }
            link = trim(token.buildLink(id));
            if (!/^https:\/\//i.test(link)) {
                throw new Error('buildLink gave no https link: "' + link + '"');
            }
            if (options.exact && link === state.link) {
                return { outcome: OUTCOMES.MATCHED, version: state.version, error: '' };
            }
            parts = token.splitToken(token.tokenFromLink(link));
            parsed = parts ? token.parsePayload(parts.payload) : null;
            values[CUST.LINK] = link;
            record.submitFields({
                type: record.Type.CUSTOMER,
                id: id,
                values: values,
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
            after = usage();
            options.log.audit({
                title: config.logTitle('LINK_WRITTEN'),
                details: 'Customer ' + id + ' v' + (parsed ? parsed.version : '?') + ' (' + options.source +
                    '); the stored link was ' + describe(state.link) +
                    (before !== null && after !== null ? '; ' + (before - after) + ' units' : '') +
                    ' (lib v' + VERSION + ')'
            });
            return { outcome: OUTCOMES.WRITTEN, version: parsed ? parsed.version : null, error: '' };
        } catch (e) {
            try {
                options.log.error({
                    title: config.logTitle('LINK_FAILED'),
                    details: 'Customer ' + id + ' (' + options.source + '): ' + message(e) + ' (lib v' + VERSION + ')'
                });
            } catch (ignore) {
                // The log itself failed: the outcome still says why.
            }
            return { outcome: OUTCOMES.FAILED, version: null, error: message(e) };
        }
    }

    /**
     * Pure: what a stored link was, for the log: 'empty', its payload ('c123.v2'), or 'unreadable'.
     * The payload names no more than the log line already does; the signature is never logged.
     */
    function describe(link) {
        var parts;
        if (!link) {
            return 'empty';
        }
        parts = token.splitToken(token.tokenFromLink(link));
        return parts && token.parsePayload(parts.payload) ? parts.payload : 'unreadable';
    }

    return {
        VERSION: VERSION,
        OUTCOMES: OUTCOMES,
        describe: describe,
        stateFrom: stateFrom,
        stateFromRecord: stateFromRecord,
        readState: readState,
        ensure: ensure
    };
});
