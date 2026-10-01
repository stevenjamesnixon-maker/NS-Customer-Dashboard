'use strict';
/**
 * Release 2.1 part B: "Tell us where you're up to". Numbered as the brief's test table; the
 * unnumbered tests pin the decisions recorded in docs/context.md.
 *
 * The Online-quote Update Opportunity library is STUBBED with part A's signatures (lib 1.2.0, PR #35):
 * fieldOptions(key, [oppId]), writeOppUpdate({ oppId, values, allowed, logKey }) and
 * createObjections({ oppId, typeIds, notes, contextLine, raisedBy, raisedOn, quoteId, logKey }); keys or
 * field IDs in, library keys out; errors are plain Errors whose name is the OPPLIB_* code.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var LIB_PATH = '/SuiteScripts/NuHeat/2026 Quote/nuheat_opp_update_lib';

/** Part A's field table, as far as the dashboard uses it. */
var LIB_FIELDS = [
    { key: 'entitystatus', fieldId: 'entitystatus', kind: 'select' },
    { key: 'del_date', fieldId: 'custbody_opp_del_date', kind: 'date' },
    { key: 'build_stage', fieldId: 'custbody_build_stage', kind: 'select' }
];
var BUILD_STAGE_OPTIONS = [{ id: '', text: '' }, { id: '1', text: 'Planning' }, { id: '2', text: 'Foundations' },
    { id: '3', text: 'Walls up' }, { id: '4', text: 'Roof on' }];

function libError(code, message) {
    var e = new Error(code + ': ' + message);
    e.name = code;
    return e;
}

/** The library stub. Every call is recorded in w.calls, in order, with the Tasks (see setup). */
function oppLibStub(w, version) {
    function def(k) {
        return LIB_FIELDS.filter(function (f) { return f.key === k || f.fieldId === k; })[0] || null;
    }
    return {
        LIB_VERSION: version,
        fieldOptions: function (key, oppId) {
            var d = def(key);
            w.calls.push(['fieldOptions', key, oppId]);
            if (!d || d.kind !== 'select') { throw libError('OPPLIB_NOT_A_SELECT', key); }
            if (w.fieldOptionsThrow) { throw libError('OPPLIB_FIELD_UNAVAILABLE', key); }
            return BUILD_STAGE_OPTIONS.slice();
        },
        writeOppUpdate: function (o) {
            var out = { written: {}, unchanged: [] };
            var opp = w.opps[o.oppId];
            w.calls.push(['writeOppUpdate', o]);
            Object.keys(o.values).forEach(function (k) {
                var d = def(k);
                var v = String(o.values[k] || '');
                var list;
                if (!d) { throw libError('OPPLIB_UNKNOWN_FIELD', k); }
                if (v && d.kind === 'select') {
                    list = o.allowed && (o.allowed.hasOwnProperty(d.key) ? o.allowed[d.key] : o.allowed[d.fieldId]);
                    if (!Array.isArray(list) || list.map(String).indexOf(v) < 0) {
                        throw libError('OPPLIB_VALUE_NOT_ALLOWED', d.key + ' value "' + v + '" is not in the allowed list');
                    }
                }
            });
            if (w.oppWriteThrows) { throw libError('OPPLIB_WRITE_FAILED', 'submitFields refused'); }
            Object.keys(o.values).forEach(function (k) {
                var d = def(k);
                var v = String(o.values[k] || '');
                if (!v || String(opp[d.fieldId] || '') === v) { out.unchanged.push(d.key); return; }
                out.written[d.key] = { old: String(opp[d.fieldId] || ''), new: v };
                opp[d.fieldId] = v;
            });
            return out;
        },
        createObjections: function (o) {
            w.calls.push(['createObjections', o]);
            if (w.objectionFails) {
                return { created: [], failed: o.typeIds, errors: { 21: 'INVALID_FLD_VALUE' } };
            }
            return { created: ['9001'], failed: [], errors: {} };
        }
    };
}

/**
 * The dashboard on the in-memory NetSuite with the library stubbed. opts: version (LIB_VERSION; null
 * leaves the library out entirely), settings ({ KEY: value } rows), stage (the customer's), lost
 * (LOST_STATUSES parameter), noLibProp (the module has no LIB_VERSION).
 */
function setup(opts) {
    var o = opts || {};
    var w = ns.world();
    var s;
    var settings = o.settings || {};
    w.calls = [];
    // An open quote of customer 42 (status 10: neither Won 13 nor Lost 14), a lost one, a won one (4).
    w.opps[5] = { entity: '42', title: 'New build', tranid: 'QR5', entitystatus: '10', custbody_opportunity_sub_status: '',
        salesrep: '88', custbody_pe: '', custbody_value_proposition: '1', custbody_opp_site_adress: 'Plot 4\nVillage',
        custbody_build_stage: '2', custbody_opp_del_date: '2027-01-15' };
    w.opps[6] = { entity: '42', title: 'Old idea', tranid: 'QR6', entitystatus: '14', custbody_opportunity_sub_status: '',
        salesrep: '88', custbody_pe: '', custbody_value_proposition: '1', custbody_opp_site_adress: '' };
    w.customers[42].stage = o.stage === undefined ? 'CUSTOMER' : o.stage;
    w.customers[42].phone = '01234 567890';
    w.lists.customrecord_nh_objection_type = { 21: 'Price', 22: 'Timing', 23: 'Went elsewhere' };
    w.estimates = { 700: { tranid: 'EST700', opportunity: '5', status: 'Estimate:A', custbody_quote_description: 'UFH ground floor' },
        701: { tranid: 'EST701', opportunity: '5', status: 'Estimate:C', custbody_quote_description: 'Closed one' } };
    w.paramOverrides = { custscript_cdb_lost_statuses: o.lost || '14,35,54' };
    w.settings = Object.keys(settings).map(function (k, i) { return { id: String(100 + i), name: k, value: settings[k] }; });
    s = ns.stubs(w);
    if (o.version !== null) {
        s.modules = {};
        s.modules[LIB_PATH] = oppLibStub(w, o.version === undefined ? '1.2.0' : o.version);
        if (o.noLibProp) { delete s.modules[LIB_PATH].LIB_VERSION; }
    }
    var create = s['N/record'].create;
    s['N/record'].create = function (c) {
        if (w.taskThrows) { throw new Error('task boom'); }
        w.calls.push(['task']);
        return create(c);
    };
    return { w: w, s: s, sl: amd.load('cdb_sl_dashboard', s), tok: amd.load('lib/cdb_lib_token', s).sign(42, 0) };
}

var FULL = { UPD_BUILD_STAGES: '4,2', UPD_OBJECTION_TYPES: '21,22',
    UPD_LOST_STATUS_MAP: '{"CUSTOMER": "14", "PROSPECT": "35", "LEAD": "54"}' };

function run(sl, method, params) {
    var out = { html: '' };
    sl.onRequest({
        request: { method: method, parameters: params },
        response: { setHeader: function () {}, write: function (o) { out.html += o.output; } }
    });
    return out.html;
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function callNames(w) {
    return w.calls.map(function (c) { return c[0]; });
}

function writes(w) {
    return w.calls.filter(function (c) { return c[0] === 'writeOppUpdate' || c[0] === 'createObjections'; });
}

function dates() {
    return amd.load('lib/cdb_lib_dates');
}

function future(months) {
    var d = dates();
    return d.addMonths(d.londonTodayKey(Date.now()), months);
}

function post(s, extra) {
    var p = { t: s.tok, a: 'update', opp: '5', mode: 'update' };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return run(s.sl, 'POST', p);
}

function notGoing(s, extra) {
    return post(s, Object.assign({ mode: 'notgoing', reason: '21', comment: 'Too dear', confirm: 'yes' }, extra || {}));
}

function count(html, needle) {
    return html.split(needle).length - 1;
}

// ---------------------------------------------------------------- 1 the button

test('1. the update button shows only on "Projects to order" opportunities', function () {
    var s = setup({ settings: FULL });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(count(html, 'Tell us where you’re up to</a>'), 1, 'one open quote, one button');
    assert.ok(html.indexOf('class="out" href="https://acct.extforms.netsuite.com/sl?t=' + s.tok + '&amp;a=update&amp;opp=5"') > 0, html);
    assert.strictEqual(html.indexOf('opp=4'), -1, 'not on the won opportunity in delivery');
    assert.strictEqual(html.indexOf('opp=6'), -1, 'not on the lost one');
});

test('the direct link: buildLink(customerId, { a: \'update\', opp })', function () {
    var s = setup();
    var link = amd.load('lib/cdb_lib_token', s.s).buildLink(42, { a: 'update', opp: '5' });
    assert.ok(/&a=update&opp=5$/.test(link), link);
});

// ---------------------------------------------------------------- 2 the guard

test('2. guardOpportunity: another customer\'s, a Won or a Lost opportunity is refused, dashboard with a notice', function () {
    var s = setup({ settings: FULL });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '9' });
    assert.ok(html.indexOf('Your projects</h1>') > 0 && html.indexOf('That project can&#39;t be updated online') > 0, 'another customer');
    assert.ok(logs(s.w, 'GUARD_REFUSED').some(function (l) { return /opportunity 9: opportunity belongs to another customer/.test(l[2]); }));
    html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '4' });
    assert.ok(html.indexOf('That project has been ordered') > 0, 'won');
    html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '6' });
    assert.ok(html.indexOf('That project is closed') > 0, 'lost');
    html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: 'abc' });
    assert.ok(html.indexOf('That project can&#39;t be updated online') > 0, 'not an ID');

    ['9', '4', '6'].forEach(function (opp) {
        post(s, { opp: opp, buildStage: '4', note: 'hi' });
        notGoing(s, { opp: opp });
    });
    assert.strictEqual(writes(s.w).length, 0, 'nothing written');
    assert.strictEqual(s.w.tasks.length, 0, 'no Task');
});

// ---------------------------------------------------------------- 3-4 the stage question

test('3. stage options = fieldOptions ∩ UPD_BUILD_STAGES, in setting order, current preselected; hidden when empty', function () {
    var s = setup({ settings: FULL });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
    var four = html.indexOf('name="buildStage" value="4"');
    var two = html.indexOf('name="buildStage" value="2"');
    assert.ok(four > 0 && two > four, 'setting order 4, 2');
    assert.strictEqual(html.indexOf('name="buildStage" value="1"'), -1);
    assert.strictEqual(html.indexOf('name="buildStage" value="3"'), -1);
    assert.ok(/name="buildStage" value="2" checked/.test(html), 'current value preselected');
    assert.deepStrictEqual(s.w.calls[0], ['fieldOptions', 'custbody_build_stage', '5']);
    assert.ok(html.indexOf('What stage is your project at?') > 0);
    // Header: title, QR number, site address.
    assert.ok(html.indexOf('New build · QR5 · Plot 4, Village') > 0);
    // The date, prefilled; the phone from the customer (no dashboard contact).
    assert.ok(html.indexOf('name="delDate" value="2027-01-15"') > 0);
    assert.ok(html.indexOf('Approximate is fine.') > 0);
    assert.ok(html.indexOf('name="phone" value="01234 567890"') > 0);

    s = setup({ settings: { UPD_OBJECTION_TYPES: '21' } });
    html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
    assert.strictEqual(html.indexOf('What stage is your project at?'), -1, 'hidden');
    assert.strictEqual(html.indexOf('name="buildStage"'), -1);
    assert.strictEqual(callNames(s.w).indexOf('fieldOptions'), -1, 'not even read');
});

test('4. a tampered stage ID is a field error and nothing is written', function () {
    var s = setup({ settings: FULL });
    var html = post(s, { buildStage: '3', note: 'hello', call: 'T', phone: '07700 900000', callTime: 'MORNING' });
    assert.ok(html.indexOf('Please choose one of the stages shown.') > 0);
    assert.ok(html.indexOf('>hello</textarea>') > 0, 'input kept');
    post(s, { buildStage: '999' });
    assert.strictEqual(writes(s.w).length, 0);
    assert.strictEqual(s.w.tasks.length, 0);
    assert.strictEqual(logs(s.w, 'UPDATE_REJECTED').length, 2);
});

// ---------------------------------------------------------------- 5-6 the update path

test('5. stage + date + note + call: writeOppUpdate with only the changed keys; one Task with all four', function () {
    var s = setup({ settings: FULL });
    var when = future(6);
    var html = post(s, { buildStage: '4', delDate: when, note: 'Slab next month', call: 'T', phone: '07700 900000',
        callTime: 'MORNING' });
    var w = s.w;
    var call = writes(w)[0][1];
    var task = w.tasks[0].values;
    assert.deepStrictEqual(callNames(w), ['fieldOptions', 'writeOppUpdate', 'task']);
    assert.deepStrictEqual(call.values, { custbody_build_stage: '4', custbody_opp_del_date: when });
    assert.deepStrictEqual(call.allowed, { custbody_build_stage: ['4', '2'] });
    assert.strictEqual(call.oppId, '5');
    assert.strictEqual(w.tasks.length, 1);
    assert.strictEqual(task.title, 'Customer update: QR5 New build');
    assert.strictEqual(task.priority, 'MEDIUM');
    assert.strictEqual(task.assigned, '88');
    assert.strictEqual(task.transaction, '5');
    assert.strictEqual(task.company, '42');
    assert.ok(task.message.indexOf('Project stage: Foundations → Roof on') > 0, task.message);
    assert.ok(task.message.indexOf('Goods needed around: ' + dates().formatLong('2027-01-15') + ' → ' +
        dates().formatLong(when)) > 0, task.message);
    assert.ok(task.message.indexOf('Note from the customer: Slab next month') > 0);
    assert.ok(task.message.indexOf('CALL REQUESTED: 07700 900000, best time: Morning.') > 0);
    assert.ok(html.indexOf('Thanks, we’ve updated your project') > 0);
    assert.ok(html.indexOf('Roof on') > 0 && html.indexOf('Ray will call you in the morning.') > 0, html);
    assert.ok(logs(w, 'OPP_UPDATED')[0][2].indexOf('Project stage Foundations -> Roof on') > 0);
    assert.ok(logs(w, 'UPDATE_TASK')[0][2].indexOf('assigned to 88') > 0);
});

test('5b. an unchanged stage and date are not sent; blank never clears', function () {
    var s = setup({ settings: FULL });
    post(s, { buildStage: '2', delDate: '2027-01-15', note: 'Just a note' });
    assert.strictEqual(writes(s.w).length, 0, 'nothing changed on the opportunity');
    assert.strictEqual(s.w.tasks.length, 1, 'the note still goes');
    assert.ok(s.w.tasks[0].values.message.indexOf('No changes to the opportunity.') > 0);
    s = setup({ settings: FULL });
    post(s, { buildStage: '', delDate: '', note: 'x' });
    assert.strictEqual(writes(s.w).length, 0, 'blank sends nothing');
    s = setup({ settings: FULL });
    post(s, { delDate: future(3) });
    assert.deepStrictEqual(Object.keys(writes(s.w)[0][1].values), ['custbody_opp_del_date'], 'only the date');
});

test('6. nothing changed, no note, no call: "Nothing to update"; no write; no Task', function () {
    var s = setup({ settings: FULL });
    var html = post(s, { buildStage: '2', delDate: '2027-01-15', note: '  ', phone: '07700 900000', callTime: 'MORNING' });
    assert.ok(html.indexOf('Nothing to update') > 0);
    assert.strictEqual(writes(s.w).length, 0);
    assert.strictEqual(s.w.tasks.length, 0);
});

test('the update write fails: the Task still goes, saying NOT saved; the customer is thanked', function () {
    var s = setup({ settings: FULL });
    s.w.oppWriteThrows = true;
    var html = post(s, { buildStage: '4' });
    assert.ok(s.w.tasks[0].values.message.indexOf('NOT saved on the opportunity (OPPLIB_WRITE_FAILED') > 0);
    assert.ok(html.indexOf('passed your update on') > 0);
    assert.strictEqual(logs(s.w, 'OPP_UPDATE_FAILED')[0][0], 'error');
});

test('a call request needs a phone and a time; the phone and time are ignored without the box', function () {
    var s = setup({ settings: FULL });
    var html = post(s, { call: 'T', phone: '', callTime: '' });
    assert.ok(html.indexOf('Please give a phone number we can call.') > 0);
    assert.ok(html.indexOf('Please choose the best time to call.') > 0);
    assert.strictEqual(s.w.tasks.length, 0);
    html = post(s, { phone: 'abc', callTime: 'NOON' });
    assert.ok(html.indexOf('Nothing to update') > 0, 'no box, no call, nothing to do');
});

// ---------------------------------------------------------------- 7-9 not going ahead

[['CUSTOMER', '14'], ['PROSPECT', '35'], ['LEAD', '54']].forEach(function (c) {
    test('7. not going ahead, with a reason, ' + c[0].toLowerCase() + ': objection -> status ' + c[1] + ' -> high-priority Task, in that order', function () {
        var s = setup({ settings: FULL, stage: c[0] });
        var html = notGoing(s);
        var w = s.w;
        var obj = w.calls.filter(function (x) { return x[0] === 'createObjections'; })[0][1];
        var status = w.calls.filter(function (x) { return x[0] === 'writeOppUpdate'; })[0][1];
        var key = dates().londonTodayKey(Date.now());
        assert.deepStrictEqual(callNames(w).filter(function (n) { return n !== 'fieldOptions'; }),
            ['createObjections', 'writeOppUpdate', 'task']);
        assert.deepStrictEqual(obj.typeIds, ['21']);
        assert.strictEqual(obj.notes, 'Too dear');
        assert.strictEqual(obj.contextLine, 'Customer, via dashboard (' + key.slice(8) + '/' + key.slice(5, 7) + '/' +
            key.slice(0, 4) + ')');
        assert.strictEqual(obj.raisedBy, '');
        assert.strictEqual(obj.oppId, '5');
        assert.deepStrictEqual(status.values, { entitystatus: c[1] });
        assert.deepStrictEqual(status.allowed, { entitystatus: [c[1]] });
        assert.strictEqual(w.tasks[0].values.priority, 'HIGH');
        assert.strictEqual(w.tasks[0].values.title, 'Customer not going ahead: QR5 New build');
        assert.ok(w.tasks[0].values.message.indexOf('Reason: Price') > 0);
        assert.ok(w.tasks[0].values.message.indexOf('Comment: Too dear') > 0);
        assert.ok(w.tasks[0].values.message.indexOf('Opportunity set to Lost (status ' + c[1]) > 0);
        assert.ok(w.tasks[0].values.message.indexOf('- EST700: UFH ground floor') > 0, 'the open quote listed');
        assert.strictEqual(w.tasks[0].values.message.indexOf('EST701'), -1, 'a closed quote is not');
        assert.ok(html.indexOf('Thanks for letting us know.') > 0);
        assert.ok(logs(w, 'OPP_LOST')[0][2].indexOf('entitystatus 10 -> ' + c[1]) > 0);
        assert.strictEqual(w.opps[5].entitystatus, c[1]);
        // The project then disappears from the dashboard (Lost).
        assert.strictEqual(run(s.sl, 'GET', { t: s.tok }).indexOf('New build'), -1);
    });
});

test('7b. no reason chosen: no objection; Lost and the Task as usual', function () {
    var s = setup({ settings: FULL });
    notGoing(s, { reason: '' });
    assert.deepStrictEqual(callNames(s.w).filter(function (n) { return n !== 'fieldOptions'; }), ['writeOppUpdate', 'task']);
    assert.ok(s.w.tasks[0].values.message.indexOf('Reason: (none given)') > 0);
});

test('7c. a reason outside UPD_OBJECTION_TYPES is a field error; nothing is written', function () {
    var s = setup({ settings: FULL });
    var html = notGoing(s, { reason: '23' });
    assert.ok(html.indexOf('Please choose one of the reasons shown.') > 0);
    assert.ok(/<details class="card ngp" open>/.test(html), 'the panel stays open');
    assert.strictEqual(writes(s.w).length, 0);
    assert.strictEqual(s.w.tasks.length, 0);
});

test('7d. a failed objection does not stop Lost or the Task, which says so', function () {
    var s = setup({ settings: FULL });
    s.w.objectionFails = true;
    notGoing(s);
    assert.ok(s.w.tasks[0].values.message.indexOf('Customer Objection NOT created: INVALID_FLD_VALUE') > 0);
    assert.strictEqual(s.w.opps[5].entitystatus, '14');
});

[['empty', '', 'setting empty'], ['invalid', '{CUSTOMER: 14', 'setting invalid'],
    ['missing the stage', '{"PROSPECT": "35", "LEAD": "54"}', 'no status set for stage CUSTOMER']].forEach(function (c) {
    test('8. UPD_LOST_STATUS_MAP ' + c[0] + ': no status write; LOST_NOT_SET with the stage; the Task says so', function () {
        var settings = { UPD_OBJECTION_TYPES: '21', UPD_BUILD_STAGES: '4,2' };
        if (c[1]) { settings.UPD_LOST_STATUS_MAP = c[1]; }
        var s = setup({ settings: settings });
        var html = notGoing(s);
        assert.strictEqual(s.w.calls.filter(function (x) { return x[0] === 'writeOppUpdate'; }).length, 0, 'no status write');
        assert.strictEqual(callNames(s.w).indexOf('createObjections') >= 0, true, 'the objection still made');
        var line = logs(s.w, 'LOST_NOT_SET');
        assert.strictEqual(line.length, 1);
        assert.ok(line[0][2].indexOf('stage "CUSTOMER" (CUSTOMER): ' + c[2]) > 0, line[0][2]);
        assert.ok(s.w.tasks[0].values.message.indexOf('NOT set to Lost: ' + c[2] + '.') > 0, s.w.tasks[0].values.message);
        assert.strictEqual(s.w.tasks[0].values.priority, 'HIGH');
        assert.ok(html.indexOf('Thanks for letting us know.') > 0);
        assert.strictEqual(logs(s.w, 'LOST_MAP_INVALID').length, c[0] === 'invalid' ? 1 : 0);
    });
});

test('8b. never another stage\'s status: an unknown stage, or a mapped status not in LOST_STATUSES, sets nothing', function () {
    var s = setup({ settings: FULL, stage: 'PARTNER' });
    notGoing(s);
    assert.strictEqual(s.w.calls.filter(function (x) { return x[0] === 'writeOppUpdate'; }).length, 0);
    assert.ok(logs(s.w, 'LOST_NOT_SET')[0][2].indexOf('stage "PARTNER" (unknown): customer stage unknown') > 0);
    s = setup({ settings: FULL, lost: '14' });
    s.w.customers[42].stage = 'PROSPECT';
    notGoing(s);
    assert.strictEqual(s.w.calls.filter(function (x) { return x[0] === 'writeOppUpdate'; }).length, 0);
    assert.ok(s.w.tasks[0].values.message.indexOf('NOT set to Lost: status 35 for stage PROSPECT is not in LOST_STATUSES') > 0);
});

test('9. the opportunity write throws: the Task says "NOT set to Lost"; the page confirms', function () {
    var s = setup({ settings: FULL });
    s.w.oppWriteThrows = true;
    var html = notGoing(s);
    assert.ok(s.w.tasks[0].values.message.indexOf('NOT set to Lost: OPPLIB_WRITE_FAILED: submitFields refused.') > 0,
        s.w.tasks[0].values.message);
    assert.ok(html.indexOf('Thanks for letting us know.') > 0);
    assert.strictEqual(logs(s.w, 'OPP_LOST_FAILED')[0][0], 'error');
    assert.strictEqual(s.w.opps[5].entitystatus, '10');
});

test('9b. the Task fails after the writes: TASK_FAILED at error; the page still confirms', function () {
    var s = setup({ settings: FULL });
    s.w.taskThrows = true;
    var html = notGoing(s);
    assert.strictEqual(s.w.opps[5].entitystatus, '14');
    assert.ok(html.indexOf('Thanks for letting us know.') > 0);
    assert.strictEqual(logs(s.w, 'TASK_FAILED')[0][0], 'error');
    s = setup({ settings: FULL });
    s.w.taskThrows = true;
    html = post(s, { buildStage: '4' });
    assert.ok(html.indexOf('Thanks, we’ve updated your project') > 0);
    assert.strictEqual(logs(s.w, 'TASK_FAILED').length, 1);
});

test('9c. the open quotes cannot be listed: the Task says so', function () {
    var s = setup({ settings: FULL });
    s.w.estimatesThrow = true;
    notGoing(s);
    assert.ok(s.w.tasks[0].values.message.indexOf('Open quotes: could not be listed.') > 0);
    assert.strictEqual(logs(s.w, 'OPEN_QUOTES_FAILED').length, 1);
});

// ---------------------------------------------------------------- 10 the version guard

[['1.1.0', false], [null, false], ['1.2', false], ['missing', true]].forEach(function (c) {
    test('10. library ' + (c[1] ? 'without LIB_VERSION' : c[0] === null ? 'not deployed' : 'at ' + c[0]) +
        ': button hidden; the direct link shows the call message; OPPLIB_VERSION once', function () {
        var s = setup({ settings: FULL, version: c[1] ? '1.2.0' : c[0], noLibProp: c[1] });
        var html = run(s.sl, 'GET', { t: s.tok });
        var direct;
        if (c[0] === '1.2') {
            // '1.2' is 1.2.0: allowed (a missing part counts 0).
            assert.ok(html.indexOf('a=update') > 0);
            return;
        }
        assert.strictEqual(html.indexOf('a=update'), -1, 'no button');
        assert.ok(html.indexOf('New build') > 0, 'the dashboard still works');
        direct = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
        assert.ok(direct.indexOf('This isn’t available right now; please call Ray Rep on <a href="tel:0202">0202</a>.') > 0, direct);
        post(s, { buildStage: '4', note: 'x' });
        assert.strictEqual(writes(s.w).length, 0);
        assert.strictEqual(s.w.tasks.length, 0);
        assert.strictEqual(logs(s.w, 'OPPLIB_VERSION').length, 1, 'once per execution');
    });
});

test('10b. the library at 1.2.0 or later is used; the delivery pages never need it', function () {
    var s = setup({ settings: FULL, version: '1.10.0' });
    assert.ok(run(s.sl, 'GET', { t: s.tok }).indexOf('a=update') > 0, '1.10.0 > 1.2.0');
    s = setup({ version: null });
    assert.ok(run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' }).indexOf('Arrange delivery') > 0);
    assert.strictEqual(logs(s.w, 'OPPLIB_VERSION').length, 0, 'not required for delivery');
});

// ---------------------------------------------------------------- 11 escaping

test('11. XSS in the note and the comment is escaped on the page and in the Task', function () {
    var x = '<script>alert(1)</script>"&';
    var s = setup({ settings: FULL });
    var html = post(s, { buildStage: '999', note: x });
    assert.strictEqual(html.indexOf('<script>alert'), -1);
    assert.ok(html.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;</textarea>') > 0);
    html = notGoing(s, { reason: '999', comment: x });
    assert.strictEqual(html.indexOf('<script>alert'), -1);
    assert.ok(html.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') > 0);

    post(s, { note: x, call: 'T', phone: '07700 900000', callTime: 'ANY' });
    assert.strictEqual(s.w.tasks[0].values.message.indexOf('<script>'), -1);
    assert.ok(s.w.tasks[0].values.message.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;') > 0);
    notGoing(s, { comment: x });
    assert.strictEqual(s.w.tasks[1].values.message.indexOf('<script>'), -1);
    assert.ok(s.w.tasks[1].values.message.indexOf('Comment: &lt;script&gt;') > 0);
    // The comment goes to the objection as typed: the library writes it to a text field.
    assert.strictEqual(s.w.calls.filter(function (c) { return c[0] === 'createObjections'; })[0][1].notes, x);
});

// ---------------------------------------------------------------- 12 two steps

test('12. a one-click "not going ahead" is impossible without the confirm step', function () {
    var s = setup({ settings: FULL });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
    var mainForm = html.slice(html.indexOf('<form class="fcol" id="uform"'), html.indexOf('</form>'));
    assert.strictEqual(mainForm.indexOf('name="confirm"'), -1, 'the update form never carries the confirm value');
    assert.strictEqual(mainForm.indexOf('notgoing'), -1);
    assert.ok(/<details class="card ngp"><summary>Not going ahead\? Let us know<\/summary>/.test(html), 'closed panel');
    assert.ok(html.indexOf('<button type="submit" class="warnbtn" name="confirm" value="yes">Yes, we’re not going ahead</button>') >
        html.indexOf('<details'), 'the confirm button is inside the panel');

    html = notGoing(s, { confirm: '' });
    assert.ok(html.indexOf('to confirm.') > 0);
    notGoing(s, { confirm: 'true' });
    post(s, { confirm: 'yes', reason: '21' });
    assert.strictEqual(writes(s.w).length, 0, 'nothing written without confirm=yes in not-going mode');
    assert.strictEqual(s.w.tasks.length, 0);
});

// ---------------------------------------------------------------- pure parts

test('validateUpdate: the date rules', function () {
    var data = amd.load('lib/cdb_lib_data', ns.stubs(ns.world()));
    var today = '2026-10-01';
    var ctx = { stageIds: [], showDate: true, current: { buildStage: '', delDateKey: '2026-01-01' }, reasonIds: [], todayKey: today };
    assert.ok(data.validateUpdate({ delDate: '2026-01-01', note: 'n' }, ctx).ok, 'an unchanged past date is fine');
    assert.ok(/from today onwards/.test(data.validateUpdate({ delDate: '2026-09-30' }, ctx).errors.delDate));
    assert.ok(/for example/.test(data.validateUpdate({ delDate: '2026-02-30' }, ctx).errors.delDate));
    assert.ok(data.validateUpdate({ delDate: '2031-10-01' }, ctx).ok);
    assert.ok(!data.validateUpdate({ delDate: '2031-10-02' }, ctx).ok, 'within five years');
    assert.deepStrictEqual(data.validateUpdate({ delDate: '2027-03-15' }, ctx).changes, { delDate: '2027-03-15' });
    assert.ok(data.validateUpdate({ delDate: '2027-03-15' }, { stageIds: [], showDate: false, current: {}, todayKey: today }).nothing,
        'no date question, no date');
    assert.ok(/1000/.test(data.validateUpdate({ note: new Array(1002).join('x') }, ctx).errors.note));
    assert.ok(data.validateUpdate({ note: new Array(1001).join('x') }, ctx).ok, '1,000 is fine');
});

test('parseLostStatusMap, lostStatusFor, normaliseStage, versionAtLeast', function () {
    var w = ns.world();
    var config = amd.load('lib/cdb_lib_config', ns.stubs(w));
    var data = amd.load('lib/cdb_lib_data', ns.stubs(w));
    var cfg = { LOST_STATUSES: ['14', '35', '54'] };
    assert.deepStrictEqual(config.parseLostStatusMap(' {"customer": 14, " Prospect ": "35", "LEAD": "x", "OTHER": "9"} '),
        { status: 'ok', map: { CUSTOMER: '14', PROSPECT: '35' }, detail: '' });
    assert.strictEqual(config.parseLostStatusMap('').status, 'empty');
    assert.strictEqual(config.parseLostStatusMap('[1]').status, 'invalid');
    assert.deepStrictEqual(data.lostStatusFor('LEAD', config.parseLostStatusMap('{"LEAD":"54"}'), cfg), { statusId: '54', why: '' });
    assert.strictEqual(data.lostStatusFor('LEAD', config.parseLostStatusMap('{"CUSTOMER":"14"}'), cfg).statusId, '',
        'never another stage\'s status');
    assert.strictEqual(data.normaliseStage('_prospect'), 'PROSPECT');
    assert.strictEqual(data.normaliseStage('Customer'), 'CUSTOMER');
    assert.strictEqual(data.normaliseStage('partner'), '');
    assert.ok(data.versionAtLeast('1.2.0', '1.2.0'));
    assert.ok(data.versionAtLeast('2.0', '1.2.0'));
    assert.ok(!data.versionAtLeast('1.1.9', '1.2.0'));
    assert.ok(!data.versionAtLeast(undefined, '1.2.0'));
    assert.ok(!data.versionAtLeast('1.2.0-beta', '1.2.0'));
});

test('the stage and date fields are read in the guard, and the update fields are never written outside the library', function () {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'FileCabinet', 'SuiteScripts', 'NuHeat', 'Customer Dashboard',
        'cdb_sl_dashboard.js'), 'utf8');
    assert.ok(!/submitFields/.test(src), 'no direct opportunity write');
    assert.ok(!/custbody_opportunity_sub_status|SUB_STATUS/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'never the sub-status');
});
