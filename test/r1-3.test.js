'use strict';
/**
 * Release 1.3: released orders stay visible, the state precedence, and recent deliveries — shown
 * since 1.3.2 in the one "Booked deliveries" section (amendment 2 renamed it from "Recently delivered").
 * Numbered as the brief's table.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');
var fx = require('./helpers/fixtures');

var PURE = { 'N/search': {}, 'N/record': {}, 'N/format': {}, 'N/runtime': {}, 'N/log': {} };
var data = amd.load('lib/cdb_lib_data', PURE);
var render = amd.load('lib/cdb_lib_render');
var dates = amd.load('lib/cdb_lib_dates');

var TODAY = dates.londonTodayKey(Date.now());
var CFG = Object.assign({}, fx.CFG, { EXCLUDED_STATUSES: ['2', '16', '90'], RELEASED_STATUSES: ['2'],
    RECENT_HIDDEN_STATUSES: ['3', '7'] });

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

/** A shipped order of customer 42 on opportunity 4. */
function delivered(id, extra) {
    var o = { tranid: 'SO' + id, status: 'SalesOrd:G', entity: '42', opportunity: '4', custbody_finance_status: '20',
        custbody_quote_type: '1', custbody_del_date: '', custbody_defaultshipdate: '', custbody_cust_pay_intent: '',
        custbody_ready_for_delivery: false, quoteDescription: 'Heat pump system' };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}

function setup(opts) {
    var o = opts || {};
    var w = ns.world();
    w.paramOverrides = {
        custscript_cdb_excluded_statuses: '2,16,90',
        custscript_cdb_released_statuses: o.released === undefined ? '2' : o.released,
        custscript_cdb_recent_hidden_statuses: '3,7',
        custscript_cdb_recent_days: o.days === undefined ? '' : o.days
    };
    w.recentThrow = !!o.recentThrow;
    if (o.tweak) { o.tweak(w); }
    var s = ns.stubs(w);
    return { w: w, sl: amd.load('cdb_sl_dashboard', s), tok: amd.load('lib/cdb_lib_token', s).sign(42, 0) };
}

function released(w, extra) {
    var so = w.orders[100];
    so.custbody_finance_status = '2';
    Object.keys(extra || {}).forEach(function (k) { so[k] = extra[k]; });
}

// ---------------------------------------------------------------- 1-7 released

test('1. Record Status 2, released 2, excluded contains 2: open, released, "Being prepared"', function () {
    var order = fx.order('100', '4', { recordStatus: '2', ready: true });
    assert.strictEqual(data.isOpenOrder(order, CFG), true);
    assert.strictEqual(data.orderState(order, CFG), 'released');
    var s = setup({ tweak: function (w) { released(w, { custbody_defaultshipdate: '2026-10-13', custbody_del_time_per: '2' }); } });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="badge b-ready">Being prepared</span>') > 0);
    assert.ok(html.indexOf('We’re preparing your delivery for Tue 13 Oct, AM delivery') > 0);
    s = setup({ tweak: function (w) { released(w); } });
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="meta">We’re preparing your delivery</span>') > 0, 'no ship date');
});

test('2. released list empty: not open (today\'s behaviour)', function () {
    var order = fx.order('100', '4', { recordStatus: '2' });
    assert.strictEqual(data.isOpenOrder(order, Object.assign({}, CFG, { RELEASED_STATUSES: [] })), false);
    var s = setup({ released: '', tweak: function (w) { released(w); } });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(html.indexOf('SO100'), -1);
});

test('3. Record Status 2 and a confirmed date: booked', function () {
    assert.strictEqual(data.orderState(fx.order('100', '4', { recordStatus: '2', confirmedDateKey: '2026-10-07' }), CFG), 'booked');
});

test('4. released with Awaiting customer payment ticked and a BACS intent: released, no payment panel', function () {
    var order = fx.order('100', '4', { recordStatus: '2', payIntent: '1' });
    assert.strictEqual(data.orderState(order, CFG), 'released');
    var s = setup({ tweak: function (w) { released(w, { custbody_cust_pay_intent: '1', custbody_cdb_awaiting_payment: true }); } });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Being prepared') > 0);
    assert.strictEqual(html.indexOf('Payment details'), -1);
    assert.strictEqual(html.indexOf('Awaiting payment'), -1);
});

test('5. released: no Arrange delivery, not in the callout, and the guard refuses it by URL', function () {
    var s = setup({ tweak: function (w) { released(w); } });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(html.indexOf('Arrange delivery</a>'), -1);
    var groups = data.groupProjects([fx.opp('4', '13', '8')], [fx.order('100', '4', { recordStatus: '2', ready: true }),
        fx.order('101', '4', { confirmedDateKey: '2026-10-07' })], CFG);
    assert.strictEqual(render.digestCallout(groups, '1'), '', 'released and booked need nothing');
    var email = render.digestEmail({ customerName: 'A', groups: groups, payBacs: '1', link: 'https://x/l', am: {}, digestDays: 14 });
    assert.ok(email.indexOf('>Being prepared</span>') > 0);
    // 1.3.2: customer-facing dates are short, with the year only when it is not this year.
    assert.ok(email.indexOf('Delivery booked · ' + dates.formatDisplay('2026-10-07', TODAY)) > 0);
    run(s.sl, 'POST', { t: s.tok, a: 'delivery', so: '100', date: TODAY, time: '5', address: '900', vehicle: '2', unload: '3',
        contactName: 'S', contactPhone: '07700 900000', payment: 'BACS' });
    assert.strictEqual(s.w.saves.length, 0, 'nothing written');
    assert.ok(logs(s.w, 'GUARD_REFUSED').some(function (l) { return /released/.test(l[2]); }));
});

test('6. another excluded status (16) with released 2: still not open', function () {
    assert.strictEqual(data.isOpenOrder(fx.order('100', '4', { recordStatus: '16' }), CFG), false);
});

test('7. the Record Status filter has the released OR-branch only when the list is set', function () {
    var withList = JSON.stringify(data.recordStatusFilter(CFG));
    var without = JSON.stringify(data.recordStatusFilter(Object.assign({}, CFG, { RELEASED_STATUSES: [] })));
    assert.strictEqual(without, '[["custbody_finance_status","anyof","@NONE@"],"OR",["custbody_finance_status","noneof",["2","16","90"]]]');
    assert.strictEqual(withList, '[["custbody_finance_status","anyof","@NONE@"],"OR",["custbody_finance_status","noneof",["2","16","90"]],' +
        '"OR",["custbody_finance_status","anyof",["2"]]]');
});

// ---------------------------------------------------------------- 8-15 recently delivered

function withRecent(order) {
    return function (w) { w.orders[300] = order; };
}

test('8. confirmed date 3 days ago, Billed: shown, "Delivered {date}"', function () {
    var day = dates.addDays(TODAY, -3);
    var s = setup({ tweak: withRecent(delivered(300, { custbody_del_date: day })) });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<h2>Booked deliveries</h2>') > 0);
    assert.ok(html.indexOf('Nothing needed from you. Delivered orders stay here for 7 days.') > 0);
    assert.ok(html.indexOf('<span class="badge b-ready">Delivered</span>') > 0);
    assert.ok(html.indexOf('Delivered ' + dates.formatDisplay(day, TODAY)) > 0);
    assert.ok(html.indexOf('<span class="soname">Heat pump system</span>') > 0);
    assert.ok(html.indexOf('Booked deliveries') > html.indexOf('Projects for delivery'), 'last');
    assert.strictEqual(html.slice(html.indexOf('Booked deliveries')).indexOf('£'), -1, 'no amounts');
});

test('9. no confirmed date, ship date 6 days ago: shown on the ship date', function () {
    var s = setup({ tweak: withRecent(delivered(300, { custbody_defaultshipdate: dates.addDays(TODAY, -6) })) });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<h2>Booked deliveries</h2>') > 0);
});

test('10. 8 days ago with N = 7, or tomorrow: not shown', function () {
    [dates.addDays(TODAY, -8), dates.addDays(TODAY, 1)].forEach(function (day) {
        var s = setup({ tweak: withRecent(delivered(300, { custbody_del_date: day })) });
        assert.strictEqual(run(s.sl, 'GET', { t: s.tok }).indexOf('Booked deliveries'), -1, day);
    });
    var s = setup({ days: '10', tweak: withRecent(delivered(300, { custbody_del_date: dates.addDays(TODAY, -8) })) });
    assert.ok(run(s.sl, 'GET', { t: s.tok }).indexOf('Delivered orders stay here for 10 days.') > 0, 'N is the parameter');
});

test('11. Record Status 3 or 7 with hidden 3,7: not shown; a completed status (20) is', function () {
    ['3', '7'].forEach(function (rs) {
        var s = setup({ tweak: withRecent(delivered(300, { custbody_del_date: TODAY, custbody_finance_status: rs })) });
        assert.strictEqual(run(s.sl, 'GET', { t: s.tok }).indexOf('Booked deliveries'), -1, rs);
    });
    var rows = data.groupRecent([fx.order('300', '4', { recordStatus: '43', confirmedDateKey: TODAY })], [], CFG, TODAY, 7);
    assert.strictEqual(rows.length, 1, 'the excluded list is NOT applied here');
});

test('12. Parts or FOC quote type: not shown', function () {
    var s = setup({ tweak: withRecent(delivered(300, { custbody_del_date: TODAY, custbody_quote_type: '7' })) });
    assert.strictEqual(run(s.sl, 'GET', { t: s.tok }).indexOf('Booked deliveries'), -1);
    assert.strictEqual(data.groupRecent([fx.order('300', '4', { quoteType: '8', confirmedDateKey: TODAY })], [], fx.CFG, TODAY, 7).length, 0);
});

test('13. the recent search throws: the page renders without the section, RECENT_FAILED logged', function () {
    var s = setup({ recentThrow: true, tweak: withRecent(delivered(300, { custbody_del_date: TODAY })) });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('Projects for delivery') > 0);
    assert.strictEqual(html.indexOf('Booked deliveries'), -1);
    assert.strictEqual(logs(s.w, 'RECENT_FAILED').length, 1);
});

test('14. only recent deliveries: the page shows the section (not the empty message); no digest is sent', function () {
    function onlyRecent(w) {
        delete w.orders[100];
        w.opps[4].custbody_opportunity_sub_status = '12';
        w.orders[300] = delivered(300, { custbody_del_date: TODAY });
    }
    var s = setup({ tweak: onlyRecent });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<h2>Booked deliveries</h2>') > 0);
    assert.strictEqual(html.indexOf('There is nothing to show'), -1);
    assert.ok(html.indexOf('>Barn<') > 0, 'under its project');

    var w = ns.world();
    onlyRecent(w);
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42' };
    var written = [];
    amd.load('cdb_mr_digest', ns.stubs(w)).map({ value: JSON.stringify({ customerId: '42' }), write: function (o) { written.push(o); } });
    assert.deepStrictEqual(written, [{ key: 'skipped: nothing to show', value: '42' }]);
    assert.strictEqual(w.emails.length, 0);
});

test('14b. a digest that is sent ends with a Recently delivered group, outside the callout', function () {
    var w = ns.world();
    w.orders[300] = delivered(300, { custbody_del_date: TODAY });
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42' };
    amd.load('cdb_mr_digest', ns.stubs(w)).map({ value: JSON.stringify({ customerId: '42' }), write: function () {} });
    var body = w.emails[0].body;
    assert.ok(body.indexOf('>Booked deliveries</td>') > body.indexOf('SO100'), 'at the end');
    assert.ok(body.indexOf('>Delivered</span>') > 0);
    assert.ok(body.indexOf('delivered ' + dates.formatDisplay(TODAY, TODAY)) > 0);
    assert.strictEqual(body.indexOf('2 orders are ready'), -1, 'the delivered order is not counted');
});

test('15. deliveryDateKey: the confirmed date wins; neither is null', function () {
    assert.strictEqual(data.deliveryDateKey({ confirmedDateKey: '2026-09-28', shipDateKey: '2026-09-25' }), '2026-09-28');
    assert.strictEqual(data.deliveryDateKey({ confirmedDateKey: '', shipDateKey: '2026-09-25' }), '2026-09-25');
    assert.strictEqual(data.deliveryDateKey({ confirmedDateKey: '', shipDateKey: '' }), null);
});

test('16. one extras search per page, with the recent rows joined in; the recent row gets its description', function () {
    var s = setup({ tweak: withRecent(delivered(300, { custbody_del_date: TODAY, custbody_unique_so_ref: 'Part 2 of 2' })) });
    var html = run(s.sl, 'GET', { t: s.tok });
    var extras = s.w.searches.filter(function (d) { return d.type === 'salesorder' && d.columns.indexOf('terms') >= 0; });
    assert.strictEqual(extras.length, 1);
    assert.deepStrictEqual(extras[0].filters[2][2].slice().sort(), ['100', '300']);
    assert.ok(html.indexOf('<span class="soref">Part 2 of 2</span>') > 0);
    var recent = s.w.searches.filter(function (d) { return d.type === 'salesorder' && JSON.stringify(d.filters).indexOf('SalesOrd:G') >= 0; });
    assert.strictEqual(recent.length, 1, 'one recent search');
    assert.strictEqual(JSON.stringify(recent[0].filters).indexOf('"noneof",["2","16","90"]'), -1, 'no excluded list');
});

// ---------------------------------------------------------------- PR #4 amendment 1: through the opportunities

function recentSearches(w) {
    return (w.searches || []).filter(function (d) { return d.type === 'salesorder' && JSON.stringify(d.filters).indexOf('SalesOrd:G') >= 0; });
}

test('A1. another customer\'s entity on this customer\'s opportunity: shown', function () {
    var s = setup({ tweak: withRecent(delivered(300, { entity: '43', opportunity: '4', custbody_del_date: TODAY })) });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<h2>Booked deliveries</h2>') > 0);
    assert.ok(html.indexOf('Order SO300') > 0);
    var f = JSON.stringify(recentSearches(s.w)[0].filters);
    assert.ok(f.indexOf('["opportunity","anyof",["4"]]') >= 0, f);
    assert.strictEqual(f.indexOf('"entity"'), -1, 'no entity filter');
    assert.strictEqual(f.indexOf('"noneof","@NONE@"'), -1, 'no redundant opportunity filter');
});

test('A2. this customer\'s entity on another customer\'s opportunity: not shown', function () {
    var s = setup({ tweak: withRecent(delivered(300, { entity: '42', opportunity: '9', custbody_del_date: TODAY })) });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(html.indexOf('Booked deliveries'), -1);
    assert.strictEqual(html.indexOf('SO300'), -1);
});

test('A3. no opportunities: the recent search is not run, and there is no section', function () {
    var s = setup({ tweak: function (w) {
        Object.keys(w.opps).forEach(function (id) { if (w.opps[id].entity === '42') { delete w.opps[id]; } });
        w.orders[300] = delivered(300, { custbody_del_date: TODAY });
    } });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(recentSearches(s.w).length, 0);
    assert.strictEqual(html.indexOf('Booked deliveries'), -1);
    assert.ok(html.indexOf('There is nothing to show') > 0);
    assert.deepStrictEqual(data.getRecentlyDelivered('42', [], CFG, TODAY), [], 'pure guard: no IDs, no search');
});

test('A4. the digest uses the same rule: through the customer\'s opportunities', function () {
    var w = ns.world();
    w.orders[300] = delivered(300, { entity: '43', opportunity: '4', custbody_del_date: TODAY });
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42' };
    amd.load('cdb_mr_digest', ns.stubs(w)).map({ value: JSON.stringify({ customerId: '42' }), write: function () {} });
    var f = JSON.stringify(recentSearches(w)[0].filters);
    assert.ok(f.indexOf('["opportunity","anyof",["4"]]') >= 0);
    assert.strictEqual(f.indexOf('"entity"'), -1);
    assert.ok(w.emails[0].body.indexOf('Order SO300') > 0, 'the order on this customer\'s opportunity is in the email');
});

// ---------------------------------------------------------------- PR #4 amendment 2: "Booked deliveries"

function section(html, title) {
    var start = html.indexOf('<h2>' + title + '</h2>');
    var end = html.indexOf('</section>', start);
    return start < 0 ? '' : html.slice(start, end);
}

test('B1. a mixed project (one awaiting payment, one booked) appears in both sections under the same heading', function () {
    var s = setup({ tweak: function (w) {
        w.orders[100].custbody_cust_pay_intent = '1';
        w.orders[102] = { tranid: 'SO102', status: 'SalesOrd:B', opportunity: '4', custbody_finance_status: '',
            custbody_quote_type: '1', custbody_ready_for_delivery: true, custbody_del_date: dates.addDays(TODAY, 10),
            custbody_cust_pay_intent: '1', quoteDescription: 'Manifolds' };
    } });
    var html = run(s.sl, 'GET', { t: s.tok });
    var forDelivery = section(html, 'Projects for delivery');
    var booked = section(html, 'Booked deliveries');
    assert.ok(forDelivery.indexOf('>Barn<') > 0 && booked.indexOf('>Barn<') > 0, 'same heading in both');
    assert.ok(forDelivery.indexOf('SO100') > 0 && forDelivery.indexOf('SO102') < 0);
    assert.ok(booked.indexOf('SO102') > 0 && booked.indexOf('SO100') < 0);
    assert.ok(booked.indexOf('Delivery booked') > 0);
    assert.ok(booked.indexOf('Nothing needed from you. Delivered orders stay here for 7 days.') > 0);
    assert.ok(forDelivery.indexOf('<span class="count">1</span>') > 0 && booked.indexOf('<span class="count">1</span>') > 0);
});

test('B2. a project with only booked orders is not in "Projects for delivery"', function () {
    var s = setup({ tweak: function (w) { w.orders[100].custbody_del_date = dates.addDays(TODAY, 5); } });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.strictEqual(html.indexOf('<h2>Projects for delivery</h2>'), -1);
    assert.ok(section(html, 'Booked deliveries').indexOf('SO100') > 0);
    assert.strictEqual(html.indexOf('There is nothing to show'), -1);
});

test('B3. the pill counts orders, not projects', function () {
    var s = setup({ tweak: function (w) {
        w.orders[102] = { tranid: 'SO102', status: 'SalesOrd:B', opportunity: '4', custbody_finance_status: '',
            custbody_quote_type: '1', custbody_ready_for_delivery: true, custbody_del_date: '', custbody_cust_pay_intent: '' };
    } });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(section(html, 'Projects for delivery').indexOf('<span class="count">2</span>') > 0, 'one project, two orders');
});

test('B4. sort order within "Booked deliveries"', function () {
    function row(id, state, extra) {
        return { order: fx.order(id, 'x', extra), state: state };
    }
    var groups = {
        forDelivery: [
            { opp: { id: 'A' }, orders: [row('A2', 'booked', { confirmedDateKey: '2026-10-20' }),
                row('A1', 'released', { shipDateKey: '2026-10-15' }), row('A3', 'ready', {})] },
            { opp: { id: 'B' }, orders: [row('B1', 'booked', { confirmedDateKey: '2026-10-10' })] }
        ],
        recent: [
            { opp: { id: 'C' }, orders: [row('C1', 'delivered', { deliveredKey: '2026-09-27' })] },
            { opp: { id: 'D' }, orders: [row('D1', 'delivered', { deliveredKey: '2026-09-29' })] },
            { opp: { id: 'A' }, orders: [row('A4', 'delivered', { deliveredKey: '2026-09-25' }),
                row('A5', 'delivered', { deliveredKey: '2026-09-28' })] }
        ]
    };
    data.arrangeSections(groups);
    assert.deepStrictEqual(groups.booked.map(function (p) { return p.opp.id; }), ['B', 'A', 'D', 'C'],
        'upcoming projects by soonest date, then delivered-only by most recent');
    assert.deepStrictEqual(groups.booked[1].orders.map(function (r) { return r.order.id; }), ['A1', 'A2', 'A5', 'A4'],
        'upcoming ascending, then delivered descending');
    assert.deepStrictEqual(groups.forDelivery.map(function (p) { return p.opp.id; }), ['A'], 'B has nothing that needs the customer');
    assert.deepStrictEqual(groups.forDelivery[0].orders.map(function (r) { return r.order.id; }), ['A3']);
});

test('B5. the year shows only when it is not this year, including across 31 Dec / 1 Jan', function () {
    assert.strictEqual(dates.formatDisplay('2027-04-16', '2026-10-01'), 'Fri 16 Apr 2027');
    assert.strictEqual(dates.formatDisplay('2026-10-30', '2026-10-01'), 'Fri 30 Oct');
    assert.strictEqual(dates.formatDisplay('2027-01-01', '2026-12-31'), 'Fri 1 Jan 2027');
    assert.strictEqual(dates.formatDisplay('2026-12-31', '2026-12-31'), 'Thu 31 Dec');
    assert.strictEqual(dates.formatDisplay('2026-12-31', '2027-01-01'), 'Thu 31 Dec 2026');
    assert.strictEqual(dates.formatDisplay('2027-01-01', '2027-01-01'), 'Fri 1 Jan');
    // "This year" is the UK year: 31 Dec 23:30 UTC is still 31 Dec in London (GMT).
    assert.strictEqual(dates.londonTodayKey(Date.UTC(2026, 11, 31, 23, 30)), '2026-12-31');
    assert.strictEqual(dates.formatDisplay('', '2026-10-01'), '');
});

test('B6. email: "For delivery" rows, then "Booked deliveries" last; the callout counts are unchanged', function () {
    var groups = data.groupProjects([fx.opp('4', '13', '8', { title: 'Barn' }), fx.opp('2', '13', '4', { title: 'Loft' })], [
        fx.order('100', '4', { ready: true }),
        fx.order('101', '4', { payIntent: '1' }),
        fx.order('102', '4', { confirmedDateKey: '2026-10-20' }),
        fx.order('103', '4', { recordStatus: '2' })
    ], CFG);
    groups.recent = [{ opp: { id: '4', title: 'Barn' }, orders: [{ order: fx.order('300', '4', { deliveredKey: TODAY }), state: 'delivered' }] }];
    var before = render.digestCallout(groups, '1');
    data.arrangeSections(groups);
    assert.strictEqual(render.digestCallout(groups, '1'), before, 'callout unchanged');
    assert.ok(before.indexOf('1 order is ready to arrange delivery') >= 0 && before.indexOf('1 order is awaiting your bank transfer') >= 0);
    var html = render.digestEmail({ customerName: 'A', groups: groups, payBacs: '1', link: 'https://x/l', am: {}, digestDays: 14 });
    var heading = html.indexOf('>Booked deliveries</td>');
    assert.ok(heading > 0);
    ['SO100', 'SO101'].forEach(function (t) { assert.ok(html.indexOf(t) > 0 && html.indexOf(t) < heading, t + ' before'); });
    ['SO103', 'SO102', 'SO300'].forEach(function (t) { assert.ok(html.indexOf(t) > heading, t + ' after'); });
    assert.ok(html.indexOf('>Loft<') < heading, 'design rows are not under the booked heading');
    // SO102 is booked for 20 Oct; SO103 is released with no ship date, so it sorts after the dated one.
    assert.ok(html.indexOf('SO102') < html.indexOf('SO103') && html.indexOf('SO103') < html.indexOf('SO300'), 'booked order');
});

test('B7. who gets a digest is unchanged: booked or released orders alone still get one; recent deliveries alone do not', function () {
    var w = ns.world();
    w.orders[100].custbody_del_date = dates.addDays(TODAY, 5);
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42' };
    var written = [];
    amd.load('cdb_mr_digest', ns.stubs(w)).map({ value: JSON.stringify({ customerId: '42' }), write: function (o) { written.push(o); } });
    assert.deepStrictEqual(written, [{ key: 'sent', value: '42' }], 'a booked open order alone: sent, as in 1.3.0');
    assert.ok(w.emails[0].body.indexOf('>Booked deliveries</td>') > 0);
    assert.strictEqual(w.emails[0].body.indexOf('#fffaf0'), -1, 'no callout');
});
