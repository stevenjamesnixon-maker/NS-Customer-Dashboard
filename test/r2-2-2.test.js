'use strict';
/**
 * PR #8 amendment 2 (2.2.2): a ready-to-book order's current forecast date — the ORDER's
 * custbody_defaultshipdate, today or later — on the dashboard row, the delivery form and the delivery-link
 * email. (The site address changes are in test/r2-2-1.test.js.)
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var dates = amd.load('lib/cdb_lib_dates');
var TODAY = dates.londonTodayKey(Date.now());
var FUTURE = dates.addMonths(TODAY, 1);
var LATER = dates.addMonths(TODAY, 2);
var PAST = '2020-01-15';

function show(key) {
    return dates.formatDisplay(key, TODAY);
}

function rowLine(key) {
    return '<span class="meta">Currently planned for ' + show(key) + '. Choose your date to confirm.</span>';
}

/** Order 100 of customer 42 (ready to book), with its ship date, through the dashboard. */
function page(tweak, params) {
    var w = ns.world();
    var html = '';
    var s;
    if (tweak) { tweak(w); }
    s = ns.stubs(w);
    var p = { t: amd.load('lib/cdb_lib_token', s).sign(42, 0) };
    Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    amd.load('cdb_sl_dashboard', s).onRequest({ request: { method: 'GET', parameters: p },
        response: { setHeader: function () {}, write: function (o) { html += o.output; } } });
    return { w: w, html: html };
}

function sendLink(tweak) {
    var w = ns.world();
    w.scriptId = 'customscript_cdb_sl_send_link';
    w.params = { custscript_cdbsend_excluded_statuses: '90', custscript_cdbsend_excluded_quote_types: '7,8',
        custscript_cdbsend_released_statuses: '2', custscript_cdbsend_fallback_employee: '500',
        custscript_cdbsend_logo_url: '', custscript_cdbsend_quote_type_labels: '', custscript_cdbsend_notice_days: '3' };
    if (tweak) { tweak(w); }
    amd.load('cdb_sl_send_link', ns.stubs(w)).onRequest({ request: { method: 'GET', parameters: { so: '100' } },
        response: { setHeader: function () {}, write: function () {} } });
    return w;
}

// ---------------------------------------------------------------- the dashboard row

test('row: a ready row with a future ship date shows "Currently planned for …"; today counts', function () {
    [FUTURE, TODAY].forEach(function (key) {
        var r = page(function (w) { w.orders[100].custbody_defaultshipdate = key; });
        assert.ok(r.html.indexOf('Ready to deliver</span>' + rowLine(key)) > 0, key + '\n' + r.html);
    });
    // Next year's date carries the year (shortDate).
    var next = String(+TODAY.slice(0, 4) + 1) + '-03-10';
    var r = page(function (w) { w.orders[100].custbody_defaultshipdate = next; });
    assert.ok(r.html.indexOf('Currently planned for ' + show(next) + '.') > 0);
    assert.ok(/ \d{4}$/.test(show(next)), 'with the year');
});

test('row: nothing when the date is past or blank', function () {
    [PAST, ''].forEach(function (key) {
        var r = page(function (w) { w.orders[100].custbody_defaultshipdate = key; });
        assert.ok(r.html.indexOf('Ready to deliver') > 0);
        assert.strictEqual(r.html.indexOf('Currently planned'), -1, key || 'blank');
    });
});

test('row: nothing on a row that is not ready to book (requested, awaiting payment, booked, released, needs info)', function () {
    var cases = {
        requested: function (w) { w.paramOverrides = { custscript_cdb_pay_account: '9' }; w.orders[100].custbody_cust_pay_intent = '9'; },
        awaiting_payment: function (w) { w.orders[100].custbody_cust_pay_intent = '1'; },
        booked: function (w) { w.orders[100].custbody_del_date = LATER; },
        released: function (w) {
            w.paramOverrides = { custscript_cdb_released_statuses: '90' };
            w.orders[100].custbody_finance_status = '90';
        },
        needs_info: function (w) { w.orders[100].custbody_ready_for_delivery = false; }
    };
    Object.keys(cases).forEach(function (state) {
        var r = page(function (w) { w.orders[100].custbody_defaultshipdate = FUTURE; cases[state](w); });
        assert.ok(r.html.indexOf('class="sorow"') > 0, state + ': the row shows');
        assert.strictEqual(r.html.indexOf('Ready to deliver'), -1, state + ': not ready');
        assert.strictEqual(r.html.indexOf('Currently planned'), -1, state);
    });
});

test('row: the sales order\'s date, never the opportunity\'s', function () {
    var r = page(function (w) { w.opps[4].custbody_opp_del_date = FUTURE; w.orders[100].custbody_defaultshipdate = ''; });
    assert.strictEqual(r.html.indexOf('Currently planned'), -1, 'the opportunity\'s date is not used');
    r = page(function (w) { w.opps[4].custbody_opp_del_date = FUTURE; w.orders[100].custbody_defaultshipdate = LATER; });
    assert.ok(r.html.indexOf(rowLine(LATER)) > 0, 'the order\'s');
    assert.strictEqual(r.html.indexOf('Currently planned for ' + show(FUTURE)), -1);
    // render.plannedDate reads only shipDateKey.
    var render = amd.load('lib/cdb_lib_render');
    assert.strictEqual(render.plannedDate({ shipDateKey: '', delDateKey: FUTURE, confirmedDateKey: FUTURE }), '');
    assert.strictEqual(render.plannedDate({ shipDateKey: FUTURE }), show(FUTURE));
    assert.strictEqual(render.plannedDate({ shipDateKey: PAST }), '');
});

// ---------------------------------------------------------------- the delivery form

test('form: "We currently have this pencilled in for …" under the heading lines, muted; not when past or blank', function () {
    var r = page(function (w) { w.orders[100].custbody_defaultshipdate = FUTURE; }, { a: 'delivery', so: '100' });
    var line = '<p class="hint" style="margin:0">We currently have this pencilled in for ' + show(FUTURE) +
        '. Choose the date that suits you below.</p></div>';
    assert.ok(r.html.indexOf(line) > 0, r.html);
    assert.ok(r.html.indexOf(line) > r.html.indexOf('<h1>Arrange delivery</h1>'));
    assert.ok(r.html.indexOf(line) < r.html.indexOf('<form class="fcol" id="dform"'), 'before the form');
    [PAST, ''].forEach(function (key) {
        var p = page(function (w) { w.orders[100].custbody_defaultshipdate = key; }, { a: 'delivery', so: '100' });
        assert.ok(p.html.indexOf('<h1>Arrange delivery</h1>') > 0);
        assert.strictEqual(p.html.indexOf('pencilled in'), -1, key || 'blank');
    });
});

// ---------------------------------------------------------------- the delivery-link email

test('email: "Currently planned" above "Earliest delivery", in the fact-row markup; absent with no date or a past one', function () {
    var w = sendLink(function (x) { x.orders[100].custbody_defaultshipdate = FUTURE; });
    var body = w.emails[0].body;
    var planned = body.indexOf('Currently planned</font>');
    var earliest = body.indexOf('Earliest delivery</font>');
    assert.ok(planned > 0 && earliest > 0 && planned < earliest, 'above Earliest delivery');
    // The same markup as the Earliest delivery row, label and value.
    var row = /<tr>(?:(?!<tr>)[\s\S])*?Currently planned<\/font><\/td><td[^>]*><font[^>]*><b>([^<]*)<\/b>(?:(?!<tr>)[\s\S])*?<\/tr>/
        .exec(body);
    assert.ok(row, 'a fact row');
    assert.strictEqual(row[1], show(FUTURE));
    var earliestRow = /<tr>(?:(?!<tr>)[\s\S])*?Earliest delivery<\/font><\/td>/.exec(body)[0];
    assert.strictEqual(row[0].slice(0, row[0].indexOf('Currently planned')),
        earliestRow.slice(0, earliestRow.indexOf('Earliest delivery')), 'the same label markup');
    [PAST, ''].forEach(function (key) {
        var b = sendLink(function (x) { x.orders[100].custbody_defaultshipdate = key; }).emails[0].body;
        assert.ok(b.indexOf('Earliest delivery</font>') > 0);
        assert.strictEqual(b.indexOf('Currently planned'), -1, key || 'blank');
    });
});

// ---------------------------------------------------------------- no new reads

test('no new search or lookup: the same reads with and without a forecast date', function () {
    function count(run) {
        var calls = [];
        var w = ns.world();
        var s;
        w.orders[100].custbody_defaultshipdate = run.key;
        s = ns.stubs(w);
        ['create', 'lookupFields'].forEach(function (fn) {
            var real = s['N/search'][fn];
            s['N/search'][fn] = function (o) { calls.push(fn + ':' + o.type); return real(o); };
        });
        var realLoad = s['N/record'].load;
        s['N/record'].load = function (o) { calls.push('load:' + o.type); return realLoad(o); };
        var p = { t: amd.load('lib/cdb_lib_token', s).sign(42, 0) };
        Object.keys(run.params).forEach(function (k) { p[k] = run.params[k]; });
        amd.load('cdb_sl_dashboard', s).onRequest({ request: { method: 'GET', parameters: p },
            response: { setHeader: function () {}, write: function () {} } });
        return calls;
    }
    [{}, { a: 'delivery', so: '100' }].forEach(function (params) {
        assert.deepStrictEqual(count({ key: FUTURE, params: params }), count({ key: '', params: params }), JSON.stringify(params));
    });
});
