'use strict';
/**
 * Release 2.0.3 (PR #5 amendment 3): customer emails v2 — the "Book your delivery" email
 * (EmailDeliveryLink.dc.html) and the projects update (EmailDigestV2.dc.html).
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');
var fx = require('./helpers/fixtures');

var config = amd.load('lib/cdb_lib_config', { 'N/runtime': {} });
var render = amd.load('lib/cdb_lib_render');
var dates = amd.load('lib/cdb_lib_dates');
var data = amd.load('lib/cdb_lib_data', { 'N/search': {}, 'N/record': {}, 'N/format': {}, 'N/runtime': {}, 'N/log': {} });
var STD = config.EMAIL_STANDARD;
var TODAY = dates.londonTodayKey(Date.now());

var AM = { name: 'John Moore', firstName: 'John', phone: '01404 540623', email: 'john@example.com' };

function deliveryModel(order, extra) {
    var m = { customerName: 'Acme', greetingName: 'Sam', logoUrl: '', opp: { title: 'Barn', tranId: 'QR241118', siteAddress: 'Farm' },
        order: Object.assign({ id: '100', tranId: 'SO100', description: 'UFH ground floor', uniqueRef: '', typeLabel: 'UFH',
            prepay: true, amount: null }, order || {}),
        noticeDays: 3, link: 'https://x/sl?t=T&a=delivery&so=100', dashboardLink: 'https://x/sl?t=T', am: AM };
    return Object.assign(m, extra || {});
}

function stripped(html) {
    return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/\sstyle="[^"]*"/g, '');
}

// ---------------------------------------------------------------- "Book your delivery": the facts

test('"This order": present when the split reference is set, escaped; absent when blank', function () {
    var html = render.deliveryLinkEmail(deliveryModel({ uniqueRef: 'Part 1 <of> 2 & "pipes"' }));
    assert.ok(html.indexOf('>This order</font>') > 0);
    assert.ok(html.indexOf('<b>Part 1 &lt;of&gt; 2 &amp; &quot;pipes&quot;</b>') > 0);
    html = render.deliveryLinkEmail(deliveryModel({ uniqueRef: '' }));
    assert.strictEqual(html.indexOf('>This order<'), -1);
});

test('"Amount to pay": pay up front with an amount -> shown; account or unknown -> absent', function () {
    var html = render.deliveryLinkEmail(deliveryModel({ prepay: true, amount: { amount: 1722.44, basis: 'balance' } }));
    assert.ok(html.indexOf('>Amount to pay</font>') > 0 && html.indexOf('<b>£1,722.44 inc VAT</b>') > 0);
    assert.ok(html.indexOf('Pay by bank transfer or card.') > 0, 'step 3: pay up front');
    html = render.deliveryLinkEmail(deliveryModel({ prepay: false, amount: { amount: 1722.44, basis: 'balance' } }));
    assert.strictEqual(html.indexOf('Amount to pay'), -1, 'account');
    assert.ok(html.indexOf('Choose how you’d like to pay, or add it to your account.') > 0, 'step 3: account');
    html = render.deliveryLinkEmail(deliveryModel({ prepay: true, amount: null }));
    assert.strictEqual(html.indexOf('Amount to pay'), -1, 'unknown');
    html = render.deliveryLinkEmail(deliveryModel({ prepay: true, amount: { amount: 0, basis: 'balance' } }));
    assert.ok(html.indexOf('<b>Nothing left to pay</b>') > 0, '0 is a known amount');
});

test('the earliest date is the delivery form\'s first allowed day (weekend and a non-delivery date)', function () {
    var plain = dates.allowedDates(TODAY, 3, {}, config.BOOKING_HORIZON_MONTHS);
    // Make the form's would-be first day a non-delivery date, so the earliest moves past it.
    var w = ns.world();
    var first;
    var formFirst;
    var html = '';
    w.nonDelivery = [plain[0]];
    w.scriptId = 'customscript_cdb_sl_send_link';
    w.params = { custscript_cdbsend_excluded_statuses: '90', custscript_cdbsend_excluded_quote_types: '7,8',
        custscript_cdbsend_released_statuses: '2', custscript_cdbsend_fallback_employee: '500', custscript_cdbsend_logo_url: '',
        custscript_cdbsend_quote_type_labels: '', custscript_cdbsend_notice_days: '3' };
    amd.load('cdb_sl_send_link', ns.stubs(w)).onRequest({ request: { method: 'GET', parameters: { so: '100' } },
        response: { setHeader: function () {}, write: function () {} } });
    first = /Earliest delivery<\/font><\/td><td[^>]*><font[^>]*><b>([^<]*)<\/b>/.exec(w.emails[0].body)[1];

    // The dashboard's delivery form for the same order, the same day and the same non-delivery date.
    var w2 = ns.world();
    w2.nonDelivery = [plain[0]];
    var stubs = ns.stubs(w2);
    var tok = amd.load('lib/cdb_lib_token', stubs).sign(42, 0);
    amd.load('cdb_sl_dashboard', stubs).onRequest({ request: { method: 'GET', parameters: { t: tok, a: 'delivery', so: '100' } },
        response: { setHeader: function () {}, write: function (o) { html += o.output; } } });
    formFirst = /name="date" value="([0-9-]+)"/.exec(html)[1];

    assert.notStrictEqual(formFirst, plain[0], 'the non-delivery date is skipped');
    assert.ok([0, 6].indexOf(new Date(formFirst + 'T12:00:00Z').getUTCDay()) < 0, 'not a weekend');
    assert.strictEqual(first, dates.formatDisplay(formFirst, TODAY), 'the email shows the form\'s first day');
    assert.ok(w.emails[0].body.indexOf('(sooner? call us)') > 0);
    assert.ok(w.emails[0].body.indexOf('Any weekday from 3 working days’ time') > 0);
});

test('"Need it sooner?": the AM\'s number as a tel: link; without one, 01404 540604', function () {
    var html = render.deliveryLinkEmail(deliveryModel());
    assert.ok(html.indexOf('Need it sooner? That’s fine, just call John on <a href="tel:01404540623"') > 0);
    assert.ok(html.indexOf('>01404 540623</font></a> and we’ll do our best.') > 0);
    html = render.deliveryLinkEmail(deliveryModel({}, { am: { name: 'John Moore', firstName: 'John', phone: '', email: '' } }));
    assert.ok(html.indexOf('just call John on <a href="tel:01404540604"') > 0 && html.indexOf('>01404 540604</font></a>') > 0);
    html = render.deliveryLinkEmail(deliveryModel({}, { am: {} }));
    assert.ok(html.indexOf('just call us on <a href="tel:01404540604"') > 0, 'no name: "us"');
});

/** 2.0.4: render and config sharing one config instance, so a test can blank a constant. */
function withConfig(change) {
    var cache = {};
    var c = amd.load('lib/cdb_lib_config', { 'N/runtime': {} }, cache);
    change(c);
    return amd.load('lib/cdb_lib_render', {}, cache);
}

test('hero image: the Send Quote 2.2.0 hero constant, full width, 600 x 337, alt=""; http or blank -> no image row', function () {
    var html = render.deliveryLinkEmail(deliveryModel());
    assert.strictEqual(config.EMAIL_HERO_URL,
        'https://images.chamaileon.io/5b1fac592f38b800113c85ca/5ca8626420e2346b3ee9a013/1613738610524_Order%20conformation.jpg');
    assert.ok(html.indexOf('<img src="' + config.EMAIL_HERO_URL + '" width="600" height="337" alt="" border="0" class="fluid"') > 0);
    ['http://cdn.example.com/hero.jpg', '', 'javascript:alert(1)'].forEach(function (u) {
        var h = withConfig(function (c) { c.EMAIL_HERO_URL = u; }).deliveryLinkEmail(deliveryModel());
        assert.strictEqual(h.indexOf('class="fluid"'), -1, u);
        assert.strictEqual(/<tr><td align="center" valign="top"><\/td><\/tr>/.test(h), false, 'no empty row: ' + u);
    });
});

test('"Before you book": three tips, each with its constant icon, escaped, 48 x 48; a blank constant -> text only', function () {
    var html = render.deliveryLinkEmail(deliveryModel());
    var tips = html.slice(html.indexOf('>Before you book</font>'), html.indexOf('>Questions?</font>'));
    assert.ok(html.indexOf('color="#a3155f"') > 0, 'magenta heading');
    ['LORRY', 'PARCEL', 'PEOPLE'].forEach(function (k, i) {
        var src = config.EMAIL_ICONS[k].replace(/&/g, '&amp;');
        var at = tips.indexOf('<img src="' + src + '" width="48" height="48" alt=""');
        var title = tips.indexOf('<b>' + ['Lorry access', 'Where it’s left', 'People on site'][i] + '</b>');
        assert.ok(at > 0 && title > at, k + ': its icon, escaped, above its tip');
        assert.strictEqual(tips.indexOf(config.EMAIL_ICONS[k]), -1, k + ': never unescaped');
    });
    assert.strictEqual((tips.match(/width="48" height="48"/g) || []).length, 3);
    assert.ok(html.indexOf('bgcolor="#f4f4f4"') > 0, 'the grey panel');

    html = withConfig(function (c) { c.EMAIL_ICONS.PARCEL = ''; c.EMAIL_ICONS.PEOPLE = 'http://x/p.png'; })
        .deliveryLinkEmail(deliveryModel());
    tips = html.slice(html.indexOf('>Before you book</font>'), html.indexOf('>Questions?</font>'));
    assert.strictEqual((tips.match(/<img /g) || []).length, 1, 'only the lorry keeps its icon');
    assert.ok(tips.indexOf('<b>Where it’s left</b>') > 0 && tips.indexOf('<b>People on site</b>') > 0, 'the tips stay, as text');
    assert.strictEqual(tips.indexOf('http://x/p.png'), -1);
});

// ---------------------------------------------------------------- the projects update

var CFG = Object.assign({}, fx.CFG, { RELEASED_STATUSES: ['2'], EXCLUDED_STATUSES: ['2', '90'] });

function groupsOf(opps, orders, recent) {
    var g = data.groupProjects(opps, orders, CFG);
    g.recent = recent || [];
    data.arrangeSections(g);
    return g;
}

function digest(groups) {
    return render.digestEmail({ customerName: 'Acme', greetingName: 'Sam', logoUrl: '', groups: groups, payBacs: '1',
        link: 'https://x/sl?t=T', orderLink: function (id) { return 'https://x/sl?t=T&a=delivery&so=' + id; },
        title: 'Your Nu-Heat projects: an update', am: AM, digestDays: 14 });
}

function tileRow(html) {
    var i = html.indexOf('class="tiles"');
    return i < 0 ? '' : html.slice(i, html.indexOf('</table>\n</td></tr>', i));
}

test('tiles: one per non-zero count, in one row; none when every count is zero', function () {
    var g = groupsOf([fx.opp('4', '13', '8'), fx.opp('2', '13', '4'), fx.opp('3', '13', '1')], [
        fx.order('100', '4', { ready: true }), fx.order('101', '4', { ready: true }),
        fx.order('102', '4', { payIntent: '1' }),
        fx.order('103', '4', { confirmedDateKey: '2026-10-20' }), fx.order('104', '4', { recordStatus: '2' })
    ]);
    assert.deepStrictEqual(render.digestCounts(g), { ready: 2, pay: 1, design: 2, booked: 2 });
    var row = tileRow(digest(g));
    assert.strictEqual((row.match(/<tr>\n/g) || []).length, 1, 'one row (each tile\'s own inner cell aside)');
    assert.strictEqual((row.match(/<td width="25%"/g) || []).length, 4);
    ['2</b>', 'ready to book', 'awaiting payment', 'in design', 'booked'].forEach(function (t) { assert.ok(row.indexOf(t) > 0, t); });
    ['#fff5dc', '#e3edf7', '#efe9f1', '#e6f2ec'].forEach(function (c) { assert.ok(row.indexOf('bgcolor="' + c + '"') > 0, c); });
    // Stripped, the row stays one row of equal cells with their colours.
    assert.strictEqual((tileRow(stripped(digest(g))).match(/<tr>\n/g) || []).length, 1);

    g = groupsOf([fx.opp('4', '13', '8')], [fx.order('100', '4', { ready: true })]);
    row = tileRow(digest(g));
    assert.strictEqual((row.match(/<td width="100%"/g) || []).length, 1, 'zero counts leave their tile out');
    assert.strictEqual(row.indexOf('awaiting payment'), -1);

    g = groupsOf([fx.opp('1', '10', '')], []);
    assert.deepStrictEqual(render.digestCounts(g), { ready: 0, pay: 0, design: 0, booked: 0 });
    assert.strictEqual(tileRow(digest(g)), '', 'no tile row');
});

function readyOrders(n) {
    var orders = [];
    var i;
    for (i = 0; i < n; i++) {
        orders.push(fx.order(String(100 + i), '4', { ready: true, description: 'Order ' + i, uniqueRef: i === 0 ? 'Part 1 of 2' : '' }));
    }
    return orders;
}

function actionBox(html) {
    var i = html.indexOf('bgcolor="#fffaf0"');
    return i < 0 ? '' : html.slice(i, html.indexOf('Your projects', i));
}

test('action box: 1, 3 and 5 ready -> 1, 3 and 3 rows plus "and 2 more"; each button its own link', function () {
    [[1, 1], [3, 3], [5, 3]].forEach(function (c) {
        var box = actionBox(digest(groupsOf([fx.opp('4', '13', '8', { title: 'Barn' })], readyOrders(c[0]))));
        var visible = box.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '');
        var links = (visible.match(/<a href="https:\/\/x\/sl\?t=T&amp;a=delivery&amp;so=\d+"/g) || []);
        assert.strictEqual(links.length, c[1], c[0] + ' ready');
        links.forEach(function (l, i) { assert.ok(l.indexOf('so=' + (100 + i) + '"') > 0, l); });
        assert.ok(box.indexOf(c[0] === 1 ? '<b>1 order is ready to deliver</b>' : '<b>' + c[0] + ' orders are ready to deliver</b>') > 0);
        assert.strictEqual(box.indexOf('and 2 more on your projects page') > 0, c[0] === 5, 'the more line');
        assert.strictEqual(box.indexOf('More than 3 ready'), -1, 'no design note');
    });
    var box = actionBox(digest(groupsOf([fx.opp('4', '13', '8', { title: 'Barn' })], readyOrders(5))));
    assert.ok(box.indexOf('<a href="https://x/sl?t=T" target="_blank"') > 0, 'the more line links to the dashboard');
    assert.ok(box.indexOf('Barn · Order SO100 · Underfloor heating system · Part 1 of 2') > 0, 'project, order, split reference');
});

test('action box: none when nothing is ready; awaiting payment is not in it', function () {
    var html = digest(groupsOf([fx.opp('4', '13', '8')], [fx.order('100', '4', { payIntent: '1' })]));
    assert.strictEqual(actionBox(html), '');
    assert.ok(html.indexOf('ref SO100 for payment') > 0, 'on its project card instead');
});

// ---------------------------------------------------------------- projectStage and the bar

test('projectStage: every mapping, Booked versus Delivered', function () {
    function p(kind, states) {
        return { kind: kind, orders: (states || []).map(function (s) { return { state: s }; }) };
    }
    assert.strictEqual(render.projectStage(p('quote')), 'quote');
    assert.strictEqual(render.projectStage(p('design')), 'design');
    ['ready', 'awaiting_payment', 'requested', 'needs_info'].forEach(function (s) {
        assert.strictEqual(render.projectStage(p('delivery', ['booked', s])), 'delivery', s);
    });
    assert.strictEqual(render.projectStage(p('delivery', ['booked', 'released'])), 'booked');
    assert.strictEqual(render.projectStage(p('delivery', ['booked', 'delivered'])), 'booked', 'something still to come');
    assert.strictEqual(render.projectStage(p('delivery', ['delivered', 'delivered'])), 'delivered');
    assert.strictEqual(render.projectStage(p('delivery', [])), 'design', 'no visible orders');
    // From the real grouping: a design-substatus project with no orders is Design.
    var g = groupsOf([fx.opp('2', '13', '4'), fx.opp('3', '13', '1'), fx.opp('1', '10', '')], []);
    var cards = render.digestProjects(g);
    assert.deepStrictEqual(cards.map(function (c) { return render.projectStage(c); }), ['design', 'design', 'quote']);
});

function track(html, title) {
    var i = html.indexOf('<b>' + title + '</b>');
    var j = html.indexOf('class="track"', i);
    return html.slice(j, html.indexOf('</tr>\n</table>', j));
}

test('progress bar: exactly one current segment; earlier teal, later grey; the last label', function () {
    var g = groupsOf([fx.opp('4', '13', '8', { title: 'Barn' }), fx.opp('5', '13', '8', { title: 'Garden' }),
        fx.opp('2', '13', '4', { title: 'Loft' })], [
        fx.order('100', '4', { ready: true }), fx.order('101', '4', { confirmedDateKey: '2026-10-20' }),
        fx.order('200', '5', { confirmedDateKey: '2026-10-21' })
    ], [{ opp: { id: '6', title: 'Shed', tranId: '' }, orders: [{ order: fx.order('300', '6', { deliveredKey: TODAY }), state: 'delivered' }] }]);
    var html = digest(g);
    var expect = { Barn: [3, 'Booked'], Garden: [4, 'Booked'], Loft: [2, 'Delivered'], Shed: [4, 'Delivered'] };
    Object.keys(expect).forEach(function (t) {
        var bar = track(html, t);
        var cells = bar.match(/<td width="20%"[\s\S]*?<\/p><\/td>/g);
        assert.strictEqual(cells.length, 5, t);
        assert.strictEqual((bar.match(/data-stage="now"/g) || []).length, 1, t + ': one current');
        cells.forEach(function (c, i) {
            var colour = /bgcolor="(#[0-9a-f]{6})"/.exec(c)[1];
            var want = i === expect[t][0] ? '#ffb500' : i < expect[t][0] ? STD.TEAL : '#e2ded9';
            assert.strictEqual(colour, want, t + ' segment ' + i);
        });
        assert.ok(cells[expect[t][0]].indexOf('<b>') > 0, t + ': the current label is bold');
        assert.ok(cells[4].indexOf(expect[t][1]) > 0, t + ': last label ' + expect[t][1]);
        // Stripped, every bar cell keeps its colour.
        assert.strictEqual((stripped(bar).match(/<td height="6" align="center" valign="top" bgcolor="#[0-9a-f]{6}">/g) || []).length, 5);
    });
    assert.ok(track(html, 'Barn').indexOf('>Ordered<') > 0 && track(html, 'Barn').indexOf('<b>Ordered</b>') < 0, 'Ordered is never current');
});

test('cards: in the section order, one per project; sub-lines; VIEW ALL YOUR PROJECTS is purple', function () {
    var g = groupsOf([fx.opp('4', '13', '8', { title: 'Barn', tranId: 'QR1', siteAddress: 'Farm' }),
        fx.opp('2', '13', '4', { title: 'Loft', tranId: 'QR2' }), fx.opp('3', '13', '1', { title: 'Attic', tranId: 'QR3' }),
        fx.opp('1', '10', '', { title: 'Plot', tranId: 'QR4' })],
    [fx.order('100', '4', { ready: true }), fx.order('101', '4', { confirmedDateKey: '2026-10-20' })]);
    var html = digest(g);
    var at = ['<b>Barn</b>', '<b>Loft</b>', '<b>Attic</b>', '<b>Plot</b>'].map(function (t) { return html.indexOf(t); });
    assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2] && at[2] < at[3], 'delivery, design, quote');
    assert.strictEqual((html.match(/<b>Barn<\/b>/g) || []).length, 1, 'one card for Barn, booked order included');
    assert.ok(html.indexOf('>QR1 · Farm</font>') > 0);
    assert.ok(html.indexOf('>QR2 · Our design team is working on it. Nothing needed from you.</font>') > 0);
    assert.ok(html.indexOf('>QR3 · We need some information from you for the design.</font>') > 0);
    assert.ok(html.indexOf('>QR4 · Quote sent</font>') > 0);
    assert.ok(/bgcolor="#59315f"[^>]*><a href="https:\/\/x\/sl\?t=T" target="_blank"[^>]*><font[^>]*><b>VIEW ALL YOUR PROJECTS/.test(html));
});
