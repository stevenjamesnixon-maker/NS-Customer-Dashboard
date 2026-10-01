/**
 * cdb_lib_config.js
 *
 * Every script ID, field ID and script parameter of the customer dashboard, and what an empty
 * parameter means. Both scripts read their configuration through load(); neither reads a
 * parameter directly.
 *
 * NO NUMERIC INTERNAL IDS. List values, statuses, employees and quote types all differ between
 * Sandbox and Production, so they come from script parameters. Script and field IDs are the same
 * in every account and are committed here. See docs/context.md section 3.
 *
 * PARAMETER IDS DIFFER BY SCRIPT. A script parameter is a custom field, and custom field IDs are
 * unique across the account, so the Map/Reduce cannot define a parameter with the Suitelet's ID.
 * (NS-Opportunity-SO-Sync tried it and NetSuite refused.) The Map/Reduce therefore carries twins
 * prefixed custscript_cdbmr_ that must hold the SAME value as their custscript_cdb_ original.
 * PARAMETERS below names both, explicitly, per script: no derivation and no fallback, because a
 * fallback reads the wrong script's value and hides the misconfiguration. See docs/context.md
 * section 4.
 *
 * load() THROWS ONCE and names every missing parameter, so a half-configured deployment fails with
 * one clear message instead of a trail of confusing ones.
 *
 * The pure part, readParameters(), takes a getter and is node-tested.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.2.0
 */
define(['N/runtime'], function (runtime) {

    'use strict';

    var VERSION = '1.2.0';

    /** Every log title starts with this. One string to grep the execution log for. */
    var LOG_PREFIX = 'CDB ';

    var SCRIPTS = {
        SUITELET: 'customscript_cdb_sl_dashboard',
        SUITELET_DEPLOYMENT: 'customdeploy_cdb_sl_dashboard',
        DIGEST: 'customscript_cdb_mr_digest',
        DIGEST_DEPLOYMENT: 'customdeploy_cdb_mr_digest'
    };

    /** The API Secret. Restricted in the account to the two scripts above, never by employee. */
    var SECRET_ID = 'custsecret_cdb_link_key';

    var RECORD_TYPES = {
        NON_DELIVERY: 'customrecord_cdb_nondelivery',
        LIST_TIME: 'customlist_del_time_per',
        LIST_VEHICLE: 'customlist_delivery_veh',
        LIST_UNLOAD: 'customlist_unload_req'
    };

    /**
     * Field IDs, grouped by the record that OWNS them. custbody_ says nothing about which
     * transaction a field is on, so the record is the point of this table.
     * custbody_opp_site_adress is spelt with one d in the account. It is the real ID: do not fix it.
     */
    var FIELDS = {
        CUSTOMER: {
            LINK_VERSION: 'custentity_cdb_link_version',
            DASHBOARD_CONTACT: 'custentity_cdb_dashboard_contact',
            DIGEST_OPTOUT: 'custentity_cdb_digest_optout',
            LAST_DIGEST: 'custentity_cdb_last_digest'
        },
        OPPORTUNITY: {
            STATUS: 'entitystatus',
            SUB_STATUS: 'custbody_opportunity_sub_status',
            SITE_ADDRESS: 'custbody_opp_site_adress',
            PE: 'custbody_pe',
            VALUE_PROPOSITION: 'custbody_value_proposition'
        },
        SALES_ORDER: {
            OPPORTUNITY: 'opportunity',
            RECORD_STATUS: 'custbody_finance_status',
            QUOTE_TYPE: 'custbody_quote_type',
            CONFIRMED_DATE: 'custbody_del_date',
            READY: 'custbody_ready_for_delivery',
            HOLD_REASON: 'custbody_delivery_hold_reason',
            SHIP_DATE: 'custbody_defaultshipdate',
            TIME: 'custbody_del_time_per',
            VEHICLE: 'custbody_delivery_veh',
            UNLOAD: 'custbody_unload_req',
            CONTACT_NAME: 'custbody_del_contact',
            CONTACT_PHONE: 'custbody_delivery_con_num',
            CONTACT_EMAIL: 'custbody_delivery_con_email',
            SPECIAL_REQUESTS: 'custbody_special_requests',
            PAY_INTENT: 'custbody_cust_pay_intent',
            BOOKING_REQUESTED: 'custbody_cust_booking_req',
            SHIP_ADDRESS: 'shipaddresslist',
            // 1.1. Optional on the loaded record: written only when so.getField() finds them.
            AWAITING_PAYMENT: 'custbody_cdb_awaiting_payment',
            EDD_CERTAINTY: 'custbody_edd_certainty',
            // 1.2. Read ONLY by cdb_lib_data.getOrderExtras(), a separate fail-safe search. Never add
            // these to the main order searches: a field that does not apply to sales orders makes
            // the whole search throw. custbodycustbody_sys_bal_incvat has a DOUBLED PREFIX in the
            // account. It is the real ID: do not "fix" it.
            TERMS: 'terms',
            UNIQUE_REF: 'custbody_unique_so_ref',
            BALANCE: 'custbodycustbody_sys_bal_incvat',
            TOTAL: 'total',
            DEPOSIT: 'custbody_deposit_total'
        },
        /**
         * Read from the sales order's ORIGINATING QUOTE through the createdFrom join. Confirmed
         * on the Estimate only: never add it as an unjoined sales order column, which can make
         * the whole search throw if the field does not apply to sales orders.
         */
        QUOTE: {
            JOIN: 'createdFrom',
            DESCRIPTION: 'custbody_quote_description'
        },
        NON_DELIVERY: {
            DATE: 'custrecord_cdb_nd_date'
        }
    };

    /**
     * The native sales order statuses that can still ship (addendum of 30 Sep). An order counts
     * only if its native status is one of these, IN ADDITION to the Record Status rule.
     * Standard NetSuite status codes, the same in every account, so they belong in code. They
     * match the input filter of opsync_mr_readiness.js in NS-Opportunity-SO-Sync (PR #8).
     *
     *   SalesOrd:A  Pending Approval
     *   SalesOrd:B  Pending Fulfillment
     *   SalesOrd:D  Partially Fulfilled
     *   SalesOrd:E  Pending Billing/Partially Fulfilled
     *
     * Left out deliberately: C Cancelled, F Pending Billing, G Billed, H Closed.
     *
     * These codes are FILTER values. A search result's status column does not return them, so
     * never compare a column value against this list; filter with it.
     */
    var SHIPPABLE_STATUSES = ['SalesOrd:A', 'SalesOrd:B', 'SalesOrd:D', 'SalesOrd:E'];

    var TEXT_LIMITS = {
        CONTACT_NAME: 100,
        CONTACT_PHONE: 40,
        CONTACT_EMAIL: 254,
        SPECIAL_REQUESTS: 1000
    };

    /** How far ahead a delivery can be booked. */
    var BOOKING_HORIZON_MONTHS = 6;

    var DIGEST_MODES = { TEST: 'TEST', LIVE: 'LIVE' };

    /**
     * The guidance above the vehicle and unloading options (release 1.1). Customer-facing wording,
     * so it lives here rather than in the render code. Each paragraph is [bold lead, rest]; both
     * parts are escaped when rendered.
     */
    var DELIVERY_GUIDANCE = [
        ['Most deliveries come on an articulated lorry, up to 16 m long and 4 m tall.',
            ' If there are narrow lanes, low branches, tight turns or narrow gates on the way, ' +
            'choose a smaller vehicle and we\u2019ll arrange it.'],
        ['Unloading:',
            ' the driver unloads at the nearest flat, level, hard surface, such as the kerbside ' +
            'or a driveway, and can\u2019t move it further. Please have people on site to help ' +
            'carry everything into dry storage. Pallets can weigh up to 1,250 kg.']
    ];

    /**
     * Parameter kinds:
     *   idlist  comma list of whole numbers -> string[]
     *   id      one whole number (Integer, or a List/Record select) -> string
     *   int     whole number >= 0 -> number
     *   mode    TEST | LIVE
     *   https   an https URL
     *   text    free text
     *
     * empty:
     *   throw    missing -> named in the one error load() throws
     *   default  missing or invalid -> the default, logged at audit
     *   none     missing -> the empty value, logged at audit
     *
     * ids: the parameter's ID on each script. A key a script does not list is not available to
     * it, and asking for it is a programming error, not an empty parameter.
     */
    var PARAMETERS = {
        WON_STATUSES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_won_statuses', MR: 'custscript_cdbmr_won_statuses' } },
        LOST_STATUSES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_lost_statuses', MR: 'custscript_cdbmr_lost_statuses' } },
        DESIGN_SUBSTATUS: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_design_substatus', MR: 'custscript_cdbmr_design_substatus' } },
        NEEDINFO_SUBSTATUS: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_needinfo_substatus', MR: 'custscript_cdbmr_needinfo_substatus' } },
        DELIVERY_SUBSTATUS: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_delivery_substatus', MR: 'custscript_cdbmr_delivery_substatus' } },
        EXCLUDED_STATUSES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_excluded_statuses', MR: 'custscript_cdbmr_excluded_statuses' } },
        EXCLUDED_QUOTE_TYPES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_excluded_quote_types', MR: 'custscript_cdbmr_excluded_quote_types' } },
        PAY_BACS: { kind: 'id', empty: 'throw',
            ids: { SL: 'custscript_cdb_pay_bacs', MR: 'custscript_cdbmr_pay_bacs' } },
        PAY_CARD: { kind: 'id', empty: 'throw',
            ids: { SL: 'custscript_cdb_pay_card', MR: 'custscript_cdbmr_pay_card' } },
        FALLBACK_EMPLOYEE: { kind: 'id', empty: 'throw',
            ids: { SL: 'custscript_cdb_fallback_employee', MR: 'custscript_cdbmr_fallback_employee' } },
        // 1.2. Pay up front vs account. Empty prepay terms -> everyone pays up front; empty account
        // value -> the account option is never offered. Both fail closed: they offer less.
        // Suitelet only: nothing in the digest reads it (amendment 1).
        PREPAY_TERMS: { kind: 'idlist', empty: 'none', ids: { SL: 'custscript_cdb_prepay_terms' } },
        PAY_ACCOUNT: { kind: 'id', empty: 'none',
            ids: { SL: 'custscript_cdb_pay_account', MR: 'custscript_cdbmr_pay_account' } },
        // 1.2. JSON {"<quote type id>": "UFH", ...}. Parsed by parseTypeLabels(); never fails the page.
        QUOTE_TYPE_LABELS: { kind: 'text', empty: 'none',
            ids: { SL: 'custscript_cdb_quote_type_labels', MR: 'custscript_cdbmr_quote_type_labels' } },
        LOGO_URL: { kind: 'https', empty: 'none',
            ids: { SL: 'custscript_cdb_logo_url', MR: 'custscript_cdbmr_logo_url' } },

        TIME_VALUES: { kind: 'idlist', empty: 'throw', ids: { SL: 'custscript_cdb_time_values' } },
        VEHICLE_VALUES: { kind: 'idlist', empty: 'throw', ids: { SL: 'custscript_cdb_vehicle_values' } },
        UNLOAD_VALUES: { kind: 'idlist', empty: 'throw', ids: { SL: 'custscript_cdb_unload_values' } },
        PE_VALUEPROPS: { kind: 'idlist', empty: 'none', ids: { SL: 'custscript_cdb_pe_valueprops' } },
        NOTICE_DAYS: { kind: 'int', empty: 'default', defaultValue: 3,
            ids: { SL: 'custscript_cdb_notice_days' } },
        BANK_NAME: { kind: 'text', empty: 'throw', ids: { SL: 'custscript_cdb_bank_name' } },
        BANK_SORT: { kind: 'text', empty: 'throw', ids: { SL: 'custscript_cdb_bank_sort' } },
        BANK_ACCOUNT: { kind: 'text', empty: 'throw', ids: { SL: 'custscript_cdb_bank_account' } },
        // 1.1. JSON hints for the vehicle and unloading option cards. Parsed by parseOptionHints();
        // a bad value never fails the page.
        OPTION_HINTS: { kind: 'text', empty: 'none', ids: { SL: 'custscript_cdb_option_hints' } },
        // 1.1. The customlist955 ID for "Customer Definite". Empty writes nothing (fails closed).
        EDD_DEFINITE: { kind: 'id', empty: 'none', ids: { SL: 'custscript_cdb_edd_definite_value' } },

        DIGEST_MODE: { kind: 'mode', empty: 'throw', ids: { MR: 'custscript_cdb_digest_mode' } },
        DIGEST_TEST_CUSTOMERS: { kind: 'idlist', empty: 'throw', onlyInTestMode: true,
            ids: { MR: 'custscript_cdb_digest_test_customers' } },
        DIGEST_DAYS: { kind: 'int', empty: 'default', defaultValue: 14,
            ids: { MR: 'custscript_cdb_digest_days' } },
        DIGEST_CAP: { kind: 'int', empty: 'default', defaultValue: 200,
            ids: { MR: 'custscript_cdb_digest_cap' } }
    };

    /** Which PARAMETERS column each script reads. */
    var SCRIPT_KEYS = {};
    SCRIPT_KEYS[SCRIPTS.SUITELET] = 'SL';
    SCRIPT_KEYS[SCRIPTS.DIGEST] = 'MR';

    /**
     * @param {*} value
     * @returns {boolean} true for null, undefined, '' and whitespace
     */
    function isBlank(value) {
        return value === null || value === undefined || String(value).replace(/^\s+|\s+$/g, '') === '';
    }

    /**
     * @param {string} raw
     * @returns {string[]|null} whole-number IDs, or null when any entry is not a whole number
     */
    function parseIdList(raw) {
        var parts = String(raw).split(',');
        var result = [];
        var i;
        var part;
        for (i = 0; i < parts.length; i++) {
            part = parts[i].replace(/^\s+|\s+$/g, '');
            if (part === '') {
                continue;
            }
            if (!/^\d+$/.test(part)) {
                return null;
            }
            result.push(String(parseInt(part, 10)));
        }
        return result.length ? result : null;
    }

    /**
     * Parses one raw value by kind.
     * @returns {{ok: boolean, value: *}}
     */
    function parseValue(kind, raw) {
        var text = String(raw).replace(/^\s+|\s+$/g, '');
        var list;
        switch (kind) {
            case 'idlist':
                list = parseIdList(text);
                return { ok: list !== null, value: list };
            case 'id':
                return { ok: /^\d+$/.test(text), value: text };
            case 'int':
                return { ok: /^\d+$/.test(text), value: parseInt(text, 10) };
            case 'mode':
                text = text.toUpperCase();
                return { ok: text === DIGEST_MODES.TEST || text === DIGEST_MODES.LIVE, value: text };
            case 'https':
                return { ok: /^https:\/\/[^\s"'<>]+$/i.test(text), value: text };
            default:
                return { ok: true, value: text };
        }
    }

    /**
     * The empty value of a kind, used for 'none'.
     */
    function emptyValue(kind) {
        return kind === 'idlist' ? [] : '';
    }

    /**
     * Pure: reads and validates every parameter for one script column.
     *
     * @param {function(string): *} getParameter - returns the raw value for a parameter ID
     * @param {string} column - 'SL' or 'MR'
     * @returns {{config: Object, missing: string[], notes: string[]}}
     *   config  keyed by logical key
     *   missing parameter IDs that are empty (or invalid) where empty means throw
     *   notes   audit lines for defaults and 'none' values
     */
    function readParameters(getParameter, column) {
        var config = {};
        var missing = [];
        var notes = [];
        var deferred = [];
        var key;
        var def;
        var id;
        var raw;
        var parsed;
        var i;

        for (key in PARAMETERS) {
            if (!PARAMETERS.hasOwnProperty(key)) {
                continue;
            }
            def = PARAMETERS[key];
            id = def.ids[column];
            if (!id) {
                continue;
            }
            if (def.onlyInTestMode) {
                deferred.push(key);
                continue;
            }
            raw = getParameter(id);
            parsed = isBlank(raw) ? null : parseValue(def.kind, raw);

            if (parsed && parsed.ok) {
                config[key] = parsed.value;
                continue;
            }
            if (def.empty === 'throw') {
                missing.push(id + (parsed ? ' (invalid value "' + String(raw) + '")' : ''));
            } else if (def.empty === 'default') {
                config[key] = def.defaultValue;
                notes.push(id + (parsed ? ' is invalid ("' + String(raw) + '")' : ' is empty') +
                    ': using the default ' + def.defaultValue);
            } else {
                config[key] = emptyValue(def.kind);
                notes.push(id + (parsed ? ' is invalid ("' + String(raw) + '")' : ' is empty') +
                    ': treated as none');
            }
        }

        // Parameters that only matter in one digest mode.
        for (i = 0; i < deferred.length; i++) {
            key = deferred[i];
            def = PARAMETERS[key];
            id = def.ids[column];
            if (config.DIGEST_MODE !== DIGEST_MODES.TEST) {
                config[key] = emptyValue(def.kind);
                continue;
            }
            raw = getParameter(id);
            parsed = isBlank(raw) ? null : parseValue(def.kind, raw);
            if (parsed && parsed.ok) {
                config[key] = parsed.value;
            } else {
                missing.push(id + (parsed ? ' (invalid value "' + String(raw) + '")' : '') +
                    ' (required when the digest mode is TEST)');
            }
        }

        return { config: config, missing: missing, notes: notes };
    }

    /**
     * Pure: parses a JSON object parameter. Never throws.
     * @returns {{status: string, value: Object|null, detail: string}} status 'empty' | 'ok' | 'invalid'
     */
    function parseJsonObject(raw) {
        var parsed;
        if (isBlank(raw)) {
            return { status: 'empty', value: null, detail: '' };
        }
        try {
            parsed = JSON.parse(String(raw));
        } catch (e) {
            return { status: 'invalid', value: null, detail: 'not JSON: ' + (e && e.message ? e.message : String(e)) };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { status: 'invalid', value: null, detail: 'not a JSON object' };
        }
        return { status: 'ok', value: parsed, detail: '' };
    }

    /**
     * Pure: the usable entries of an {"<id>": "<text>"} object — whole-number keys with non-empty
     * string values. Anything else is ignored, not an error.
     * @returns {Object|null} null when obj is not an object
     */
    function idTextMap(obj) {
        var map = {};
        var key;
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return null;
        }
        for (key in obj) {
            if (obj.hasOwnProperty(key) && /^\d+$/.test(key) && typeof obj[key] === 'string' && !isBlank(obj[key])) {
                map[key] = obj[key].replace(/^\s+|\s+$/g, '');
            }
        }
        return map;
    }

    /**
     * Pure: parses custscript_cdb_option_hints. Never throws.
     *
     *   {"vehicle": {"<id>": "<hint>", ...}, "unload": {"<id>": "<hint>", ...}}
     *
     * Either key may be missing, and any ID may be missing: that option shows its title only.
     * Entries whose key is not a whole number or whose value is not a non-empty string are
     * ignored. Anything that is not a JSON object with object-or-absent vehicle/unload is invalid.
     *
     * @param {string} raw
     * @returns {{status: string, hints: {vehicle: Object, unload: Object}, detail: string}}
     *   status 'empty' | 'ok' | 'invalid'
     */
    function parseOptionHints(raw) {
        var json = parseJsonObject(raw);
        var result = { status: json.status, hints: { vehicle: {}, unload: {} }, detail: json.detail };
        var groups = ['vehicle', 'unload'];
        var i;
        var map;

        if (json.status !== 'ok') {
            return result;
        }
        for (i = 0; i < groups.length; i++) {
            if (json.value[groups[i]] === undefined || json.value[groups[i]] === null) {
                continue;
            }
            map = idTextMap(json.value[groups[i]]);
            if (!map) {
                return { status: 'invalid', hints: { vehicle: {}, unload: {} },
                    detail: '"' + groups[i] + '" is not an object' };
            }
            result.hints[groups[i]] = map;
        }
        return result;
    }

    /**
     * Pure: parses custscript_cdb_quote_type_labels, {"<quote type id>": "UFH", ...}, with the same
     * rules as the option hints. Never throws. An unmapped type falls back to its own text.
     * @returns {{status: string, labels: Object, detail: string}}
     */
    function parseTypeLabels(raw) {
        var json = parseJsonObject(raw);
        return { status: json.status, labels: json.status === 'ok' ? idTextMap(json.value) : {},
            detail: json.detail };
    }

    /**
     * Pure: the error load() throws.
     * @param {string[]} missing
     * @returns {Error}
     */
    function missingError(missing) {
        var error = new Error('CDB_PARAMETER_MISSING: set these script parameters on the ' +
            'deployment: ' + missing.join(', '));
        error.name = 'CDB_PARAMETER_MISSING';
        return error;
    }

    /**
     * Reads the executing script's configuration.
     *
     * @param {Object} log - N/log, for the audit notes
     * @param {boolean} [quiet] - skip the default/none notes (the digest's map stage, per customer)
     * @returns {Object} config keyed by logical key
     * @throws {Error} CDB_PARAMETER_MISSING naming every missing parameter, or
     *                 CDB_UNKNOWN_SCRIPT when the executing script is not in SCRIPT_KEYS
     */
    function load(log, quiet) {
        var script = runtime.getCurrentScript();
        var column = SCRIPT_KEYS[script.id];
        var result;
        var i;

        if (!column) {
            throw new Error('CDB_UNKNOWN_SCRIPT: ' + script.id + ' is not a customer dashboard ' +
                'script. Add it to SCRIPT_KEYS and PARAMETERS in cdb_lib_config.js.');
        }

        result = readParameters(function (id) {
            return script.getParameter({ name: id });
        }, column);

        if (result.missing.length) {
            log.error({ title: LOG_PREFIX + 'PARAMETER_MISSING', details: result.missing.join(', ') });
            throw missingError(result.missing);
        }
        for (i = 0; !quiet && i < result.notes.length; i++) {
            log.audit({ title: LOG_PREFIX + 'PARAMETER_DEFAULT', details: result.notes[i] });
        }
        return result.config;
    }

    /**
     * @param {string} title - without the prefix
     * @returns {string}
     */
    function logTitle(title) {
        return LOG_PREFIX + title;
    }

    return {
        VERSION: VERSION,
        LOG_PREFIX: LOG_PREFIX,
        SCRIPTS: SCRIPTS,
        SECRET_ID: SECRET_ID,
        RECORD_TYPES: RECORD_TYPES,
        FIELDS: FIELDS,
        SHIPPABLE_STATUSES: SHIPPABLE_STATUSES,
        TEXT_LIMITS: TEXT_LIMITS,
        BOOKING_HORIZON_MONTHS: BOOKING_HORIZON_MONTHS,
        DIGEST_MODES: DIGEST_MODES,
        DELIVERY_GUIDANCE: DELIVERY_GUIDANCE,
        parseOptionHints: parseOptionHints,
        parseTypeLabels: parseTypeLabels,
        PARAMETERS: PARAMETERS,
        isBlank: isBlank,
        parseIdList: parseIdList,
        readParameters: readParameters,
        missingError: missingError,
        load: load,
        logTitle: logTitle
    };
});
