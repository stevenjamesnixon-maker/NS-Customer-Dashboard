'use strict';
/**
 * "Request an update" part A (2 Oct 2026): the customer's base dashboard link kept in custentity_cdb_link.
 * token.linkMatches(), the customer User Event, the backfill Map/Reduce, and that the digest, the dashboard
 * and the Send delivery link email are unchanged.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var UE_TYPES = { CREATE: 'create', EDIT: 'edit', XEDIT: 'xedit', DELETE: 'delete', VIEW: 'view' };

/** The in-memory NetSuite, with customer submitFields applied and lookups and grouped searches counted. */
function setup(opts) {
    var w = ns.world();
    var o = opts || {};
    var s;
    var lookup;
    var create;
    var submit;
    w.lookups = [];
    w.scriptId = o.scriptId || 'customscript_cdb_ue_customer';
    w.settings = o.settings || [];
    s = ns.stubs(w);
    lookup = s['N/search'].lookupFields;
    s['N/search'].lookupFields = function (q) {
        w.lookups.push(q);
        if (w.lookupThrows) { throw new Error('RCRD_DSNT_EXIST'); }
        return lookup(q);
    };
    // The two "open customer" searches are grouped by entity: answer them from w.openOpp / w.openOrder.
    create = s['N/search'].create;
    s['N/search'].create = function (def) {
        var col = (def.columns || [])[0];
        var ids;
        if (col && col.summary === 'GROUP' && col.name === 'entity') {
            w.searches = (w.searches || []).concat([def]);
            ids = def.type === 'opportunity' ? (w.openOpp || []) : (w.openOrder || []);
            return { runPaged: function () { return { pageRanges: [{ index: 0 }], fetch: function () {
                return { data: ids.map(function (id) { return { getValue: function () { return id; } }; }) };
            } }; } };
        }
        return create(def);
    };
    submit = s['N/record'].submitFields;
    s['N/record'].submitFields = function (q) {
        if (q.type === 'customer' && w.customers[q.id]) {
            Object.keys(q.values).forEach(function (k) { w.customers[q.id][k] = q.values[k]; });
        }
        return submit(q);
    };
    s['N/url'].resolveScript = (function (resolve) {
        return function (q) {
            if (w.urlThrows) { throw new Error('SSS_INVALID_SCRIPTLET_ID'); }
            return resolve(q);
        };
    }(s['N/url'].resolveScript));
    return { w: w, s: s };
}

function load(env, file) {
    return amd.load(file, env.s);
}

/** A real stored link for a customer and version, as buildLink() makes it. */
function linkFor(env, customerId, version) {
    var token = load(env, 'lib/cdb_lib_token');
    return token.linkForToken(token.sign(customerId, version));
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function newRecord(w, id, only) {
    return {
        id: id,
        getValue: function (f) {
            var c = w.customers[id];
            if (only && only.indexOf(f.fieldId) < 0) { return null; }
            return c[f.fieldId] === undefined ? '' : c[f.fieldId];
        }
    };
}

function runUe(env, type, id, only) {
    var ue = load(env, 'cdb_ue_customer');
    ue.afterSubmit({ type: type, UserEventType: UE_TYPES, newRecord: newRecord(env.w, id, only) });
}

function customerWrites(w) {
    return w.submits.filter(function (q) { return q.type === 'customer'; });
}

// ---------------------------------------------------------------- token.linkMatches

test('linkMatches: the right customer and version', function () {
    var env = setup();
    var token = load(env, 'lib/cdb_lib_token');
    var link = linkFor(env, 42, 3);
    assert.strictEqual(token.linkMatches(link, '42', 3), true);
    assert.strictEqual(token.linkMatches(link, 42, '3'), true);
    assert.strictEqual(token.linkMatches(linkFor(env, 42, ''), '42', ''), true, 'empty version means 0');
    assert.strictEqual(token.linkMatches(linkFor(env, 42, 0), '42', null), true);
});

test('linkMatches: the wrong customer, the wrong version', function () {
    var env = setup();
    var token = load(env, 'lib/cdb_lib_token');
    var link = linkFor(env, 42, 3);
    assert.strictEqual(token.linkMatches(link, '43', 3), false);
    assert.strictEqual(token.linkMatches(link, '420', 3), false);
    assert.strictEqual(token.linkMatches(link, '42', 4), false);
    assert.strictEqual(token.linkMatches(link, '42', ''), false);
    assert.strictEqual(token.linkMatches(link, '', 3), false);
    assert.strictEqual(token.linkMatches(link, 'abc', 3), false);
});

test('linkMatches: an empty or malformed link is false, never a throw', function () {
    var env = setup();
    var token = load(env, 'lib/cdb_lib_token');
    var payload = token.toBase64Url(token.asciiToBase64('c42.v0'));
    [null, undefined, '', '   ', 'https://x/sl', 'https://x/sl?t=', 'https://x/sl?t=abc',
        'https://x/sl?t=' + payload, 'https://x/sl?t=' + payload + '.sig.extra',
        'https://x/sl?t=' + token.toBase64Url(token.asciiToBase64('c42.vX')) + '.sig',
        'https://x/sl?t=%E0%A4%A' + payload + '.sig',
        'https://x/sl?nt=' + payload + '.sig'].forEach(function (bad) {
        assert.strictEqual(token.linkMatches(bad, '42', 0), false, String(bad));
    });
});

test('linkMatches: extra parameters (&a=update&opp=…) still parse; ns-at= is not t=', function () {
    var env = setup();
    var token = load(env, 'lib/cdb_lib_token');
    var tok = token.sign(42, 2);
    assert.strictEqual(token.linkMatches(linkFor(env, 42, 2) + '&a=update&opp=4', '42', 2), true);
    assert.strictEqual(token.linkMatches('https://acct.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=1' +
        '&deploy=1&compid=ACCT&ns-at=AAEJ7tMQ&t=' + tok + '&a=update&opp=4', '42', 2), true);
    assert.strictEqual(token.linkMatches('https://x/sl?a=update&t=' + tok + '#top', '42', 2), true);
});

test('linkMatches is pure: no crypto, no lookup', function () {
    var env = setup();
    var token = load(env, 'lib/cdb_lib_token');
    var link = linkFor(env, 42, 1);
    var crypto = env.s['N/crypto'];
    crypto.createHmac = function () { throw new Error('crypto called'); };
    crypto.createSecretKey = function () { throw new Error('crypto called'); };
    env.w.lookups.length = 0;
    // A forged signature still "matches": the check is the payload only, by design.
    assert.strictEqual(token.linkMatches(link.replace(/\.[^.]+$/, '.forged'), '42', 1), true);
    assert.strictEqual(env.w.lookups.length, 0);
});

// ---------------------------------------------------------------- the User Event

test('UE: a matching link writes nothing, costs no lookup', function () {
    var env = setup();
    env.w.customers[42].custentity_cdb_link_version = '2';
    env.w.customers[42].custentity_cdb_link = linkFor(env, 42, 2);
    env.w.lookups.length = 0;
    runUe(env, 'edit', 42);
    assert.strictEqual(customerWrites(env.w).length, 0);
    assert.strictEqual(env.w.lookups.length, 0, 'create/edit read the record');
    assert.deepStrictEqual(env.w.logs, []);
});

test('UE: an empty link is written once, custentity_cdb_link only, no sourcing, mandatory ignored', function () {
    var env = setup();
    runUe(env, 'create', 42);
    var writes = customerWrites(env.w);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(String(writes[0].id), '42');
    assert.deepStrictEqual(Object.keys(writes[0].values), ['custentity_cdb_link']);
    assert.deepStrictEqual(writes[0].options, { enableSourcing: false, ignoreMandatoryFields: true });
    var token = load(env, 'lib/cdb_lib_token');
    assert.strictEqual(writes[0].values.custentity_cdb_link, linkFor(env, 42, 0));
    assert.ok(token.linkMatches(writes[0].values.custentity_cdb_link, '42', 0));
    assert.ok(writes[0].values.custentity_cdb_link.indexOf('a=') < 0, 'the base link: no action');
    var written = logs(env.w, 'LINK_WRITTEN');
    assert.strictEqual(written.length, 1);
    assert.strictEqual(written[0][0], 'audit');
    assert.ok(/^Customer 42 v0 \(User Event \(create\)\); the stored link was empty/.test(written[0][2]), written[0][2]);
    // The UE's own write does not loop: the next pass finds a match.
    runUe(env, 'edit', 42);
    assert.strictEqual(customerWrites(env.w).length, 1);
});

test('UE: a version bump (revocation) rewrites the link on the same save', function () {
    var env = setup();
    env.w.customers[42].custentity_cdb_link_version = '1';
    env.w.customers[42].custentity_cdb_link = linkFor(env, 42, 1);
    env.w.customers[42].custentity_cdb_link_version = '2';
    runUe(env, 'edit', 42);
    var writes = customerWrites(env.w);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].values.custentity_cdb_link, linkFor(env, 42, 2));
    assert.ok(/^Customer 42 v2 .*the stored link was c42\.v1/.test(logs(env.w, 'LINK_WRITTEN')[0][2]));
});

test('UE: a copied customer\'s link (another customer\'s) is rewritten', function () {
    var env = setup();
    env.w.customers[43].custentity_cdb_link = linkFor(env, 42, 0);
    runUe(env, 'create', 43);
    assert.strictEqual(customerWrites(env.w)[0].values.custentity_cdb_link, linkFor(env, 43, 0));
});

test('UE: an inactive customer writes nothing', function () {
    var env = setup();
    env.w.customers[42].isinactive = true;
    runUe(env, 'edit', 42);
    env.w.customers[42].isinactive = 'T';
    runUe(env, 'edit', 42);
    assert.strictEqual(customerWrites(env.w).length, 0);
    assert.deepStrictEqual(env.w.logs, []);
});

test('UE: xedit reads with ONE lookupFields of the three fields', function () {
    var env = setup();
    env.w.customers[42].custentity_cdb_link_version = '5';
    env.w.customers[42].custentity_cdb_link = linkFor(env, 42, 5);
    env.w.lookups.length = 0;
    // Inline edit of the version alone: the new record carries only that field.
    runUe(env, 'xedit', 42, ['custentity_cdb_link_version']);
    assert.strictEqual(env.w.lookups.length, 1);
    assert.strictEqual(env.w.lookups[0].type, 'customer');
    assert.deepStrictEqual(env.w.lookups[0].columns, ['isinactive', 'custentity_cdb_link_version', 'custentity_cdb_link']);
    assert.strictEqual(customerWrites(env.w).length, 0, 'it matched');
    // A bump by inline edit or mass update: one lookup, then buildLink's own, then the write.
    env.w.customers[42].custentity_cdb_link_version = '6';
    env.w.lookups.length = 0;
    runUe(env, 'xedit', 42, ['custentity_cdb_link_version']);
    assert.strictEqual(customerWrites(env.w).length, 1);
    assert.strictEqual(customerWrites(env.w)[0].values.custentity_cdb_link, linkFor(env, 42, 6));
    assert.strictEqual(env.w.lookups.length, 2, 'the UE lookup and buildLink\'s');
});

test('UE: delete, view and other types do nothing', function () {
    var env = setup();
    runUe(env, 'delete', 42);
    runUe(env, 'view', 42);
    assert.strictEqual(customerWrites(env.w).length, 0);
    assert.strictEqual(env.w.lookups.length, 0);
});

test('UE: a buildLink failure is logged as CDB LINK_FAILED and never throws', function () {
    var env = setup();
    env.w.urlThrows = true;
    assert.doesNotThrow(function () { runUe(env, 'edit', 42); });
    assert.strictEqual(customerWrites(env.w).length, 0);
    var failed = logs(env.w, 'LINK_FAILED');
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(failed[0][0], 'error');
    assert.ok(/^Customer 42 \(User Event \(edit\)\): SSS_INVALID_SCRIPTLET_ID/.test(failed[0][2]), failed[0][2]);
});

test('UE: a submitFields failure is logged and never throws', function () {
    var env = setup();
    env.w.submitThrows = function (q) { return q.type === 'customer'; };
    assert.doesNotThrow(function () { runUe(env, 'create', 42); });
    assert.ok(/submitFields refused/.test(logs(env.w, 'LINK_FAILED')[0][2]));
    assert.strictEqual(logs(env.w, 'LINK_WRITTEN').length, 0);
});

test('UE: an xedit lookup failure, a bad record and a throwing log are all swallowed', function () {
    var env = setup();
    env.w.lookupThrows = true;
    assert.doesNotThrow(function () { runUe(env, 'xedit', 42, []); });
    assert.ok(/RCRD_DSNT_EXIST/.test(logs(env.w, 'LINK_FAILED')[0][2]));
    var ue = load(env, 'cdb_ue_customer');
    assert.doesNotThrow(function () {
        ue.afterSubmit({ type: 'edit', UserEventType: UE_TYPES, newRecord: { id: 42, getValue: function () {
            throw new Error('boom'); } } });
    });
    assert.ok(logs(env.w, 'LINK_FAILED').some(function (l) { return /boom/.test(l[2]); }));
    env.s['N/log'].error = function () { throw new Error('log down'); };
    env.s['N/log'].audit = function () { throw new Error('log down'); };
    ue = load(env, 'cdb_ue_customer');
    assert.doesNotThrow(function () { ue.afterSubmit(null); });
    env.w.lookupThrows = false;
    assert.doesNotThrow(function () { runUe(env, 'create', 43); });
});

// ---------------------------------------------------------------- the backfill Map/Reduce

var BACKFILL = 'customscript_cdb_mr_link_backfill';
var nextRow = 1;
function row(name, value) {
    nextRow += 1;
    return { id: String(nextRow), name: name, value: value, isinactive: false };
}
function openSettings(scope) {
    var rows = [row('WON_STATUSES', '13'), row('LOST_STATUSES', '14'), row('DESIGN_SUBSTATUS', '1,4,5,13'),
        row('DELIVERY_SUBSTATUS', '8,11'), row('EXCLUDED_STATUSES', '90'), row('EXCLUDED_QUOTE_TYPES', '7,8'),
        row('RELEASED_STATUSES', '2')];
    if (scope !== undefined) {
        rows.push(row('LINK_BACKFILL_SCOPE', scope));
    }
    return rows;
}
function backfill(scope) {
    var env = setup({ scriptId: BACKFILL, settings: openSettings(scope) });
    env.w.customers[44] = { isinactive: true, custentity_cdb_link_version: '', companyname: 'Gone' };
    env.w.openOpp = ['42', '44'];
    env.w.openOrder = ['42', '43'];
    return env;
}
function runAll(env, inputs) {
    var mr = load(env, 'cdb_mr_link_backfill');
    var outputs = [];
    inputs.forEach(function (v) {
        mr.map({ value: JSON.stringify(v), write: function (o) { outputs.push(o); } });
    });
    mr.summarize({
        inputSummary: {},
        mapSummary: { errors: { iterator: function () { return { each: function () {} }; } } },
        output: { iterator: function () { return { each: function (fn) {
            outputs.forEach(function (o) { fn(o.key, o.value); });
        } }; } }
    });
    return outputs;
}

test('MR OPEN (empty row and the default): the digest\'s two open searches, unioned, once each, in ID order', function () {
    [undefined, '', 'open', 'SOME'].forEach(function (scope) {
        var env = backfill(scope);
        var mr = load(env, 'cdb_mr_link_backfill');
        assert.deepStrictEqual(mr.getInputData(), [{ customerId: '42' }, { customerId: '43' }, { customerId: '44' }],
            String(scope));
        var types = env.w.searches.filter(function (d) { return d.type !== 'customrecord_cdb_setting'; })
            .map(function (d) { return d.type; });
        assert.deepStrictEqual(types, ['opportunity', 'salesorder']);
        assert.ok(/^Scope OPEN: 3 customers/.test(logs(env.w, 'LINK_BACKFILL_INPUT')[0][2]));
    });
});

test('MR OPEN uses the very searches the digest uses (shared in cdb_lib_data)', function () {
    var env = backfill('OPEN');
    load(env, 'cdb_mr_link_backfill').getInputData();
    var mine = env.w.searches.filter(function (d) { return d.type !== 'customrecord_cdb_setting'; });
    var d = setup({ scriptId: 'customscript_cdb_mr_digest' });
    d.w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_released_statuses: '2',
        custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'LIVE' };
    load(d, 'cdb_mr_digest').getInputData();
    var theirs = d.w.searches.filter(function (x) { return x.type === 'opportunity' || x.type === 'salesorder'; });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(mine)), JSON.parse(JSON.stringify(theirs)));
});

test('MR ALL: one customer search, active only', function () {
    var env = backfill('ALL');
    var input = load(env, 'cdb_mr_link_backfill').getInputData();
    var defs = env.w.searches.filter(function (d) { return d.type !== 'customrecord_cdb_setting'; });
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].type, 'customer');
    assert.deepStrictEqual(defs[0].filters, [['isinactive', 'is', 'F']]);
    assert.strictEqual(typeof input.runPaged, 'function', 'the search itself is the input');
    assert.ok(/^Scope ALL/.test(logs(env.w, 'LINK_BACKFILL_INPUT')[0][2]));
});

test('MR: a missing "open" setting stops the run at the start, whatever the scope', function () {
    var env = setup({ scriptId: BACKFILL, settings: [row('LINK_BACKFILL_SCOPE', 'ALL')] });
    assert.throws(function () { load(env, 'cdb_mr_link_backfill').getInputData(); }, /CDB_PARAMETER_MISSING/);
});

test('MR: map writes what is wrong; summarize counts checked, already right, written, failed, inactive', function () {
    var env = backfill('OPEN');
    env.w.customers[43].custentity_cdb_link = linkFor(env, 43, 0);
    var outputs = runAll(env, [{ customerId: '42' }, { customerId: '43' }, { customerId: '44' }, { customerId: '999' },
        { id: '42', recordType: 'customer', values: {} }]);
    assert.deepStrictEqual(outputs.map(function (o) { return o.key; }),
        ['written', 'already right', 'inactive', 'failed', 'already right']);
    assert.ok(/^999: RCRD_DSNT_EXIST/.test(outputs[3].value));
    var writes = customerWrites(env.w);
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(Object.keys(writes[0].values), ['custentity_cdb_link']);
    assert.strictEqual(writes[0].values.custentity_cdb_link, linkFor(env, 42, 0));
    var line = logs(env.w, 'LINK_BACKFILL')[0][2];
    assert.ok(line.indexOf('checked 5; already right 2; written 1; failed 1; inactive 1. First 1 failures: ' +
        '999: RCRD_DSNT_EXIST') === 0, line);
    assert.ok(/backfill/.test(logs(env.w, 'LINK_WRITTEN')[0][2]));
    assert.strictEqual(logs(env.w, 'LINK_FAILED')[0][0], 'error');
});

test('MR: a rerun writes nothing when everything already matches', function () {
    var env = backfill('OPEN');
    var inputs = [{ customerId: '42' }, { customerId: '43' }];
    runAll(env, inputs);
    assert.strictEqual(customerWrites(env.w).length, 2);
    env.w.logs.length = 0;
    var outputs = runAll(env, inputs);
    assert.strictEqual(customerWrites(env.w).length, 2, 'no new write');
    assert.deepStrictEqual(outputs.map(function (o) { return o.key; }), ['already right', 'already right']);
    assert.ok(logs(env.w, 'LINK_BACKFILL')[0][2].indexOf('checked 2; already right 2; written 0; failed 0; inactive 0 (') === 0);
});

test('MR: the exact check rewrites a link the UE cannot see is stale (new domain, secret, Sandbox refresh)', function () {
    var env = backfill('OPEN');
    var right = linkFor(env, 42, 0);
    var token = load(env, 'lib/cdb_lib_token');
    // A refreshed Sandbox: Production's link, same payload, another domain.
    env.w.customers[42].custentity_cdb_link = right.replace('acct.extforms', 'prod.extforms');
    assert.strictEqual(token.linkMatches(env.w.customers[42].custentity_cdb_link, '42', 0), true, 'the UE sees a match');
    runUe(env, 'edit', 42);
    assert.strictEqual(customerWrites(env.w).length, 0);
    runAll(env, [{ customerId: '42' }]);
    assert.strictEqual(customerWrites(env.w).length, 1);
    assert.strictEqual(env.w.customers[42].custentity_cdb_link, right);
    assert.ok(/the stored link was c42\.v0/.test(logs(env.w, 'LINK_WRITTEN')[0][2]));
});

test('MR: more than 10 failures lists the first 10; a map error counts as failed', function () {
    var env = backfill('OPEN');
    var mr = load(env, 'cdb_mr_link_backfill');
    var outputs = [];
    var i;
    for (i = 0; i < 12; i++) { outputs.push({ key: 'failed', value: String(1000 + i) + ': RCRD_DSNT_EXIST' }); }
    mr.summarize({
        inputSummary: { error: 'input broke' },
        mapSummary: { errors: { iterator: function () { return { each: function (fn) { fn('k1', 'SSS_USAGE'); } }; } } },
        output: { iterator: function () { return { each: function (fn) {
            outputs.forEach(function (o) { fn(o.key, o.value); });
        } }; } }
    });
    var line = logs(env.w, 'LINK_BACKFILL')[0][2];
    assert.ok(line.indexOf('checked 13; already right 0; written 0; failed 13; inactive 0. First 10 failures: ') === 0, line);
    assert.ok(line.indexOf('1009: RCRD') > 0 && line.indexOf('1010:') < 0, 'only the first 10');
    assert.strictEqual(logs(env.w, 'LINK_BACKFILL_INPUT_FAILED').length, 1);
});

// ---------------------------------------------------------------- unchanged

test('unchanged: buildLink, the direct link and the digest\'s customer writes', function () {
    var env = setup();
    var token = load(env, 'lib/cdb_lib_token');
    var a = token.buildLink(42);
    assert.strictEqual(a, 'https://acct.extforms.netsuite.com/sl?t=' + token.sign(42, 0));
    assert.strictEqual(token.buildLink(42, { a: 'delivery', so: '100' }), a + '&a=delivery&so=100');
    assert.strictEqual(token.buildLink(42, { a: 'update', opp: '4' }), a + '&a=update&opp=4',
        'what Online-quote builds from the stored base link');
});

test('the config knows the new field, scripts and setting', function () {
    var c = load(setup(), 'lib/cdb_lib_config');
    assert.strictEqual(c.FIELDS.CUSTOMER.LINK, 'custentity_cdb_link');
    assert.strictEqual(c.SCRIPTS.CUSTOMER_UE, 'customscript_cdb_ue_customer');
    assert.strictEqual(c.SCRIPTS.CUSTOMER_UE_DEPLOYMENT, 'customdeploy_cdb_ue_customer');
    assert.strictEqual(c.SCRIPTS.LINK_BACKFILL, 'customscript_cdb_mr_link_backfill');
    assert.strictEqual(c.SCRIPTS.LINK_BACKFILL_DEPLOYMENT, 'customdeploy_cdb_mr_link_backfill');
    assert.deepStrictEqual(c.PARAMETERS.LINK_BACKFILL_SCOPE, { kind: 'scope', empty: 'default', defaultValue: 'OPEN', ids: {} });
    assert.strictEqual(c.SCRIPT_KEYS[c.SCRIPTS.CUSTOMER_UE], undefined, 'the UE reads no settings');
});
