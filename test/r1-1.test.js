'use strict';
/**
 * Release 1.1: quote description, option hints, the two new sales order fields, the calendar
 * without script, no dead links, the email and the phone layout. Numbered as the brief's table.
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');
var fx = require('./helpers/fixtures');

var PURE = { 'N/search': {}, 'N/record': {}, 'N/format': {}, 'N/runtime': {} };
var render = amd.load('lib/cdb_lib_render');
var data = amd.load('lib/cdb_lib_data', PURE);
var config = amd.load('lib/cdb_lib_config', { 'N/runtime': {} });
var dates = amd.load('lib/cdb_lib_dates');

var SRC = path.join(__dirname, '..', 'src', 'FileCabinet', 'SuiteScripts', 'NuHeat', 'Customer Dashboard');

// ---------------------------------------------------------------- harness

function run(sl, method, params) {
    var out = { html: '' };
    sl.onRequest({
        request: { method: method, parameters: params },
        response: { setHeader: function () {}, write: function (o) { out.html += o.output; } }
    });
    return out.html;
}

function setup(tweak) {
    var w = ns.world();
    w.orders[100].quoteDescription = 'Underfloor heating &lt;b&gt;Ground&lt;/b&gt; floor';
    if (tweak) { tweak(w); }
    var s = ns.stubs(w);
    var tok = amd.load('lib/cdb_lib_token', s).sign(42, 0);
    return { w: w, sl: amd.load('cdb_sl_dashboard', s), tok: tok };
}

/** Sets Suitelet parameters on top of the stub's defaults. */
function withParams(extra) {
    return function (w) {
        var base = ns.stubs(ns.world())['N/runtime'].getCurrentScript();
        var p = {};
        ['custscript_cdb_won_statuses', 'custscript_cdb_lost_statuses', 'custscript_cdb_design_substatus',
            'custscript_cdb_needinfo_substatus', 'custscript_cdb_delivery_substatus', 'custscript_cdb_excluded_statuses',
            'custscript_cdb_excluded_quote_types', 'custscript_cdb_pay_bacs', 'custscript_cdb_pay_card',
            'custscript_cdb_fallback_employee', 'custscript_cdb_logo_url', 'custscript_cdb_time_values',
            'custscript_cdb_vehicle_values', 'custscript_cdb_unload_values', 'custscript_cdb_pe_valueprops',
            'custscript_cdb_notice_days', 'custscript_cdb_bank_name', 'custscript_cdb_bank_sort',
            'custscript_cdb_bank_account', 'custscript_cdb_edd_definite_value', 'custscript_cdb_option_hints']
            .forEach(function (id) { p[id] = base.getParameter({ name: id }); });
        Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
        w.params = p;
    };
}

function firstDate() {
    return dates.firstAllowedDate(dates.londonTodayKey(Date.now()), 3, {});
}

function form(tok, extra) {
    var f = { t: tok, a: 'delivery', so: '100', date: firstDate(), time: '5', address: '900', vehicle: '2', unload: '3',
        contactName: 'Sam Site', contactPhone: '07700 900000', contactEmail: '', requests: '', payment: 'BACS' };
    Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
    return f;
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function deliveryGroups(orderExtra) {
    return data.groupProjects([fx.opp('4', '13', '8', { title: 'Barn conversion' })],
        [fx.order('100', '4', orderExtra || { ready: true })], fx.CFG);
}

function dashboardHtml(groups) {
    return render.dashboard({ customerName: 'Acme', greetingName: 'Acme', logoUrl: '', am: { name: 'Pat Lee', phone: '01234 567890' },
        groups: groups, bank: { name: 'B', sort: 'S', account: 'A' }, payBacs: '1',
        deliveryUrl: function (id) { return 'https://acct.extforms.netsuite.com/sl?t=x&a=delivery&so=' + id; } });
}

function emailModel() {
    var groups = data.groupProjects([
        fx.opp('1', '10', '', { title: 'New build – Plot 4' }),
        fx.opp('2', '13', '4', { title: 'Loft extension' }),
        fx.opp('4', '13', '8', { title: 'Barn conversion' })
    ], [
        fx.order('100', '4', { ready: true, description: 'Underfloor heating Ground floor' }),
        fx.order('102', '4', { payIntent: '1', shipDateKey: '2026-10-13', timeText: 'AM delivery' })
    ], fx.CFG);
    return { customerName: 'Acme Ltd', greetingName: 'Acme Ltd', logoUrl: 'https://www.nu-heat.co.uk/logo.png',
        groups: groups, payBacs: '1', link: 'https://acct.extforms.netsuite.com/sl?t=TOKEN&h=1',
        am: { name: 'Pat Lee', phone: '01234 567890', email: 'pat@example.com' }, digestDays: 14,
        // 2.0.3: each ready order's own direct link, for the action box.
        orderLink: function (id) { return 'https://acct.extforms.netsuite.com/sl?t=TOKEN&a=delivery&so=' + id; } };
}

// ---------------------------------------------------------------- 1-4 quote description

test('1. entities decoded before tags are stripped; no tags; no double encoding', function () {
    assert.strictEqual(data.cleanDescription('Underfloor heating &lt;b&gt;Ground&lt;/b&gt;'), 'Underfloor heating Ground');
    assert.strictEqual(data.cleanDescription('A &amp; B &#163;5 &#x2013; <i>x</i>\n  y'), 'A & B £5 – x y');
    var html = dashboardHtml(deliveryGroups({ ready: true, description: data.cleanDescription('Underfloor heating &lt;b&gt;Ground&lt;/b&gt;') }));
    assert.ok(html.indexOf('>Underfloor heating Ground<') > 0);
    // 1.2 (§6): shown in full, so the title tooltip that went with the clamp is gone.
    assert.strictEqual(html.indexOf('title="Underfloor heating Ground"'), -1, 'no title attribute');
    assert.strictEqual(html.indexOf('&lt;b&gt;'), -1);
    assert.strictEqual(html.indexOf('&amp;lt;'), -1, 'not double encoded');
    assert.strictEqual(/<b>Ground/.test(html), false);
});

test('2. a script description renders as text only', function () {
    var clean = data.cleanDescription('&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.strictEqual(clean, 'alert(1)');
    var html = dashboardHtml(deliveryGroups({ ready: true, description: clean }));
    assert.ok(html.indexOf('alert(1)') > 0);
    var email = render.digestEmail(Object.assign(emailModel(), { groups: deliveryGroups({ ready: true, description: clean }) }));
    [html, email].forEach(function (h) { assert.strictEqual(/<script(?![^>]*>document\.documentElement)/i.test(h.replace(/<script>[\s\S]*?<\/script>/g, '')), false); });
    assert.strictEqual(email.indexOf('<script'), -1);
    assert.strictEqual(html.indexOf('<script'), -1, 'the dashboard has no script at all');
});

test('3. fallbacks: empty description -> quote type; both empty -> "Your order"', function () {
    assert.strictEqual(render.orderTitle({ description: '', quoteTypeText: 'Heat Pump' }), 'Heat Pump');
    assert.strictEqual(render.orderTitle({ description: '', quoteTypeText: '' }), 'Your order');
    var html = dashboardHtml(deliveryGroups({ ready: true, description: '', quoteTypeText: '' }));
    assert.ok(html.indexOf('>Your order<') > 0);
    html = dashboardHtml(deliveryGroups({ ready: true, description: '', quoteTypeText: 'Heat Pump' }));
    assert.ok(html.indexOf('>Heat Pump<') > 0);
    assert.ok(html.indexOf('Order SO100<') > 0, 'the quote type is not repeated in the muted line');
});

test('4. the sales order searches read the description through createdFrom only', function () {
    var s = setup();
    run(s.sl, 'GET', { t: s.tok });
    run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    // 1.2: the separate extras search (it reads terms) is not a main order search.
    var so = s.w.searches.filter(function (d) { return d.type === 'salesorder' && d.columns.indexOf('terms') < 0; });
    assert.ok(so.length >= 2, 'dashboard and guard searches');
    so.forEach(function (d) {
        var joined = d.columns.filter(function (c) { return c && c.name === 'custbody_quote_description'; });
        assert.strictEqual(joined.length, 1);
        assert.strictEqual(joined[0].join, 'createdFrom');
        assert.strictEqual(d.columns.indexOf('custbody_quote_description'), -1, 'no unjoined column');
    });
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('>Underfloor heating Ground floor<') > 0, 'the joined value reaches the page');
});

test('3b. the description reaches the form heading, the aside and the confirmation', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('Barn · Underfloor heating Ground floor · Order SO100') > 0, 'heading');
    assert.ok(html.indexOf('<span>System</span><span>Underfloor heating Ground floor</span>') > 0, 'aside');
    html = run(s.sl, 'POST', form(s.tok));
    assert.ok(html.indexOf('for Underfloor heating Ground floor (order SO100)') > 0, 'confirmation');
});

// ---------------------------------------------------------------- 5-6 hints

test('5. hints: valid, partial, invalid, empty; the page renders every time', function () {
    var cases = [
        { raw: '{"vehicle":{"1":"Up to 16 m","2":"Rigid lorry"},"unload":{"1":"Tail lift","2":"Forklift","3":"By hand"}}',
            shown: ['Up to 16 m', 'Rigid lorry', 'Tail lift', 'By hand'], logged: 0 },
        { raw: '{"vehicle":{"2":"Rigid lorry"}}', shown: ['Rigid lorry'], hidden: ['Up to 16 m'], logged: 0 },
        { raw: '{"vehicle":', shown: [], logged: 1 },
        { raw: '["not","an","object"]', shown: [], logged: 1 },
        { raw: '', shown: [], logged: 0 }
    ];
    cases.forEach(function (c) {
        var s = setup(withParams({ custscript_cdb_option_hints: c.raw }));
        var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
        assert.ok(html.indexOf('Arrange delivery</h1>') > 0, 'renders: ' + c.raw);
        assert.ok(html.indexOf('<span class="ot">Artic</span>') > 0, 'titles always: ' + c.raw);
        c.shown.forEach(function (h) { assert.ok(html.indexOf('<span class="oh">' + h + '</span>') > 0, h); });
        (c.hidden || []).forEach(function (h) { assert.strictEqual(html.indexOf(h), -1, h); });
        if (!c.shown.length) { assert.strictEqual(html.indexOf('class="oh">Up'), -1); }
        assert.strictEqual(logs(s.w, 'OPTION_HINTS_INVALID').length, c.logged, 'logs: ' + c.raw);
    });
    assert.strictEqual(config.parseOptionHints('{"vehicle":{"x":"no","3":7,"4":"yes"}}').hints.vehicle['4'], 'yes');
    assert.deepStrictEqual(Object.keys(config.parseOptionHints('{"vehicle":{"x":"no","3":7}}').hints.vehicle), []);
});

test('6. a hint with markup is escaped', function () {
    var s = setup(withParams({ custscript_cdb_option_hints: '{"vehicle":{"1":"<img src=x onerror=alert(1)>"}}' }));
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.strictEqual(html.indexOf('<img src=x'), -1);
    assert.ok(html.indexOf('&lt;img src=x onerror=alert(1)&gt;') > 0);
});

test('4b. the guidance panel and the new vehicle label', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('<div class="tip"><p><strong>Most deliveries come on an articulated lorry, up to 16 m long and 4 m tall.</strong>') > 0);
    assert.ok(html.indexOf('Pallets can weigh up to 1,250 kg.') > 0);
    assert.ok(html.indexOf('<legend>Largest vehicle that can reach the property</legend>') > 0);
    assert.ok(html.indexOf('Access and unloading</h2>') > 0);
});

// ---------------------------------------------------------------- 7-10 the two new fields

function soUpdated(w) {
    var l = logs(w, 'SO_UPDATED')[0];
    return JSON.parse(l[2].slice(l[2].indexOf(': [') + 2));
}

test('7. a booking ticks awaiting payment and sets EDD certainty; both in the change list', function () {
    ['BACS', 'CARD'].forEach(function (pay) {
        var s = setup();
        run(s.sl, 'POST', form(s.tok, { payment: pay }));
        var saved = s.w.saves[0].values;
        assert.strictEqual(saved.custbody_cdb_awaiting_payment, true, pay);
        assert.strictEqual(saved.custbody_edd_certainty, '3', pay);
        var changes = soUpdated(s.w);
        var labels = changes.map(function (c) { return c.label; });
        assert.ok(labels.indexOf('Awaiting customer payment') >= 0);
        assert.ok(labels.indexOf('EDD certainty') >= 0);
        assert.strictEqual(changes.filter(function (c) { return c.label === 'EDD certainty'; })[0].newText, 'Customer Definite');
        assert.strictEqual(saved.custbody_del_date, undefined);
        assert.strictEqual(saved.custbody_finance_status, undefined);
    });
});

test('8. EDD parameter empty: no EDD write, CDB EDD_SKIPPED, the booking succeeds', function () {
    var s = setup(withParams({ custscript_cdb_edd_definite_value: '' }));
    var html = run(s.sl, 'POST', form(s.tok));
    assert.ok(html.indexOf('Delivery requested</h1>') > 0);
    assert.strictEqual(s.w.saves.length, 1);
    assert.strictEqual(s.w.saves[0].values.hasOwnProperty('custbody_edd_certainty'), false);
    assert.strictEqual(s.w.saves[0].values.custbody_cdb_awaiting_payment, true);
    assert.strictEqual(logs(s.w, 'EDD_SKIPPED').length, 1);
});

test('9. a field missing from the record is skipped with CDB FIELD_MISSING; the booking succeeds', function () {
    var s = setup(function (w) { w.missingFields = ['custbody_cdb_awaiting_payment', 'custbody_edd_certainty']; });
    var html = run(s.sl, 'POST', form(s.tok));
    assert.ok(html.indexOf('Delivery requested</h1>') > 0);
    assert.strictEqual(s.w.saves.length, 1);
    assert.strictEqual(s.w.saves[0].values.hasOwnProperty('custbody_cdb_awaiting_payment'), false);
    assert.strictEqual(s.w.saves[0].values.hasOwnProperty('custbody_edd_certainty'), false);
    assert.strictEqual(logs(s.w, 'FIELD_MISSING').length, 2);
    assert.ok(logs(s.w, 'FIELD_MISSING')[0][2].indexOf('custbody_cdb_awaiting_payment') > 0);
    assert.strictEqual(s.w.tasks.length, 1, 'the Task is still created');
});

test('10. nothing in the source unticks awaiting payment', function () {
    function walk(dir) {
        return fs.readdirSync(dir).reduce(function (all, f) {
            var p = path.join(dir, f);
            return all.concat(fs.statSync(p).isDirectory() ? walk(p) : (/\.js$/.test(f) ? [p] : []));
        }, []);
    }
    var writes = 0;
    walk(SRC).forEach(function (file) {
        var code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        var re = /(AWAITING_PAYMENT|custbody_cdb_awaiting_payment)[^;]{0,160}/g;
        var m;
        while ((m = re.exec(code)) !== null) {
            assert.strictEqual(/\b(false|'F'|"F"|0)\b/.test(m[0].replace(/'F'|"F"/g, ' F ')), false, file + ': ' + m[0]);
            if (/value:\s*true/.test(m[0])) { writes++; }
        }
    });
    assert.strictEqual(writes, 1, 'exactly one write, of true');
});

// ---------------------------------------------------------------- 11-14 markup

test('11. without script every allowed day is a radio input inside the form', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    var formHtml = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    var today = dates.londonTodayKey(Date.now());
    var allowed = dates.allowedDates(today, 3, {}, 6);
    var radios = formHtml.match(/<input class="sr" type="radio" name="date" value="\d{4}-\d{2}-\d{2}"/g) || [];
    assert.strictEqual(radios.length, allowed.length);
    assert.strictEqual((html.match(/name="date"/g) || []).length, allowed.length, 'none outside the form');
    assert.ok(html.indexOf('value="' + allowed[0] + '"') > 0);
    assert.strictEqual((formHtml.match(/class="month"/g) || []).length, 7, 'every month renders');
    assert.ok(render.css().indexOf('.js .month{display:none}.js .month.on{display:block}') >= 0, 'only script hides months');
    assert.ok(html.indexOf('<input class="sr" type="radio" name="time"') > 0, 'time is a segmented radio');
});

test('12. no dead links in any page or the email', function () {
    var s = setup();
    var pages = [
        run(s.sl, 'GET', { t: s.tok }),
        run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' }),
        run(s.sl, 'POST', form(s.tok)),
        run(s.sl, 'GET', { t: s.tok }),
        render.confirmation({ am: { name: 'Pat Lee', phone: '1', email: 'p@x' }, payment: 'CARD', bank: {}, tranId: 'SO1',
            orderTitle: 'X', backUrl: 'https://x/sl?t=1' }),
        render.invalidPage(''),
        render.errorPage(''),
        render.digestEmail(emailModel())
    ];
    pages.forEach(function (h, i) {
        assert.strictEqual(/href="#/.test(h), false, 'page ' + i);
        assert.strictEqual(/href=""/.test(h), false, 'page ' + i);
        ['Start a new project', 'Place order', 'Tell us where you', 'Add design information', 'Provide information',
            'Request design changes', 'View quote', 'View design'].forEach(function (t) {
            assert.strictEqual(h.indexOf(t), -1, t + ' on page ' + i);
        });
    });
});

test('13. email: tables, Outlook-safe, the link once, the AM card, the footer; snapshot', function () {
    // 2.0.2 (PR #5 amendment 2): the email is a whole document in the customer email standard (Send
    // Quote 2.2.0's card): the preheader is the one display:none outside the phone media query, the
    // CTA URL appears in the visible markup once (and once more inside its [if mso] twin), and the
    // footer, the social icons and an AM photo are images too.
    var m = emailModel();
    var html = render.digestEmail(m);
    var snap = path.join(__dirname, 'snapshots', 'digest-email.html');
    var body = html.slice(html.indexOf('<body'));
    var visible = body.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '');
    assert.ok(/^<!DOCTYPE html>/.test(html));
    assert.strictEqual(/display:\s*flex|grid/i.test(html), false);
    assert.strictEqual((body.match(/display:\s*none/gi) || []).length, 1, 'only the preheader span');
    assert.strictEqual(html.indexOf('<div'), -1);
    assert.strictEqual(html.indexOf('fonts.googleapis'), -1, 'no web font in the email');
    assert.strictEqual(visible.split(render.esc(m.link)).length - 1, 1, 'the CTA URL once in the visible markup');
    assert.strictEqual(html.split(render.esc(m.link)).length - 1, 2, 'and once in its Outlook twin');
    assert.ok(html.indexOf('><b>VIEW ALL YOUR PROJECTS</b></font></a>') > 0, '2.0.3 wording');
    assert.ok(html.indexOf('YOUR PROJECTS UPDATE') > 0);
    assert.ok(html.indexOf('Here’s where everything stands') > 0);
    // 2.0.3: the v2 action box replaces the callout sentences.
    assert.ok(html.indexOf('<b>1 order is ready to deliver</b>') > 0);
    assert.ok(html.indexOf('href="https://acct.extforms.netsuite.com/sl?t=TOKEN&amp;a=delivery&amp;so=100"') > 0);
    assert.ok(html.indexOf('<b>YOUR ACCOUNT MANAGER</b>') > 0 && html.indexOf('<b>Pat Lee</b>') > 0);
    assert.ok(html.indexOf('mailto:pat@example.com') > 0 && html.indexOf('tel:01234567890') > 0);
    assert.ok(html.indexOf('This link is personal to you. Please don’t forward this email.') > 0);
    assert.ok(html.indexOf('You get this update every 2 weeks while you have an open project or order with us.<br>' +
        // PR #3 amendment 2: the contact rule — a phone number, so "call … on …".
        'To stop these updates, reply to this email or call Pat Lee on 01234 567890.') > 0);
    // 1.2 (§6): the order's own lines — description in full, then the muted "Order SO… · type · state".
    assert.ok(html.indexOf('>Underfloor heating Ground floor</b></font></p>') > 0, 'description line');
    assert.ok(html.indexOf('Order SO100 · Underfloor heating system · ready to arrange delivery') > 0, 'order line');
    assert.strictEqual(body.indexOf('<img src="https://www.nu-heat.co.uk/logo.png"'), body.indexOf('<img'), 'the logo first');
    assert.strictEqual((html.match(/<img/g) || []).length, 7, 'the logo, the footer logo and five social icons; no photo');
    if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(snap)) {
        fs.writeFileSync(snap, html + '\n');
    }
    assert.strictEqual(html + '\n', fs.readFileSync(snap, 'utf8'), 'snapshot (UPDATE_SNAPSHOTS=1 to rewrite)');
});

test('13b. no callout when there is nothing to do', function () {
    var m = emailModel();
    m.groups = data.groupProjects([fx.opp('2', '13', '4')], [], fx.CFG);
    assert.strictEqual(render.digestEmail(m).indexOf('#fffaf0'), -1);
});

test('14. phone: the 720 px media query stacks the rows; nothing is fixed wider than 360', function () {
    var css = render.css();
    var i = css.indexOf('@media (max-width:719px){');
    assert.ok(i > 0);
    var phone = css.slice(i);
    assert.ok(phone.indexOf('.row,.oprow,.sorow{display:flex;flex-direction:column;align-items:stretch') > 0);
    assert.ok(phone.indexOf('.colhead{display:none}') > 0);
    assert.ok(phone.indexOf('.cta,.out{display:flex;width:100%;min-height:48px') > 0);
    assert.ok(phone.indexOf('.am-call{display:flex}') > 0);
    assert.ok(css.indexOf('@media (max-width:899px){.layout{grid-template-columns:minmax(0,1fr)}') > 0, 'aside under the form');
    assert.ok(css.indexOf('.w1200{max-width:1248px}') >= 0, '1200 px content plus the 24 px gutters');
    // No fixed width above 360 px outside a media query that removes it.
    var fixed = css.slice(0, css.indexOf('@media')).match(/(?:^|[;{])(?:min-)?width:\s*(\d+)px/g) || [];
    fixed.forEach(function (f) { assert.ok(parseInt(f.replace(/\D/g, ''), 10) <= 360, f); });
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<a class="am-call" href="tel:') > 0, 'the phone icon calls the account manager');
});
