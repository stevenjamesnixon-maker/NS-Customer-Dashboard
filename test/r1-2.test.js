'use strict';
/**
 * Release 1.2: amount to pay, pay up front vs account, the header person, the logo, the order
 * lines, the type labels, the Task and the fail-safe extras search. Numbered as the brief's table.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');
var fx = require('./helpers/fixtures');

var PURE = { 'N/search': {}, 'N/record': {}, 'N/format': {}, 'N/runtime': {}, 'N/log': {} };
var data = amd.load('lib/cdb_lib_data', PURE);
var render = amd.load('lib/cdb_lib_render');
var config = amd.load('lib/cdb_lib_config', { 'N/runtime': {} });
var dates = amd.load('lib/cdb_lib_dates');

var ACCOUNT_ID = '7';

// ---------------------------------------------------------------- harness

function run(sl, method, params) {
    var out = { html: '' };
    sl.onRequest({
        request: { method: method, parameters: params },
        response: { setHeader: function () {}, write: function (o) { out.html += o.output; } }
    });
    return out.html;
}

/**
 * A customer whose order SO100 has extras. terms '9' is pay up front, '10' an account.
 */
function setup(opts) {
    var o = opts || {};
    var w = ns.world();
    var so = w.orders[100];
    so.quoteDescription = o.description === undefined ? 'Underfloor heating Ground floor' : o.description;
    so.terms = o.terms === undefined ? '9' : o.terms;
    // Amendment 2: the customer's current terms. By default the same as the order's, as when the
    // order was created (an order copies the customer's terms and keeps them).
    w.customers[42].terms = o.customerTerms === undefined ? so.terms : o.customerTerms;
    so.custbody_unique_so_ref = o.ref || '';
    so.custbodycustbody_sys_bal_incvat = o.balance === undefined ? '1234.5' : o.balance;
    so.total = o.total || '';
    so.custbody_deposit_total = o.deposit || '';
    w.paramOverrides = {
        custscript_cdb_prepay_terms: o.prepayTerms === undefined ? '9' : o.prepayTerms,
        custscript_cdb_pay_account: o.payAccount === undefined ? ACCOUNT_ID : o.payAccount,
        custscript_cdb_quote_type_labels: o.labels === undefined ? '' : o.labels,
        custscript_cdb_logo_url: o.logo || ''
    };
    w.extrasThrow = !!o.extrasThrow;
    if (o.tweak) { o.tweak(w); }
    var s = ns.stubs(w);
    return { w: w, sl: amd.load('cdb_sl_dashboard', s), tok: amd.load('lib/cdb_lib_token', s).sign(42, 0) };
}

function form(tok, extra) {
    var f = { t: tok, a: 'delivery', so: '100', date: dates.firstAllowedDate(dates.londonTodayKey(Date.now()), 3, {}),
        time: '5', address: '900', vehicle: '2', unload: '3', contactName: 'Sam Site', contactPhone: '07700 900000',
        contactEmail: '', requests: 'Gate code 1234', payment: 'BACS' };
    Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
    return f;
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function paymentValues(html) {
    return (html.match(/name="payment" value="([A-Z]+)"/g) || []).map(function (m) { return m.replace(/.*value="|"/g, ''); });
}

// ---------------------------------------------------------------- 1-2 money

test('1. amountToPay: balance, zero balance, total less deposit, nothing, negative', function () {
    var odd = [];
    var onOdd = function (why) { odd.push(why); };
    assert.deepStrictEqual(data.amountToPay({ balance: '1234.5' }, onOdd), { amount: 1234.5, basis: 'balance' });
    assert.deepStrictEqual(data.amountToPay({ balance: '0', total: '2000' }, onOdd), { amount: 0, basis: 'balance' },
        '0 is a real balance');
    assert.strictEqual(render.amountText({ amount: 0, basis: 'balance' }), 'Nothing left to pay on this order');
    assert.deepStrictEqual(data.amountToPay({ balance: '', total: '2000', deposit: '500' }, onOdd),
        { amount: 1500, basis: 'total_less_deposit' });
    assert.deepStrictEqual(data.amountToPay({ balance: '', total: '2000', deposit: '' }, onOdd),
        { amount: 2000, basis: 'total_less_deposit' });
    assert.strictEqual(data.amountToPay({ balance: '', total: '', deposit: '500' }, onOdd), null);
    assert.strictEqual(data.amountToPay(null, onOdd), null);
    assert.strictEqual(odd.length, 0);
    assert.strictEqual(data.amountToPay({ balance: '-25' }, onOdd), null);
    assert.strictEqual(data.amountToPay({ total: '100', deposit: '250' }, onOdd), null);
    assert.strictEqual(odd.length, 2);
    assert.deepStrictEqual(data.amountToPay({ balance: 'n/a', total: '10' }), { amount: 10, basis: 'total_less_deposit' },
        'a non-numeric balance is treated as unset');
});

test('1b. a negative amount is logged as CDB AMOUNT_ODD and not shown', function () {
    var s = setup({ balance: '-40' });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.strictEqual(logs(s.w, 'AMOUNT_ODD').length, 1);
    assert.strictEqual(html.indexOf('Amount to pay'), -1);
    assert.strictEqual(html.indexOf('£0.00'), -1);
});

test('2. currency format', function () {
    assert.strictEqual(render.formatMoney(1234.5), '£1,234.50');
    assert.strictEqual(render.formatMoney(1000000), '£1,000,000.00');
    assert.strictEqual(render.formatMoney(0.1), '£0.10');
    assert.strictEqual(render.formatMoney(999), '£999.00');
});

// ---------------------------------------------------------------- 3-8 terms

test('3. extras search throws: pages render, no amount, pay-up-front options, EXTRAS_FAILED once per request', function () {
    var s = setup({ extrasThrow: true, terms: '10' });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('Arrange delivery</h1>') > 0);
    assert.strictEqual(html.indexOf('Amount to pay'), -1);
    assert.deepStrictEqual(paymentValues(html), ['BACS', 'CARD'], 'fail closed: pay up front');
    assert.strictEqual(logs(s.w, 'EXTRAS_FAILED').length, 1);
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Projects for delivery') > 0, 'the dashboard renders too');
    assert.strictEqual(logs(s.w, 'EXTRAS_FAILED').length, 2, 'once more for the second request');
});

test('4. terms table (amendment 2): the customer AND the order must say account', function () {
    var cfg = { PREPAY_TERMS: ['9'], PAY_ACCOUNT: ACCOUNT_ID };
    // customer prepay, order anything -> pay up front
    assert.strictEqual(data.isPrepay('9', { termsId: '10' }, cfg), true, 'customer moved to prepay; old credit order');
    assert.strictEqual(data.isPrepay('9', { termsId: '9' }, cfg), true);
    // customer blank -> pay up front (fail closed)
    assert.strictEqual(data.isPrepay('', { termsId: '10' }, cfg), true, 'blank customer terms');
    // customer credit, order prepay -> pay up front (staff made this order pay up front)
    assert.strictEqual(data.isPrepay('10', { termsId: '9' }, cfg), true);
    // customer credit, order credit or blank -> account
    assert.strictEqual(data.isPrepay('10', { termsId: '10' }, cfg), false);
    assert.strictEqual(data.isPrepay('10', { termsId: '' }, cfg), false, 'blank order terms on a credit customer');
    // the fail-closed rules on top
    assert.strictEqual(data.isPrepay('10', undefined, cfg), true, 'extras search failed');
    assert.strictEqual(data.isPrepay('10', { termsId: '10' }, { PREPAY_TERMS: [], PAY_ACCOUNT: ACCOUNT_ID }), true);
    assert.strictEqual(data.isPrepay('10', { termsId: '10' }, { PREPAY_TERMS: ['9'], PAY_ACCOUNT: '' }), true);
});

test('4b. customer 215781\'s case end to end: moved to prepay, old credit order offers Card, not account', function () {
    var s = setup({ terms: '10', customerTerms: '9' });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.deepStrictEqual(paymentValues(html), ['BACS', 'CARD']);
    // A credit customer with a credit order still gets the account option.
    s = setup({ terms: '10', customerTerms: '10' });
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.deepStrictEqual(paymentValues(html), ['BACS', 'ACCOUNT']);
    // Blank customer terms: pay up front.
    s = setup({ terms: '10', customerTerms: '' });
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.deepStrictEqual(paymentValues(html), ['BACS', 'CARD']);
});

test('6b. tampered ACCOUNT from a customer whose own terms are prepay: field error, nothing written', function () {
    var s = setup({ terms: '10', customerTerms: '9' });
    var html = run(s.sl, 'POST', form(s.tok, { payment: 'ACCOUNT' }));
    assert.ok(html.indexOf('Please choose one of the payment options shown.') > 0);
    assert.strictEqual(s.w.saves.length, 0);
    assert.strictEqual(s.w.tasks.length, 0);
});

test('6c. the SO_UPDATED and Task logs record both term IDs', function () {
    var s = setup({ terms: '10', customerTerms: '10' });
    run(s.sl, 'POST', form(s.tok, { payment: 'ACCOUNT' }));
    var so = logs(s.w, 'SO_UPDATED')[0][2];
    var task = logs(s.w, 'TASK_CREATED')[0][2];
    [so, task].forEach(function (d) {
        assert.ok(d.indexOf('terms: customer 10, order 10 -> account') >= 0, d.slice(0, 200));
    });
});

test('5. an account customer\'s form: BACS and Add to my account, no Card; the amount with the BACS-only hint', function () {
    var s = setup({ terms: '10' });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.deepStrictEqual(paymentValues(html), ['BACS', 'ACCOUNT']);
    assert.ok(html.indexOf('>Add to my account<') > 0);
    assert.ok(html.indexOf('We’ll add this order to your account. No payment is needed now.') > 0);
    // Amendment 1: the amount is always shown when a delivery is being arranged, with a hint.
    assert.ok(html.indexOf('Amount to pay: <strong>£1,234.50</strong> including VAT') > 0);
    assert.ok(html.indexOf('Only if you’re paying by bank transfer. Choose ‘Add to my account’ and nothing is due now.') > 0);
    assert.strictEqual(html.indexOf('You pay by bank transfer, or we call you'), -1, 'no payment step');
    // And the pay-up-front form shows the amount in section 6 and the aside.
    s = setup();
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.deepStrictEqual(paymentValues(html), ['BACS', 'CARD']);
    assert.ok(html.indexOf('Amount to pay: <strong>£1,234.50</strong> including VAT') > 0);
    assert.ok(html.indexOf('<span>Amount to pay</span><span>£1,234.50</span>') > 0);
});

test('6. tampered payment: CARD from account, ACCOUNT from pay up front — field error, nothing written', function () {
    [{ terms: '10', payment: 'CARD' }, { terms: '9', payment: 'ACCOUNT' }].forEach(function (c) {
        var s = setup({ terms: c.terms });
        var html = run(s.sl, 'POST', form(s.tok, { payment: c.payment }));
        assert.ok(html.indexOf('Please choose one of the payment options shown.') > 0, c.payment);
        assert.strictEqual(s.w.saves.length, 0);
        assert.strictEqual(s.w.tasks.length, 0);
    });
});

test('7. account booking: account intent, awaiting payment not ticked, EDD written, state requested', function () {
    var s = setup({ terms: '10' });
    var html = run(s.sl, 'POST', form(s.tok, { payment: 'ACCOUNT' }));
    var saved = s.w.saves[0].values;
    assert.strictEqual(saved.custbody_cust_pay_intent, ACCOUNT_ID);
    assert.strictEqual(saved.hasOwnProperty('custbody_cdb_awaiting_payment'), false);
    assert.strictEqual(saved.custbody_edd_certainty, '3');
    assert.ok(html.indexOf('Delivery requested. We’ll add order SO100 to your account and email you to confirm the date.') > 0);
    assert.strictEqual(html.indexOf('Pay by bank transfer'), -1);
    assert.strictEqual(html.indexOf('£'), -1);
    // The order is now "requested" on the dashboard.
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="badge b-work">Delivery requested</span>') > 0);
    assert.strictEqual(html.indexOf('Payment details'), -1, 'no payment panel');
    var cfg = { PAY_ACCOUNT: ACCOUNT_ID };
    assert.strictEqual(data.orderState({ payIntent: ACCOUNT_ID }, cfg), 'requested');
    assert.strictEqual(data.orderState({ payIntent: '1' }, cfg), 'awaiting_payment');
    assert.strictEqual(data.orderState({ payIntent: ACCOUNT_ID, confirmedDateKey: '2026-10-07' }, cfg), 'booked');
    assert.strictEqual(data.orderState({ payIntent: ACCOUNT_ID }, {}), 'awaiting_payment', 'no account value configured');
});

test('7b. the email shows an account booking as Delivery requested, with no amounts', function () {
    var groups = data.groupProjects([fx.opp('4', '13', '8', { title: 'Barn' })],
        [fx.order('100', '4', { payIntent: ACCOUNT_ID, shipDateKey: '2026-10-30', timeText: 'AM delivery' })],
        Object.assign({}, fx.CFG, { PAY_ACCOUNT: ACCOUNT_ID }));
    var html = render.digestEmail({ customerName: 'A', groups: groups, payBacs: '1', link: 'https://x/l', am: {}, digestDays: 14 });
    assert.ok(html.indexOf('>Delivery requested</span>') > 0);
    // 1.3.2: the short display date, with the year only when it is not this year.
    assert.ok(html.indexOf('requested ' + amd.load('lib/cdb_lib_dates').formatDisplay('2026-10-30', amd.load('lib/cdb_lib_dates').londonTodayKey(Date.now())) + ', AM delivery') > 0);
    assert.strictEqual(html.indexOf('£'), -1);
});

test('8. account value empty with account terms: pay-up-front options (fail closed)', function () {
    var s = setup({ terms: '10', payAccount: '' });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.deepStrictEqual(paymentValues(html), ['BACS', 'CARD']);
    assert.ok(html.indexOf('Amount to pay') > 0, 'a pay-up-front order shows its amount');
});

// ---------------------------------------------------------------- 9-10 people and logo

test('9. header person is the customer\'s rep; the Task still goes to the opportunity\'s PE', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="am-name">Ray Rep') > 0, 'rep A in the header');
    assert.ok(html.indexOf('Questions? Call Ray Rep') > 0, 'and the footer');
    assert.strictEqual(html.indexOf('Pem Engineer'), -1);
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('Questions? Call Ray Rep') > 0, 'the form shows the same person');
    run(s.sl, 'POST', form(s.tok));
    assert.strictEqual(s.w.tasks[0].values.assigned, '77', 'Task to the PE (B)');
    // An inactive rep falls back.
    s = setup({ tweak: function (w) { w.employees[88].isinactive = true; } });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="am-name">Fall Back') > 0);
});

test('10. logo set / empty, on the page and in the email', function () {
    var logo = 'https://www.nu-heat.co.uk/logo-colour.png';
    var s = setup({ logo: logo });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<img src="' + logo + '" alt="Nu-Heat">') > 0);
    assert.ok(render.css().indexOf('.logo img{display:block;max-height:48px') >= 0, 'at most 48 px on the page');
    s = setup();
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="brand">Nu-Heat</span>') > 0);
    assert.ok(render.css().indexOf('.brand{font-weight:700;font-size:24px;color:#59315f}') >= 0);
    var groups = data.groupProjects([], [], fx.CFG);
    var email = render.digestEmail({ customerName: 'A', groups: groups, logoUrl: logo, link: 'https://x/l', am: {}, digestDays: 14 });
    assert.ok(email.indexOf('<img src="' + logo + '" alt="Nu-Heat" height="60"') > 0);
    assert.ok(email.indexOf('max-height:60px') > 0);
    email = render.digestEmail({ customerName: 'A', groups: groups, logoUrl: '', link: 'https://x/l', am: {}, digestDays: 14 });
    assert.ok(/<span style="[^"]*font-size:24px;font-weight:bold;color:#59315f;">Nu-Heat<\/span>/.test(email));
});

// ---------------------------------------------------------------- 11-13 order lines

test('11. a long description renders in full, with no clamp and no title attribute', function () {
    var long = 'Underfloor heating for the ground floor, first floor and loft conversion, with manifolds, ' +
        'thermostats and a weather-compensating controller for the new extension';
    var s = setup({ description: long });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="soname">' + long + '</span>') > 0);
    assert.strictEqual(/line-clamp/.test(render.css()), false);
    assert.strictEqual(html.indexOf('title="' + long), -1);
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('<span>System</span><span>' + long + '</span>') > 0, 'the aside');
});

test('12. split reference: shown / absent / cleaned', function () {
    var s = setup({ ref: 'Pipework and manifolds only' });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="soname">Underfloor heating Ground floor</span><span class="soref">Pipework and manifolds only</span><span class="meta">Order SO100') > 0);
    s = setup();
    html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(html.indexOf('class="soref"'), -1);
    s = setup({ ref: '&lt;b&gt;x&lt;/b&gt;' });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="soref">x</span>') > 0);
    assert.strictEqual(html.indexOf('&lt;b&gt;'), -1);
});

test('13. type labels: mapped / unmapped / invalid (one log)', function () {
    var s = setup({ labels: '{"1": "UFH", "2": "HP"}' });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Order SO100 · UFH<') > 0);
    s = setup({ labels: '{"2": "HP"}' });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Order SO100 · Underfloor heating system<') > 0, 'unmapped: the quote type text');
    s = setup({ labels: '{"1": "UFH"' });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Order SO100 · Underfloor heating system<') > 0);
    assert.strictEqual(logs(s.w, 'TYPE_LABELS_INVALID').length, 1);
    // Empty description falls back to the short label, and the label is not repeated.
    s = setup({ labels: '{"1": "UFH"}', description: '' });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="soname">UFH</span><span class="meta">Order SO100<') > 0);
    assert.deepStrictEqual(config.parseTypeLabels('{"1":"UFH","x":"no","3":4}').labels, { 1: 'UFH' });
});

// ---------------------------------------------------------------- 14-15 Task and searches

test('14. Task: description, split ref, payment choice, amount for pay up front; none for account', function () {
    var s = setup({ ref: 'Manifolds only', description: 'Underfloor heating for the whole of the ground floor and the new kitchen extension' });
    run(s.sl, 'POST', form(s.tok));
    var t = s.w.tasks[0].values;
    // The first 60 characters of the description, then an ellipsis.
    assert.strictEqual(t.title, 'Delivery requested: SO100 · Underfloor heating for the whole of the ground floor and the…');
    assert.ok(t.message.indexOf('Order: Underfloor heating for the whole of the ground floor and the new kitchen extension') >= 0);
    assert.ok(t.message.indexOf('Split reference: Manifolds only') >= 0);
    assert.ok(t.message.indexOf('Payment choice: BACS') >= 0);
    assert.ok(t.message.indexOf('Amount to pay: £1,234.50 (balance inc VAT)') >= 0);
    s = setup({ terms: '10' });
    run(s.sl, 'POST', form(s.tok, { payment: 'ACCOUNT' }));
    t = s.w.tasks[0].values;
    assert.ok(t.message.indexOf('Payment choice: Add to account') >= 0);
    assert.strictEqual(t.message.indexOf('Amount to pay'), -1);
    assert.strictEqual(t.message.indexOf('£'), -1);
    assert.strictEqual(t.assigned, '77', 'routing unchanged');
});

test('15. the main order searches carry none of the extras columns', function () {
    var s = setup();
    run(s.sl, 'GET', { t: s.tok });
    run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    var extrasCols = ['terms', 'custbody_unique_so_ref', 'custbodycustbody_sys_bal_incvat', 'total', 'custbody_deposit_total'];
    var so = s.w.searches.filter(function (d) { return d.type === 'salesorder'; });
    var extras = so.filter(function (d) { return d.columns.indexOf('terms') >= 0; });
    var main = so.filter(function (d) { return d.columns.indexOf('terms') < 0; });
    assert.strictEqual(extras.length, 2, 'one extras search per request');
    assert.ok(main.length >= 2);
    main.forEach(function (d) {
        d.columns.forEach(function (c) {
            var name = typeof c === 'string' ? c : c.name;
            assert.strictEqual(extrasCols.indexOf(name), -1, name);
        });
    });
    assert.deepStrictEqual(extras[0].columns, extrasCols);
    assert.deepStrictEqual(extras[0].filters.slice(0, 1), [['mainline', 'is', 'T']]);
});

test('16. digest: split reference and short label in the email, no amounts; labels read from the MR twin', function () {
    var w = ns.world();
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'TEST',
        custscript_cdb_digest_test_customers: '42', custscript_cdbmr_quote_type_labels: '{"1":"UFH"}',
        custscript_cdbmr_pay_account: ACCOUNT_ID };
    w.orders[100].custbody_unique_so_ref = 'Manifolds only';
    w.orders[100].custbodycustbody_sys_bal_incvat = '1234.5';
    var mr = amd.load('cdb_mr_digest', ns.stubs(w));
    mr.map({ value: JSON.stringify({ customerId: '42' }), write: function () {} });
    var body = w.emails[0].body;
    assert.ok(body.indexOf('>Manifolds only</b></font></p>') > 0);
    // No description in this fixture: line 1 falls back to the short label from the MR twin, and the
    // muted line does not repeat it.
    assert.ok(body.indexOf('color="#2b2a2e"><b>UFH</b></font></p>') > 0, 'short label as line 1');
    assert.ok(body.indexOf('>Order SO100 · ready to arrange delivery</font></p>') > 0);
    assert.strictEqual(body.indexOf('£'), -1, 'no amounts in the email');
});

// ---------------------------------------------------------------- PR #3 amendment 1

test('A1. account customer choosing BACS: the amount on the form and confirmation, and the box ticked', function () {
    var s = setup({ terms: '10' });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('<span>Amount to pay</span><span>£1,234.50</span>') > 0, 'the aside');
    html = run(s.sl, 'POST', form(s.tok, { payment: 'BACS' }));
    assert.ok(html.indexOf('<div class="srow"><span>Amount to pay</span><span>£1,234.50</span></div>') > 0, 'the bank panel');
    assert.strictEqual(s.w.saves[0].values.custbody_cdb_awaiting_payment, true);
    assert.ok(s.w.tasks[0].values.message.indexOf('Amount to pay: £1,234.50 (balance inc VAT)') >= 0, 'the Task');
    // And the awaiting-payment panel on the dashboard.
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Payment details') > 0);
    assert.ok(html.indexOf('<span>Amount to pay</span><span>£1,234.50</span>') > 0);
});

test('A2. account customer choosing Add to account: no amount anywhere, the box not ticked', function () {
    var s = setup({ terms: '10' });
    var html = run(s.sl, 'POST', form(s.tok, { payment: 'ACCOUNT' }));
    assert.strictEqual(html.indexOf('£'), -1, 'confirmation');
    assert.strictEqual(html.indexOf('Amount to pay'), -1);
    assert.strictEqual(s.w.saves[0].values.hasOwnProperty('custbody_cdb_awaiting_payment'), false);
    assert.strictEqual(s.w.tasks[0].values.message.indexOf('£'), -1, 'Task');
    html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(html.indexOf('£'), -1, 'dashboard');
});

test('A3. the card confirmation names no employee', function () {
    var s = setup();
    var html = run(s.sl, 'POST', form(s.tok, { payment: 'CARD' }));
    assert.ok(html.indexOf('We’ll call you to take <strong>£1,234.50</strong>. We never ask for card details online.') > 0);
    Object.keys(s.w.employees).forEach(function (id) {
        var e = s.w.employees[id];
        [e.firstname + ' ' + e.lastname, e.firstname, e.email, e.phone].forEach(function (t) {
            assert.strictEqual(html.indexOf(t), -1, t);
        });
    });
    assert.ok(s.w.tasks[0].values.message.indexOf('Amount to pay: £1,234.50') >= 0, 'the Task has the amount for Card');
    assert.strictEqual(render.confirmation({ payment: 'CARD', bank: {}, tranId: 'SO1', backUrl: 'u', am: { name: 'Pat Lee' } })
        .indexOf('We’ll call you to take payment.') > 0, true, 'no amount: "take payment"');
});

// ---------------------------------------------------------------- PR #3 amendment 2: contact fallback

function withRep(phone, email, name) {
    return function (w) {
        w.employees[88].phone = phone;
        w.employees[88].email = email;
        if (name === '') { w.employees[88].firstname = ''; w.employees[88].lastname = ''; }
    };
}

test('B1. page contact: phone / email only / neither / no name', function () {
    var s = setup({ tweak: withRep('0202', 'ray@example.com') });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span>Questions? Call Ray Rep on <a href="tel:0202">0202</a>.</span>') > 0, 'footer');
    assert.ok(html.indexOf('<span class="am-name">Ray Rep · <a href="tel:0202">0202</a></span>') > 0, 'header');
    assert.ok(html.indexOf('class="am-call" href="tel:0202"') > 0);

    s = setup({ tweak: withRep('', 'ray@example.com') });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span>Questions? Email Ray Rep at <a href="mailto:ray@example.com">ray@example.com</a>.</span>') > 0);
    assert.ok(html.indexOf('<span class="am-name">Ray Rep · <a href="mailto:ray@example.com">ray@example.com</a></span>') > 0);
    assert.ok(html.indexOf('class="am-call" href="mailto:ray@example.com" aria-label="Email your account manager') > 0);
    assert.strictEqual(html.indexOf('Questions? Call'), -1);
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('<span class="hq">Questions? Email Ray Rep at <a href="mailto:ray@example.com">') > 0, 'delivery header');

    s = setup({ tweak: withRep('', '') });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span>Questions? Contact Ray Rep.</span>') > 0);
    assert.ok(html.indexOf('<span class="am-name">Ray Rep</span>') > 0);
    assert.strictEqual(html.indexOf('class="am-call"'), -1, 'no button that goes nowhere');

    assert.strictEqual(render.questionsLine({ name: '', phone: '0202' }), '', 'no name: no line');
});

test('B2. email contact: footer and AM card, phone / email only / neither / no name', function () {
    // 2.0.2: the footer line sits in the Send Quote footer (</font></p>); the AM card shows the phone
    // and the email on their own lines, and only the buttons it has values for.
    var groups = data.groupProjects([], [], fx.CFG);
    function email(am) {
        return render.digestEmail({ customerName: 'A', groups: groups, link: 'https://x/l', am: am, digestDays: 14 });
    }
    var html = email({ name: 'Ray Rep', phone: '0202', email: 'ray@example.com' });
    assert.ok(html.indexOf('reply to this email or call Ray Rep on 0202.</font></p>') > 0);
    assert.ok(html.indexOf('<span class="cl-line">0202</span><span class="cl-sep"> · </span><span class="cl-line">ray@example.com</span>') > 0,
        'the AM card keeps both when both exist');

    html = email({ name: 'Ray Rep', phone: '', email: 'ray@example.com' });
    assert.ok(html.indexOf('reply to this email or email Ray Rep at <a href="mailto:ray@example.com" style="color:#e6f3f1;"><font color="#e6f3f1">ray@example.com</font></a>.</font></p>') > 0,
        '2.0.3: the link in the teal footer\'s text colour');
    assert.strictEqual(html.indexOf('or call'), -1);

    html = email({ name: 'Ray Rep', phone: '', email: '' });
    assert.ok(html.indexOf('reply to this email or contact Ray Rep.</font></p>') > 0);

    html = email({ name: '', phone: '0202', email: '' });
    assert.ok(html.indexOf('To stop these updates, reply to this email.</font></p>') > 0);
});
