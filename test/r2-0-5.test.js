'use strict';
/**
 * Release 2.0.5 (PR #5 amendment 5): the amount to pay is the system balances only —
 * custbodycustbody_sys_bal_incvat (inc VAT, after deposits) and custbody_sys_bal_exvat (ex VAT).
 * One text everywhere it shows: "£x inc VAT (£y ex VAT)".
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var dates = amd.load('lib/cdb_lib_dates');
var render = amd.load('lib/cdb_lib_render');

function run(sl, method, params) {
    var out = '';
    sl.onRequest({ request: { method: method, parameters: params },
        response: { setHeader: function () {}, write: function (o) { out += o.output; } } });
    return out;
}

function form(tok, payment) {
    return { t: tok, a: 'delivery', so: '100', date: dates.firstAllowedDate(dates.londonTodayKey(Date.now()), 3, {}),
        time: '5', address: '900', vehicle: '2', unload: '3', contactName: 'Sam Site', contactPhone: '07700 900000',
        contactEmail: '', requests: '', payment: payment };
}

function world(inc, ex) {
    var w = ns.world();
    w.orders[100].custbodycustbody_sys_bal_incvat = inc;
    w.orders[100].custbody_sys_bal_exvat = ex;
    // The old fallback's fields, set to values that would give a different figure: never read.
    w.orders[100].total = '9999';
    w.orders[100].custbody_deposit_total = '1';
    return w;
}

function dashboard(w) {
    var s = ns.stubs(w);
    return { sl: amd.load('cdb_sl_dashboard', s), tok: amd.load('lib/cdb_lib_token', s).sign(42, 0) };
}

function sendLinkEmail(inc, ex) {
    var w = world(inc, ex);
    w.scriptId = 'customscript_cdb_sl_send_link';
    w.params = { custscript_cdbsend_excluded_statuses: '90', custscript_cdbsend_excluded_quote_types: '7,8',
        custscript_cdbsend_fallback_employee: '500' };
    run(amd.load('cdb_sl_send_link', ns.stubs(w)), 'GET', { so: '100' });
    return { w: w, body: w.emails[0].body };
}

/**
 * Every place an amount shows, for one pair of balances: the delivery form (section 6 and the aside),
 * the BACS confirmation, the Task, the dashboard's BACS panel, the card confirmation, the dashboard's
 * card panel, and the delivery-link email.
 */
function everywhere(inc, ex) {
    var out = {};
    var w = world(inc, ex);
    var d = dashboard(w);
    out.form = run(d.sl, 'GET', { t: d.tok, a: 'delivery', so: '100' });
    out.bacsConfirmation = run(d.sl, 'POST', form(d.tok, 'BACS'));
    out.task = w.tasks[0].values.message;
    out.bacsPanel = run(d.sl, 'GET', { t: d.tok });
    w = world(inc, ex);
    d = dashboard(w);
    out.cardConfirmation = run(d.sl, 'POST', form(d.tok, 'CARD'));
    out.cardPanel = run(d.sl, 'GET', { t: d.tok });
    out.email = sendLinkEmail(inc, ex).body;
    return out;
}

var BOTH = '£1,234.50 inc VAT (£1,028.75 ex VAT)';

test('inc and ex set: both shown, identically, everywhere an amount shows', function () {
    var p = everywhere('1234.5', '1028.75');
    assert.ok(p.form.indexOf('Amount to pay: <strong>' + BOTH + '</strong></p>') > 0, 'form, section 6');
    assert.ok(p.form.indexOf('<span>Amount to pay</span><span>' + BOTH + '</span>') > 0, 'form, the aside');
    assert.ok(p.bacsConfirmation.indexOf('<div class="srow"><span>Amount to pay</span><span>' + BOTH + '</span></div>') > 0, 'BACS confirmation');
    assert.ok(p.task.indexOf('Amount to pay: ' + BOTH + '\n') >= 0, 'the Task');
    assert.ok(p.bacsPanel.indexOf('<span>Amount to pay</span><span>' + BOTH + '</span>') > 0, 'dashboard BACS panel');
    assert.ok(p.cardConfirmation.indexOf('We’ll call you to take <strong>' + BOTH + '</strong>.') > 0, 'card confirmation');
    assert.ok(p.cardPanel.indexOf('We’ll call you to take <strong>' + BOTH + '</strong>.') > 0, 'dashboard card panel');
    assert.ok(p.email.indexOf('<b>' + BOTH + '</b>') > 0, 'delivery-link email');
    // One wording: no "basis" text, no "including VAT" after the figure, nothing from the old fallback.
    Object.keys(p).forEach(function (k) {
        ['(balance inc VAT)', 'total inc VAT less deposit', 'including VAT', '£9,998', '£9,999'].forEach(function (t) {
            assert.strictEqual(p[k].indexOf(t), -1, k + ': ' + t);
        });
    });
});

test('inc set, ex blank: inc only', function () {
    var p = everywhere('1234.5', '');
    assert.ok(p.form.indexOf('Amount to pay: <strong>£1,234.50 inc VAT</strong></p>') > 0);
    assert.ok(p.task.indexOf('Amount to pay: £1,234.50 inc VAT\n') >= 0);
    assert.ok(p.email.indexOf('<b>£1,234.50 inc VAT</b>') > 0);
    Object.keys(p).forEach(function (k) { assert.strictEqual(p[k].indexOf('ex VAT'), -1, k); });
});

test('inc blank, ex set: no amount anywhere (no fallback)', function () {
    var p = everywhere('', '1028.75');
    Object.keys(p).forEach(function (k) {
        assert.strictEqual(p[k].indexOf('£'), -1, k);
        assert.strictEqual(p[k].indexOf('Amount to pay'), -1, k);
    });
    assert.ok(p.cardConfirmation.indexOf('We’ll call you to take payment.') > 0);
});

test('0: "Nothing left to pay on this order"', function () {
    var p = everywhere('0', '0');
    assert.ok(p.form.indexOf('Nothing left to pay on this order.') > 0);
    assert.ok(p.task.indexOf('Amount to pay: Nothing left to pay on this order') >= 0);
    assert.ok(p.cardConfirmation.indexOf('Nothing left to pay on this order. We’ll be in touch') > 0);
    assert.ok(p.email.indexOf('<b>Nothing left to pay on this order</b>') > 0);
    Object.keys(p).forEach(function (k) { assert.strictEqual(p[k].indexOf('£0.00'), -1, k); });
});

test('negative: no amount, and one CDB AMOUNT_ODD line', function () {
    var w = world('-40', '-33.33');
    var d = dashboard(w);
    var html = run(d.sl, 'GET', { t: d.tok, a: 'delivery', so: '100' });
    var odd = w.logs.filter(function (l) { return l[1] === 'CDB AMOUNT_ODD'; });
    assert.strictEqual(html.indexOf('Amount to pay'), -1);
    assert.strictEqual(odd.length, 1);
    assert.ok(odd[0][2].indexOf('negative balance: inc VAT "-40"') >= 0);
    var e = sendLinkEmail('-40', '-33.33');
    assert.strictEqual(e.body.indexOf('Amount to pay'), -1);
    assert.strictEqual(e.w.logs.filter(function (l) { return l[1] === 'CDB AMOUNT_ODD'; }).length, 1, 'the send link too');
    assert.strictEqual(render.amountText(null), '');
});

test('the extras search reads the two balances and no total or deposit column', function () {
    var w = world('1234.5', '1028.75');
    var d = dashboard(w);
    run(d.sl, 'GET', { t: d.tok, a: 'delivery', so: '100' });
    var extras = w.searches.filter(function (s) { return s.type === 'salesorder' && s.columns.indexOf('terms') >= 0; });
    assert.strictEqual(extras.length, 1);
    assert.deepStrictEqual(extras[0].columns, ['terms', 'custbody_unique_so_ref', 'custbodycustbody_sys_bal_incvat', 'custbody_sys_bal_exvat']);
    w.searches.forEach(function (s) {
        (s.columns || []).forEach(function (c) {
            var name = typeof c === 'string' ? c : c.name;
            assert.ok(name !== 'total' && name !== 'custbody_deposit_total', name);
        });
    });
});
