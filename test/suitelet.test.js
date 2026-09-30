'use strict';
/**
 * The Suitelet end to end against an in-memory NetSuite stub: the dashboard, the form, a rejected
 * POST, a valid POST, a resubmit and another customer's order. It mirrors Sandbox scenarios 1, 3,
 * 4, 5, 6 and 7; it does not replace them. The stub is only as faithful as its author.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');

var ns = require('./helpers/netsuite');
var world = ns.world;
var stubs = ns.stubs;
var keyOf = ns.keyOf;

function run(sl, method, params) {
    var out = { headers: {}, html: '' };
    sl.onRequest({
        request: { method: method, parameters: params },
        response: { setHeader: function (h) { out.headers[h.name] = h.value; }, write: function (o) { out.html += o.output; } }
    });
    return out.html;
}

function setup() {
    var w = world();
    var s = stubs(w);
    var sl = amd.load('cdb_sl_dashboard', s);
    var tok = amd.load('lib/cdb_lib_token', s).sign(42, 0);
    return { w: w, sl: sl, tok: tok };
}

/** A valid date: the first allowed one from today (London). */
function validDate() {
    var dates = amd.load('lib/cdb_lib_dates');
    var today = dates.londonTodayKey(Date.now());
    return { first: dates.firstAllowedDate(today, 3, {}), today: today, dates: dates };
}

function form(extra) {
    var f = { a: 'delivery', so: '100', date: validDate().first, time: '5', address: '900', vehicle: '2', unload: '3',
        contactName: 'Sam Site', contactPhone: '07700 900000', contactEmail: 'sam@example.com',
        requests: 'Ring first', payment: 'BACS' };
    Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
    return f;
}

test('dashboard: sections, billed SO hidden, header is the customer\'s rep', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Projects for delivery') > 0, html);
    assert.ok(html.indexOf('SO100') > 0);
    assert.ok(html.indexOf('SO101') === -1, 'billed order not shown');
    // 1.2 (§4): the header shows the customer's own sales rep, not the opportunity's PE.
    assert.ok(html.indexOf('Ray Rep') > 0, 'customer rep');
    assert.strictEqual(html.indexOf('Pem Engineer'), -1);
    assert.ok(s.w.logs.some(function (l) { return l[1] === 'CDB USAGE'; }));
});

test('tampered token: generic page and audit', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok.slice(0, -2) + 'xx' });
    assert.ok(html.indexOf('This link is no longer valid') > 0);
    assert.ok(s.w.logs.some(function (l) { return l[1] === 'CDB INVALID_LINK'; }));
});

test('delivery form renders with calendar and prefill', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('value="' + validDate().first + '"') > 0, 'first date offered');
    assert.ok(html.indexOf('value="Old Name"') > 0, 'contact prefilled');
    assert.ok(/<option value="901" selected>/.test(html), 'address defaults to the SO');
});

test('POST with a date before the first allowed date is rejected, input kept, nothing saved', function () {
    var s = setup();
    var v = validDate();
    var html = run(s.sl, 'POST', form({ t: s.tok, date: v.today }));
    assert.ok(html.indexOf('Please choose one of the available dates') > 0);
    assert.ok(html.indexOf('value="Sam Site"') > 0);
    assert.strictEqual(s.w.saves.length, 0);
    assert.strictEqual(s.w.tasks.length, 0);
});

test('valid BACS POST: SO fields, no del_date/finance status, Task to the PE, confirmation; resubmit is safe', function () {
    var s = setup();
    var html = run(s.sl, 'POST', form({ t: s.tok }));
    var save = s.w.saves[0];
    assert.ok(html.indexOf('<div class="srow ref"><span>Reference</span><span>SO100</span></div>') > 0, html);
    assert.strictEqual(s.w.saves.length, 1);
    assert.deepStrictEqual(Object.keys(save.values).sort(), [
        'custbody_cust_booking_req', 'custbody_cust_pay_intent', 'custbody_defaultshipdate', 'custbody_del_contact',
        'custbody_del_time_per', 'custbody_delivery_con_email', 'custbody_delivery_con_num', 'custbody_delivery_veh',
        'custbody_special_requests', 'custbody_unload_req', 'shipaddresslist',
        // 1.1: the two optional fields, present on this stub record.
        'custbody_cdb_awaiting_payment', 'custbody_edd_certainty'].sort());
    assert.strictEqual(save.opts.ignoreMandatoryFields, true);
    assert.strictEqual(keyOf(save.values.custbody_defaultshipdate), validDate().first);
    assert.strictEqual(save.values.custbody_cust_pay_intent, '1');
    assert.strictEqual(s.w.tasks.length, 1);
    assert.strictEqual(s.w.tasks[0].values.assigned, '77');
    assert.strictEqual(s.w.tasks[0].values.transaction, '4', 'the opportunity');
    assert.strictEqual(s.w.tasks[0].values.company, '42');
    // 1.2 (§7): the title carries the description, not the customer name.
    assert.strictEqual(s.w.tasks[0].values.title, 'Delivery requested: SO100 · Underfloor heating system');
    assert.ok(s.w.tasks[0].values.message.indexOf('Old Name → Sam Site') > 0);

    html = run(s.sl, 'POST', form({ t: s.tok }));
    assert.ok(html.indexOf('already requested delivery for order SO100') > 0, 'already requested');
    assert.strictEqual(s.w.tasks.length, 1, 'no second Task');
    assert.strictEqual(s.w.saves.length, 1);
});

test('card booking: card confirmation', function () {
    var s = setup();
    var html = run(s.sl, 'POST', form({ t: s.tok, payment: 'CARD' }));
    // 1.2 (§4): the confirmation names the header person, the customer's rep; the Task still goes to the PE.
    assert.ok(html.indexOf('Ray Rep, will call you to take payment') > 0);
});

test('another customer\'s SO in the URL is refused', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '200' });
    assert.ok(html.indexOf('t be booked online') > 0);
    run(s.sl, 'POST', form({ t: s.tok, so: '200' }));
    assert.strictEqual(s.w.saves.length, 0);
    assert.ok(s.w.logs.some(function (l) { return l[1] === 'CDB GUARD_REFUSED' && /another customer/.test(l[2]); }));
});

test('a Task failure keeps the SO change and still confirms', function () {
    var s = setup();
    var st = stubs(s.w);
    st['N/record'].create = function () { throw new Error('boom'); };
    var sl = amd.load('cdb_sl_dashboard', st);
    var html = run(sl, 'POST', form({ t: s.tok }));
    assert.strictEqual(s.w.saves.length, 1);
    assert.ok(html.indexOf('Delivery requested') > 0);
    assert.ok(s.w.logs.some(function (l) { return l[0] === 'error' && l[1] === 'CDB TASK_FAILED'; }));
});
