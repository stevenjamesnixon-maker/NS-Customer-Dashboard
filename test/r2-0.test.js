'use strict';
/**
 * Release 2.0: direct links and "Send delivery link". Numbered as the brief's table.
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var nodeCrypto = require('crypto');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var config = amd.load('lib/cdb_lib_config', { 'N/runtime': {} });
var render = amd.load('lib/cdb_lib_render');

// ---------------------------------------------------------------- 1. buildLink

function tokenWith(calls) {
    return amd.load('lib/cdb_lib_token', {
        'N/encode': { Encoding: { UTF_8: 'UTF_8', BASE_64: 'BASE_64' } },
        'N/crypto': {
            HashAlg: { SHA256: 'SHA256' },
            createSecretKey: function () { return {}; },
            createHmac: function () {
                var h = nodeCrypto.createHmac('sha256', 'k');
                return { update: function (u) { h.update(u.input); }, digest: function () { return h.digest('base64'); } };
            }
        },
        'N/search': { Type: { CUSTOMER: 'customer' }, lookupFields: function () {
            return { isinactive: false, custentity_cdb_link_version: '3' };
        } },
        'N/url': { resolveScript: function (o) {
            calls.push(o);
            return 'https://x/sl?' + Object.keys(o.params).map(function (k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(o.params[k]);
            }).join('&');
        } },
        'N/runtime': {}
    });
}

test('1. buildLink(id) is unchanged; buildLink(id, {a, so}) adds a and so, encoded', function () {
    var calls = [];
    var t = tokenWith(calls);
    var tok = t.sign(42, 3);
    assert.strictEqual(t.buildLink(42), 'https://x/sl?t=' + encodeURIComponent(tok));
    assert.deepStrictEqual(calls[0], { scriptId: 'customscript_cdb_sl_dashboard', deploymentId: 'customdeploy_cdb_sl_dashboard',
        returnExternalUrl: true, params: { t: tok } }, 'exactly the 1.x call: no extra parameter, not even an empty one');
    assert.strictEqual(t.buildLink(42, { a: 'delivery', so: '100' }),
        'https://x/sl?t=' + encodeURIComponent(tok) + '&a=delivery&so=100');
    assert.deepStrictEqual(calls[1].params, { t: tok, a: 'delivery', so: '100' }, 'passed to resolveScript, which encodes');
    t.buildLink(42, { a: 'x y&z', t: 'forged' });
    assert.deepStrictEqual(calls[2].params, { t: tok, a: 'x y&z' }, 'an extra t never replaces the token');
});

// ---------------------------------------------------------------- 2 and 8. the User Event

function ueSetup(opts) {
    var w = ns.world();
    var o = opts || {};
    var form = { buttons: [], messages: [],
        addButton: function (b) { form.buttons.push(b); },
        addPageInitMessage: function (m) { form.messages.push(m); } };
    var values = { opportunity: '4', orderstatus: 'B', custbody_del_date: '', custbody_cust_pay_intent: '',
        custbody_ready_for_delivery: true };
    Object.keys(o.values || {}).forEach(function (k) { values[k] = o.values[k]; });
    w.executionContext = o.executionContext;
    var ue = amd.load('cdb_ue_salesorder', ns.stubs(w));
    ue.beforeLoad({
        type: o.type || 'view',
        UserEventType: { VIEW: 'view', EDIT: 'edit', CREATE: 'create', COPY: 'copy' },
        newRecord: { id: 100, getValue: function (f) { return values[f.fieldId]; } },
        form: form,
        request: { parameters: o.params || {} }
    });
    return { w: w, form: form };
}

test('2. the button shows only when all five hold', function () {
    var s = ueSetup();
    assert.strictEqual(s.form.buttons.length, 1);
    assert.strictEqual(s.form.buttons[0].label, 'Send delivery link');
    assert.strictEqual(s.form.buttons[0].functionName,
        'window.location.assign(\'/app/site/hosting/scriptlet.nl?script=customscript_cdb_sl_send_link' +
        '&deploy=customdeploy_cdb_sl_send_link&so=100\')');
    assert.deepStrictEqual(s.w.urls[0].params, { so: '100' });
    assert.ok(!s.w.urls[0].returnExternalUrl, 'the internal URL');
    assert.strictEqual(s.w.searches, undefined, 'no search');

    ['A', 'D', 'E', 'T'].forEach(function (v, i) {
        var field = i < 3 ? 'orderstatus' : 'custbody_ready_for_delivery';
        var values = {};
        values[field] = v;
        assert.strictEqual(ueSetup({ values: values }).form.buttons.length, 1, field + ' ' + v);
    });
    [{ opportunity: '' }, { orderstatus: 'C' }, { orderstatus: 'F' }, { orderstatus: 'G' }, { orderstatus: 'H' },
        { custbody_del_date: '2026-10-20' }, { custbody_cust_pay_intent: '1' }, { custbody_ready_for_delivery: false },
        { custbody_ready_for_delivery: 'F' }].forEach(function (v) {
        assert.strictEqual(ueSetup({ values: v }).form.buttons.length, 0, JSON.stringify(v));
    });
});

test('2. nothing in EDIT or CREATE, nor outside the UI', function () {
    var p = { cdbsl: 'sent', cdblt: String(Date.now()) };
    ['edit', 'create', 'copy'].forEach(function (type) {
        var s = ueSetup({ type: type, params: p });
        assert.strictEqual(s.form.buttons.length + s.form.messages.length, 0, type);
    });
    ['CSVIMPORT', 'WEBSERVICES'].forEach(function (ctx) {
        var s = ueSetup({ executionContext: ctx, params: p });
        assert.strictEqual(s.form.buttons.length + s.form.messages.length, 0, ctx);
    });
});

test('8. the banner: whitelisted text only, an unknown code shows nothing, 300 seconds', function () {
    var now = Date.now();
    var s = ueSetup({ params: { cdbsl: 'sent', cdblt: String(now) } });
    assert.deepStrictEqual(s.form.messages, [{ type: 'confirmation', title: config.SEND_LINK_BANNERS.sent.title,
        message: config.SEND_LINK_BANNERS.sent.message }]);
    assert.strictEqual(ueSetup({ params: { cdbsl: 'refused', cdblt: String(now) } }).form.messages[0].type, 'warning');
    assert.strictEqual(ueSetup({ params: { cdbsl: 'failed', cdblt: String(now - 299000) } }).form.messages[0].type, 'error');

    [{ cdbsl: 'hacked', cdblt: String(now) }, { cdbsl: '<b>sent</b>', cdblt: String(now) },
        { cdbsl: 'hasOwnProperty', cdblt: String(now) }, { cdbsl: 'sent' }, { cdbsl: 'sent', cdblt: 'soon' },
        { cdbsl: 'sent', cdblt: String(now - 301000) }, { cdbsl: 'sent', cdblt: String(now + 3600000) }, {}]
        .forEach(function (p) {
            assert.strictEqual(ueSetup({ params: p }).form.messages.length, 0, JSON.stringify(p));
        });
    // Nothing from the URL reaches the banner.
    s = ueSetup({ params: { cdbsl: 'sent', cdblt: String(now), email: 'evil@example.com' } });
    assert.strictEqual(JSON.stringify(s.form.messages).indexOf('evil'), -1);
    // The banner shows whether or not the button does.
    s = ueSetup({ values: { custbody_del_date: '2026-10-20' }, params: { cdbsl: 'sent', cdblt: String(now) } });
    assert.strictEqual(s.form.buttons.length, 0);
    assert.strictEqual(s.form.messages.length, 1);
});

// ---------------------------------------------------------------- 3 to 7. the Suitelet

function sendParams() {
    return { custscript_cdbsend_excluded_statuses: '90', custscript_cdbsend_excluded_quote_types: '7,8',
        custscript_cdbsend_released_statuses: '2', custscript_cdbsend_fallback_employee: '500',
        custscript_cdbsend_logo_url: 'https://www.nu-heat.co.uk/logo.png',
        custscript_cdbsend_quote_type_labels: '' };
}

function slSetup(tweak) {
    var w = ns.world();
    w.scriptId = 'customscript_cdb_sl_send_link';
    w.params = sendParams();
    w.orders[100].quoteDescription = 'Underfloor heating Ground floor';
    if (tweak) { tweak(w); }
    return { w: w, sl: amd.load('cdb_sl_send_link', ns.stubs(w)) };
}

function press(s, so, method) {
    var out = '';
    s.sl.onRequest({
        request: { method: method || 'GET', parameters: { so: so === undefined ? '100' : so } },
        response: { setHeader: function () {}, write: function (o) { out += o.output; } }
    });
    return out;
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function landed(w, code) {
    assert.strictEqual(w.redirects.length, 1);
    assert.strictEqual(w.redirects[0].type, 'salesorder');
    assert.strictEqual(String(w.redirects[0].id), '100');
    assert.strictEqual(w.redirects[0].parameters.cdbsl, code);
    assert.ok(/^\d+$/.test(w.redirects[0].parameters.cdblt) &&
        Math.abs(Date.now() - parseInt(w.redirects[0].parameters.cdblt, 10)) < 5000, 'cdblt is now');
}

test('3. the guard refuses: no email, refused, logged with the reason', function () {
    var cases = [
        ['booked', function (w) { w.orders[100].custbody_del_date = '2026-10-20'; }, 'delivery already confirmed'],
        ['requested', function (w) { w.orders[100].custbody_cust_pay_intent = '1'; }, 'delivery already requested'],
        ['released', function (w) { w.orders[100].custbody_finance_status = '2'; }, 'released to the warehouse'],
        ['not ready', function (w) { w.orders[100].custbody_ready_for_delivery = false; }, 'not ready for delivery'],
        ['excluded type', function (w) { w.orders[100].custbody_quote_type = '7'; }, 'not open'],
        ['excluded status', function (w) { w.orders[100].custbody_finance_status = '90'; }, 'not open'],
        ['billed', function (w) { w.orders[100].status = 'SalesOrd:G'; }, 'native status cannot ship'],
        ['no opportunity', function (w) { w.orders[100].opportunity = ''; }, 'no opportunity']
    ];
    cases.forEach(function (c) {
        var s = slSetup(c[1]);
        press(s);
        assert.strictEqual(s.w.emails.length, 0, c[0]);
        landed(s.w, 'refused');
        assert.strictEqual(logs(s.w, 'SEND_REFUSED').length, 1, c[0]);
        assert.ok(logs(s.w, 'SEND_REFUSED')[0][2].indexOf(c[2]) > 0, c[0] + ': ' + logs(s.w, 'SEND_REFUSED')[0][2]);
        assert.strictEqual(s.w.saves.length + s.w.submits.length, 0, 'no record write');
    });
});

test('3. the customer is the opportunity\'s, never the order\'s entity', function () {
    // The order's own entity says 43; its opportunity (4) belongs to 42. The email goes to 42.
    var s = slSetup(function (w) { w.orders[100].entity = '43'; });
    press(s);
    assert.strictEqual(s.w.emails.length, 1);
    assert.deepStrictEqual(s.w.emails[0].recipients, ['acme@example.com']);
    assert.strictEqual(s.w.emails[0].relatedRecords.entityId, 42);
});

test('4. no recipient email: no email, refused, SEND_NO_RECIPIENT', function () {
    [function (w) { w.customers[42].email = ''; },
        function (w) { w.customers[42].email = 'not an email'; }].forEach(function (tweak, i) {
        var s = slSetup(tweak);
        press(s);
        assert.strictEqual(s.w.emails.length, 0, String(i));
        landed(s.w, 'refused');
        assert.strictEqual(logs(s.w, 'SEND_NO_RECIPIENT').length, 1);
    });
});

test('5. happy path: one email from the rep, on the customer and the order, with both links', function () {
    var s = slSetup();
    var e;
    press(s);
    assert.strictEqual(s.w.emails.length, 1);
    e = s.w.emails[0];
    assert.strictEqual(e.author, 88, 'the customer\'s sales rep');
    assert.deepStrictEqual(e.recipients, ['acme@example.com']);
    assert.deepStrictEqual(e.relatedRecords, { entityId: 42, transactionId: 100 });
    assert.strictEqual(e.subject, 'Your order SO100 is ready to deliver: choose your date');
    var tok = /sl\?t=([A-Za-z0-9_.-]+)/.exec(e.body)[1];
    assert.ok(e.body.indexOf('href="https://acct.extforms.netsuite.com/sl?t=' + tok + '&amp;a=delivery&amp;so=100"') > 0,
        'the direct link');
    assert.ok(e.body.indexOf('href="https://acct.extforms.netsuite.com/sl?t=' + tok + '"') > 0, 'the dashboard link');
    assert.ok(e.body.indexOf('>ARRANGE DELIVERY</b></font></a>') > 0);
    assert.ok(e.body.indexOf('>Underfloor heating Ground floor</font></p>') > 0);
    assert.ok(e.body.indexOf('Order SO100 · Underfloor heating system') > 0);
    assert.ok(e.body.indexOf('>Barn</b></font></p>') > 0, 'the project title');
    assert.ok(e.body.indexOf('>Ray Rep</b></font></p>') > 0, 'the AM card is the author');
    landed(s.w, 'sent');
    var line = logs(s.w, 'SEND_LINK');
    assert.strictEqual(line.length, 1);
    ['Sales order 100', 'customer 42', 'to acme@example.com', 'from employee 88', 'pressed by user 7 (Sam Staff)']
        .forEach(function (t) { assert.ok(line[0][2].indexOf(t) >= 0, t); });
    assert.strictEqual(s.w.saves.length + s.w.submits.length, 0, 'no record write');
});

test('5. the dashboard contact wins over the customer email', function () {
    var s = slSetup(function (w) {
        w.customers[42].custentity_cdb_dashboard_contact = [{ value: '700', text: 'Site Manager' }];
        w.contacts[700] = { email: 'manager@example.com' };
    });
    press(s);
    assert.deepStrictEqual(s.w.emails[0].recipients, ['manager@example.com']);
});

test('6. rep inactive: the author is the fallback employee', function () {
    var s = slSetup(function (w) { w.employees[88].isinactive = true; });
    press(s);
    assert.strictEqual(s.w.emails[0].author, 500);
    assert.ok(s.w.emails[0].body.indexOf('>Fall Back</b></font></p>') > 0);
});

test('7. email.send throws: redirect failed, logged', function () {
    var s = slSetup(function (w) { w.emailThrow = true; });
    press(s);
    assert.strictEqual(s.w.emails.length, 0);
    landed(s.w, 'failed');
    assert.strictEqual(logs(s.w, 'SEND_FAILED').length, 1);
    assert.ok(logs(s.w, 'SEND_FAILED')[0][2].indexOf('SSS_AUTHOR_MUST_BE_EMPLOYEE') > 0);
    assert.strictEqual(logs(s.w, 'SEND_LINK').length, 0);
});

// 2.0.1 (amendment 1): custscript_cdbsend_quote_type_labels, the dashboard's parser and fallback.

function metaLine(s) {
    return /Order SO100[^<]*/.exec(s.w.emails[0].body)[0];
}

test('2.0.1 type labels: mapped -> "UFH"', function () {
    var s = slSetup(function (w) { w.params.custscript_cdbsend_quote_type_labels = '{"1": "UFH", "2": "HP"}'; });
    press(s);
    assert.strictEqual(metaLine(s), 'Order SO100 · UFH');
    assert.strictEqual(logs(s.w, 'TYPE_LABELS_INVALID').length, 0);
    landed(s.w, 'sent');
});

test('2.0.1 type labels: empty -> the quote type text', function () {
    var s = slSetup();
    press(s);
    assert.strictEqual(metaLine(s), 'Order SO100 · Underfloor heating system');
    assert.strictEqual(logs(s.w, 'TYPE_LABELS_INVALID').length, 0);
    assert.strictEqual(logs(s.w, 'PARAMETER_DEFAULT').filter(function (l) {
        return l[2].indexOf('custscript_cdbsend_quote_type_labels') === 0;
    }).length, 1, 'the empty value logged once');
    landed(s.w, 'sent');
});

test('2.0.1 type labels: invalid JSON -> the quote type text plus one log line; the send goes ahead', function () {
    ['{"1": "UFH"', '["UFH"]'].forEach(function (bad) {
        var s = slSetup(function (w) { w.params.custscript_cdbsend_quote_type_labels = bad; });
        press(s);
        assert.strictEqual(s.w.emails.length, 1, bad);
        assert.strictEqual(metaLine(s), 'Order SO100 · Underfloor heating system', bad);
        var lines = logs(s.w, 'TYPE_LABELS_INVALID');
        assert.strictEqual(lines.length, 1, bad);
        assert.ok(lines[0][2].indexOf('custscript_cdbsend_quote_type_labels ignored') === 0, bad);
        landed(s.w, 'sent');
    });
});

test('GET only, an order ID required, a missing parameter fails', function () {
    var s = slSetup();
    assert.strictEqual(press(s, '100', 'POST'), 'GET only.');
    assert.strictEqual(press(s, 'abc'), 'No sales order was given.');
    assert.strictEqual(s.w.emails.length + s.w.redirects.length, 0);
    s = slSetup(function (w) { w.params.custscript_cdbsend_excluded_quote_types = ''; });
    press(s);
    landed(s.w, 'failed');
    assert.ok(logs(s.w, 'PARAMETER_MISSING')[0][2].indexOf('custscript_cdbsend_excluded_quote_types') === 0);
    assert.strictEqual(s.w.emails.length, 0);
});

// ---------------------------------------------------------------- 9. the email

function emailModel() {
    return {
        text: config.DELIVERY_LINK_EMAIL,
        customerName: 'Acme Ltd',
        greetingName: 'Sam & <Co>',
        logoUrl: 'https://www.nu-heat.co.uk/logo.png',
        opp: { title: 'Barn <conversion>', tranId: 'OPP4' },
        order: { id: '100', tranId: 'SO100', description: 'UFH <script>alert(1)</script> & "more"',
            uniqueRef: 'Part 2 <b>first floor</b>', typeLabel: 'UFH', quoteTypeText: 'Underfloor heating system' },
        link: 'https://acct.extforms.netsuite.com/sl?t=abc.def&a=delivery&so=100',
        dashboardLink: 'https://acct.extforms.netsuite.com/sl?t=abc.def',
        am: { name: 'Pat Lee', phone: '01234 567890', email: 'pat@example.com' }
    };
}

test('9. delivery-link email: snapshot, no opt-out, escaped', function () {
    var m = emailModel();
    var html = render.deliveryLinkEmail(m);
    var snap = path.join(__dirname, 'snapshots', 'delivery-link-email.html');
    var body = html.slice(html.indexOf('<body'));
    var visible = body.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '');
    assert.ok(/^<!DOCTYPE html>/.test(html));
    assert.strictEqual(/display:\s*flex|grid/i.test(html), false);
    assert.strictEqual((body.match(/display:\s*none/gi) || []).length, 1, 'only the preheader span');
    assert.strictEqual(html.indexOf('<div'), -1);
    assert.strictEqual(html.indexOf('<script'), -1);
    assert.ok(html.indexOf('UFH &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;') > 0, 'description escaped');
    assert.ok(html.indexOf('Part 2 &lt;b&gt;first floor&lt;/b&gt;') > 0, 'split reference escaped');
    assert.ok(html.indexOf('Barn &lt;conversion&gt;') > 0);
    assert.ok(html.indexOf('Hello Sam &amp; &lt;Co&gt;') > 0);
    assert.ok(html.indexOf('READY TO DELIVER') > 0 && html.indexOf('Choose your delivery date') > 0);
    assert.ok(html.indexOf('Good news: your order below is ready to deliver.') > 0);
    assert.ok(html.indexOf('Order SO100 · UFH') > 0);
    assert.strictEqual(visible.split(render.esc(m.link)).length - 1, 1, 'the direct link once in the visible markup');
    assert.ok(html.indexOf('href="' + render.esc(m.dashboardLink) + '"') > 0);
    assert.ok(html.indexOf('<b>ARRANGE DELIVERY</b>') > 0 && html.indexOf('>Or view all your projects</font></a>') > 0);
    assert.ok(html.indexOf('This link is personal to you. Please don’t forward this email.') > 0);
    assert.ok(html.indexOf('<b>Pat Lee</b>') > 0);
    assert.ok(html.indexOf('You’re receiving this because you have an order with Nu-Heat.') > 0);
    ['stop these updates', 'You get this update', 'reply to this email', 'opt'].forEach(function (t) {
        assert.strictEqual(html.indexOf(t), -1, 'no digest opt-out wording: ' + t);
    });
    assert.strictEqual(render.deliveryLinkSubject(config.DELIVERY_LINK_EMAIL, 'SO100'),
        'Your order SO100 is ready to deliver: choose your date');
    if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(snap)) {
        fs.writeFileSync(snap, html + '\n');
    }
    assert.strictEqual(html + '\n', fs.readFileSync(snap, 'utf8'), 'snapshot (UPDATE_SNAPSHOTS=1 to rewrite)');
});

test('9. no split reference, no description: the fallbacks', function () {
    var m = emailModel();
    m.order.uniqueRef = '';
    m.order.description = '';
    var html = render.deliveryLinkEmail(m);
    assert.ok(html.indexOf('>UFH</font></p>') > 0, 'the type label as the title');
    assert.ok(html.indexOf('>Order SO100</font></p>') > 0, 'the label not shown twice');
    m.am = { name: '' };
    assert.strictEqual(render.deliveryLinkEmail(m).indexOf('Your account manager'), -1);
});

// ---------------------------------------------------------------- 10. configuration

test('10. config.load from the new Suitelet reads the cdbsend_ IDs', function () {
    var asked = [];
    var c = amd.load('lib/cdb_lib_config', { 'N/runtime': { getCurrentScript: function () {
        return { id: 'customscript_cdb_sl_send_link', getParameter: function (o) {
            asked.push(o.name);
            return sendParams()[o.name];
        } };
    } } });
    var cfg = c.load({ audit: function () {}, error: function () {} });
    assert.deepStrictEqual(asked.slice().sort(), Object.keys(sendParams()).sort());
    assert.deepStrictEqual(cfg, { EXCLUDED_STATUSES: ['90'], EXCLUDED_QUOTE_TYPES: ['7', '8'], FALLBACK_EMPLOYEE: '500',
        RELEASED_STATUSES: ['2'], LOGO_URL: 'https://www.nu-heat.co.uk/logo.png', QUOTE_TYPE_LABELS: '' });
});

test('10. cdbsend_: empty means what it means on the dashboard', function () {
    var v = sendParams();
    v.custscript_cdbsend_released_statuses = '';
    v.custscript_cdbsend_logo_url = '';
    var r = config.readParameters(function (id) { return v[id]; }, 'SEND');
    assert.deepStrictEqual(r.missing, []);
    assert.deepStrictEqual(r.config.RELEASED_STATUSES, []);
    assert.strictEqual(r.config.LOGO_URL, '');
    v = sendParams();
    v.custscript_cdbsend_excluded_statuses = '';
    v.custscript_cdbsend_excluded_quote_types = '';
    v.custscript_cdbsend_fallback_employee = '';
    r = config.readParameters(function (id) { return v[id]; }, 'SEND');
    assert.deepStrictEqual(r.missing, ['custscript_cdbsend_excluded_statuses', 'custscript_cdbsend_excluded_quote_types',
        'custscript_cdbsend_fallback_employee']);
    Object.keys(config.PARAMETERS).forEach(function (k) {
        var sendId = config.PARAMETERS[k].ids.SEND;
        var slId = config.PARAMETERS[k].ids.SL;
        if (sendId) {
            assert.strictEqual(sendId, slId.replace('custscript_cdb_', 'custscript_cdbsend_'), k + ' twins its SL ID');
        }
    });
});

/** Every SL and MR parameter ID as of 1.3.2 (main, b3064db). */
var BEFORE_2_0 = {
    WON_STATUSES: { SL: 'custscript_cdb_won_statuses', MR: 'custscript_cdbmr_won_statuses' },
    LOST_STATUSES: { SL: 'custscript_cdb_lost_statuses', MR: 'custscript_cdbmr_lost_statuses' },
    DESIGN_SUBSTATUS: { SL: 'custscript_cdb_design_substatus', MR: 'custscript_cdbmr_design_substatus' },
    NEEDINFO_SUBSTATUS: { SL: 'custscript_cdb_needinfo_substatus', MR: 'custscript_cdbmr_needinfo_substatus' },
    DELIVERY_SUBSTATUS: { SL: 'custscript_cdb_delivery_substatus', MR: 'custscript_cdbmr_delivery_substatus' },
    EXCLUDED_STATUSES: { SL: 'custscript_cdb_excluded_statuses', MR: 'custscript_cdbmr_excluded_statuses' },
    EXCLUDED_QUOTE_TYPES: { SL: 'custscript_cdb_excluded_quote_types', MR: 'custscript_cdbmr_excluded_quote_types' },
    PAY_BACS: { SL: 'custscript_cdb_pay_bacs', MR: 'custscript_cdbmr_pay_bacs' },
    PAY_CARD: { SL: 'custscript_cdb_pay_card', MR: 'custscript_cdbmr_pay_card' },
    FALLBACK_EMPLOYEE: { SL: 'custscript_cdb_fallback_employee', MR: 'custscript_cdbmr_fallback_employee' },
    PREPAY_TERMS: { SL: 'custscript_cdb_prepay_terms' },
    PAY_ACCOUNT: { SL: 'custscript_cdb_pay_account', MR: 'custscript_cdbmr_pay_account' },
    RELEASED_STATUSES: { SL: 'custscript_cdb_released_statuses', MR: 'custscript_cdbmr_released_statuses' },
    RECENT_DAYS: { SL: 'custscript_cdb_recent_days', MR: 'custscript_cdbmr_recent_days' },
    RECENT_HIDDEN_STATUSES: { SL: 'custscript_cdb_recent_hidden_statuses', MR: 'custscript_cdbmr_recent_hidden_statuses' },
    QUOTE_TYPE_LABELS: { SL: 'custscript_cdb_quote_type_labels', MR: 'custscript_cdbmr_quote_type_labels' },
    LOGO_URL: { SL: 'custscript_cdb_logo_url', MR: 'custscript_cdbmr_logo_url' },
    TIME_VALUES: { SL: 'custscript_cdb_time_values' },
    VEHICLE_VALUES: { SL: 'custscript_cdb_vehicle_values' },
    UNLOAD_VALUES: { SL: 'custscript_cdb_unload_values' },
    PE_VALUEPROPS: { SL: 'custscript_cdb_pe_valueprops' },
    NOTICE_DAYS: { SL: 'custscript_cdb_notice_days' },
    BANK_NAME: { SL: 'custscript_cdb_bank_name' },
    BANK_SORT: { SL: 'custscript_cdb_bank_sort' },
    BANK_ACCOUNT: { SL: 'custscript_cdb_bank_account' },
    OPTION_HINTS: { SL: 'custscript_cdb_option_hints' },
    EDD_DEFINITE: { SL: 'custscript_cdb_edd_definite_value' },
    DIGEST_MODE: { MR: 'custscript_cdb_digest_mode' },
    DIGEST_TEST_CUSTOMERS: { MR: 'custscript_cdb_digest_test_customers' },
    DIGEST_DAYS: { MR: 'custscript_cdb_digest_days' },
    DIGEST_CAP: { MR: 'custscript_cdb_digest_cap' }
};

test('10. the dashboard and digest keys are unchanged', function () {
    var now = {};
    Object.keys(config.PARAMETERS).forEach(function (k) {
        var ids = config.PARAMETERS[k].ids;
        now[k] = {};
        if (ids.SL) { now[k].SL = ids.SL; }
        if (ids.MR) { now[k].MR = ids.MR; }
    });
    assert.deepStrictEqual(now, BEFORE_2_0);
});
