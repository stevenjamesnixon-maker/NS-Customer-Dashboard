'use strict';
/**
 * Release 2.0.2 (PR #5 amendment 2): one customer email standard — Send Quote 2.2.0's email card,
 * copied from 2026.03-Online-quote (commit 4463cfa). Both emails: the digest and the delivery link.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');
var fx = require('./helpers/fixtures');

var config = amd.load('lib/cdb_lib_config', { 'N/runtime': {} });
var render = amd.load('lib/cdb_lib_render');
var data = amd.load('lib/cdb_lib_data', { 'N/search': {}, 'N/record': {}, 'N/format': {}, 'N/runtime': {}, 'N/log': {} });
var STD = config.EMAIL_STANDARD;

var AM = { name: 'John Smith', firstName: 'John', phone: '01234 567 890', email: 'john@example.com', photoUrl: '' };

function digest(am) {
    var groups = data.groupProjects([fx.opp('4', '13', '8', { title: 'Barn' })],
        [fx.order('100', '4', { ready: true, description: 'UFH ground floor' })], fx.CFG);
    data.arrangeSections(groups);
    return render.digestEmail({ customerName: 'Acme', greetingName: 'Sam', logoUrl: 'https://www.nu-heat.co.uk/logo.png',
        groups: groups, payBacs: '1', link: 'https://acct.extforms.netsuite.com/sl?t=T', title: 'Your Nu-Heat projects: an update',
        orderLink: function (id) { return 'https://acct.extforms.netsuite.com/sl?t=T&a=delivery&so=' + id; },
        am: am === undefined ? AM : am, digestDays: 14 });
}

function delivery(am) {
    return render.deliveryLinkEmail({ customerName: 'Acme', greetingName: 'Sam', logoUrl: 'https://www.nu-heat.co.uk/logo.png',
        opp: { title: 'Barn' }, order: { id: '100', tranId: 'SO100', description: 'UFH ground floor', uniqueRef: '',
            typeLabel: 'UFH' },
        link: 'https://acct.extforms.netsuite.com/sl?t=T&a=delivery&so=100', dashboardLink: 'https://acct.extforms.netsuite.com/sl?t=T',
        am: am === undefined ? AM : am });
}

var EMAILS = { digest: digest, delivery: delivery };

/** Every style attribute and every <style> block removed, as NetSuite's Communication tab view does. */
function stripped(html) {
    return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/\sstyle="[^"]*"/g, '');
}

/** The body as a non-Outlook client sees it: the [if mso] halves are comments. */
function visible(html) {
    return html.slice(html.indexOf('<body')).replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '');
}

function hrefs(html) {
    return (html.match(/<a href="[^"]*"/g) || []).map(function (a) { return a.slice(9, -1); });
}

// ---------------------------------------------------------------- stripped styles

Object.keys(EMAILS).forEach(function (kind) {
    test(kind + ': centred, single-column with every style removed', function () {
        var html = stripped(EMAILS[kind]());
        var card;
        assert.strictEqual(html.indexOf('style='), -1);
        assert.ok(/<table role="presentation" class="width600 main-container" width="600" align="center"/.test(html),
            'the container: width="600" align="center"');
        // Each button's cell carries its colour as bgcolor (the visible half and the Outlook half).
        // 2.0.3: digest CHOOSE DATE, VIEW ALL, CALL, EMAIL; delivery CHOOSE MY DELIVERY DATE, CALL, EMAIL.
        var buttons = html.match(/<td[^>]*><a href="[^"]*" target="_blank"><font face="[^"]*" color="#[0-9a-f]{6}"><b>/g) || [];
        assert.strictEqual(buttons.length, (kind === 'digest' ? 4 : 3) * 2, kind + ': button cells, both halves');
        buttons.forEach(function (td) { assert.ok(/ bgcolor="#[0-9a-f]{6}"/.test(td), td); });
        // The AM card: every cell centred by attribute.
        card = html.slice(html.indexOf('class="main-card"'), html.indexOf('</table>\n</td></tr>\n<tr><td align="center" valign="top" bgcolor="#00857d"'));
        (card.match(/<td[^>]*>/g) || []).forEach(function (td) { assert.ok(/ align="center"/.test(td), td); });
        // Every cell has align and valign attributes; no floats anywhere.
        (html.match(/<td[\s>][^>]*>|<td>/g) || []).forEach(function (td) {
            assert.ok(/ align="/.test(td) && / valign="/.test(td), td);
        });
        assert.strictEqual(/float/i.test(EMAILS[kind]()), false);
        // Colours survive as attributes: the band, the buttons and the teal footer (2.0.3).
        assert.ok(html.indexOf('bgcolor="#59315f"') > 0 && html.indexOf('bgcolor="#25847a"') > 0);
        // Two-up content is two td width="50%", never a percentage-width table side by side.
        assert.strictEqual((html.match(/<td class="stack" width="50%"/g) || []).length, 2);
        assert.strictEqual(/display:\s*none/.test(html), false, 'no display:none once stripped');
        assert.strictEqual(/<table[^>]*width="50%"/.test(html), false);
    });

    test(kind + ': exactly one <a> per button target in the visible markup; one [if mso] pair per button', function () {
        var html = EMAILS[kind]();
        var vis = hrefs(visible(html));
        // 2.0.3: the digest's dashboard link is the VIEW ALL button; the ready order's CHOOSE DATE is its
        // own direct link. The "need it sooner" tel: link is text, not a button, in the delivery email.
        var targets = ['mailto:john@example.com', 'https://acct.extforms.netsuite.com/sl?t=T&amp;a=delivery&amp;so=100'].concat(
            kind === 'digest' ? ['tel:01234567890', 'https://acct.extforms.netsuite.com/sl?t=T'] : []);
        var n = kind === 'digest' ? 4 : 3;
        targets.forEach(function (t) {
            assert.strictEqual(vis.filter(function (h) { return h === t; }).length, 1, t);
        });
        if (kind === 'delivery') {
            assert.strictEqual(vis.filter(function (h) { return h === 'tel:01234567890'; }).length, 2, 'the CALL button and the sooner line');
        }
        assert.strictEqual((html.match(/<!--\[if !mso\]><!-- -->/g) || []).length, n, n + ' buttons');
        assert.strictEqual((html.match(/<!--\[if mso\]>\n<table/g) || []).length, n, n + ' Outlook twins');
        assert.strictEqual(/<div[^>]*display:\s*none/.test(html), false, 'no display:none wrappers');
    });

    test(kind + ': the Send Quote footer and its five social links', function () {
        var html = EMAILS[kind]();
        STD.SOCIAL_LINKS.forEach(function (l) {
            assert.ok(html.indexOf('<a href="' + l[0] + '" target="_blank"><img src="' + STD.IMG_BASE + l[1] + '" width="22" height="22"') > 0, l[0]);
        });
        assert.ok(html.indexOf('<img src="' + STD.IMG_BASE + STD.FOOTER_LOGO + '" width="167" height="94"') > 0);
    });
});

test('footer line and preheader per email', function () {
    var d = digest();
    var l = delivery();
    assert.ok(d.indexOf('>You get this update every 2 weeks while you have an open project or order with us.<br>To stop these ' +
        'updates, reply to this email or call John Smith on 01234 567 890.</font></p>') > 0);
    assert.ok(l.indexOf('>You’re receiving this because you have an order with Nu-Heat.</font></p>') > 0);
    assert.strictEqual(l.indexOf('stop these updates'), -1);
    assert.ok(/<body[^>]*>\n<span style="display:none;[^"]*">Here’s where your Nu-Heat projects are up to.<\/span>/.test(d));
    assert.ok(/<body[^>]*>\n<span style="display:none;[^"]*">Your order is ready: choose your delivery date.<\/span>/.test(l));
    assert.ok(d.indexOf('<title>Your Nu-Heat projects: an update</title>') > 0);
    assert.ok(l.indexOf('<title>Your order SO100 is ready to deliver: choose your date</title>') > 0);
});

// ---------------------------------------------------------------- the AM card buttons

function card(am) {
    return render.emailRepCard(am);
}

test('buttons: CALL / EMAIL the first name; else the first word of the name; else generic', function () {
    var html = card(AM);
    assert.ok(html.indexOf('<b>CALL JOHN</b>') > 0 && html.indexOf('<b>EMAIL JOHN</b>') > 0);
    html = card(Object.assign({}, AM, { firstName: '', name: 'Johnny B Goode' }));
    assert.ok(html.indexOf('<b>CALL JOHNNY</b>') > 0 && html.indexOf('<b>EMAIL JOHNNY</b>') > 0);
    html = card(Object.assign({}, AM, { firstName: '', name: '' }));
    assert.ok(html.indexOf('<b>CLICK TO CALL</b>') > 0 && html.indexOf('<b>SEND AN EMAIL</b>') > 0);
    assert.ok(html.indexOf('<b>Your Account Manager</b>') > 0, 'Send Quote\'s generic name');
});

test('2.0.3 contact fallback: no phone -> 01404 540604; no email -> info@nu-heat.co.uk (Send Quote)', function () {
    var html = card(Object.assign({}, AM, { phone: '' }));
    assert.ok(html.indexOf('href="tel:01404540604"') > 0 && html.indexOf('<b>CALL JOHN</b>') > 0);
    assert.ok(html.indexOf('<span class="cl-line">01404 540604</span>') > 0, 'the phone text too');
    html = card(Object.assign({}, AM, { email: '' }));
    assert.ok(html.indexOf('href="mailto:info@nu-heat.co.uk"') > 0 && html.indexOf('<b>EMAIL JOHN</b>') > 0);
    assert.ok(html.indexOf('<span class="cl-line">info@nu-heat.co.uk</span>') > 0, 'the email text too');
    assert.ok(html.indexOf('href="tel:01234567890"') > 0, 'tel: digits only');
    html = card({ name: '', phone: '', email: '' });
    assert.ok(html.indexOf('<b>CLICK TO CALL</b>') > 0 && html.indexOf('<b>SEND AN EMAIL</b>') > 0);
    assert.strictEqual(/<td[^>]*>\s*<\/td>/.test(html), false, 'no empty cell');
    // CALL is filled purple; EMAIL is a purple outline (an outer purple cell around a white one).
    html = card(AM);
    assert.ok(/<td align="center" valign="middle" bgcolor="#59315f"[^>]*><a href="tel:/.test(html), 'CALL filled');
    assert.ok(/bgcolor="#59315f"[^>]*>\n<table[^>]*bgcolor="#ffffff"[\s\S]*?<a href="mailto:/.test(html), 'EMAIL outlined');
});

test('photo: an https URL is a 96px circle with alt; anything else leaves no image and no empty cell', function () {
    var html = card(Object.assign({}, AM, { photoUrl: 'https://cdn.example.com/john.jpg' }));
    assert.ok(html.indexOf('<img src="https://cdn.example.com/john.jpg" width="96" height="96" alt="John Smith"') > 0);
    ['http://cdn.example.com/john.jpg', '', 'javascript:alert(1)', 'https://x/a b.jpg', 'https://x/"onerror=1'].forEach(function (u) {
        var h = card(Object.assign({}, AM, { photoUrl: u }));
        assert.strictEqual(h.indexOf('<img'), -1, u);
        assert.strictEqual(/<td[^>]*>\s*<\/td>/.test(h), false, 'no empty cell: ' + u);
    });
    assert.deepStrictEqual(data.checkPhotoUrl(' https://cdn.example.com/j.jpg '), { url: 'https://cdn.example.com/j.jpg', reason: '' });
    assert.strictEqual(data.checkPhotoUrl('http://x/j.jpg').reason, 'not an https:// URL');
    assert.strictEqual(data.checkPhotoUrl('').reason, 'custentity_employee_photo_link is empty');
});

// ---------------------------------------------------------------- the senders: one lookup, one log

function sendLink(tweak) {
    var w = ns.world();
    w.scriptId = 'customscript_cdb_sl_send_link';
    w.params = { custscript_cdbsend_excluded_statuses: '90', custscript_cdbsend_excluded_quote_types: '7,8',
        custscript_cdbsend_released_statuses: '2', custscript_cdbsend_fallback_employee: '500',
        custscript_cdbsend_logo_url: '', custscript_cdbsend_quote_type_labels: '' };
    if (tweak) { tweak(w); }
    amd.load('cdb_sl_send_link', ns.stubs(w)).onRequest({ request: { method: 'GET', parameters: { so: '100' } },
        response: { setHeader: function () {}, write: function () {} } });
    return w;
}

function photoLogs(w) {
    return w.logs.filter(function (l) { return l[1] === 'CDB AM_PHOTO'; });
}

test('send link: the photo from the author\'s lookup, one CDB AM_PHOTO either way', function () {
    var w = sendLink(function (x) { x.employees[88].custentity_employee_photo_link = ' https://cdn.example.com/ray.jpg '; });
    assert.ok(w.emails[0].body.indexOf('<img src="https://cdn.example.com/ray.jpg" width="96" height="96" alt="Ray Rep"') > 0);
    assert.ok(w.emails[0].body.indexOf('<b>CALL RAY</b>') > 0);
    assert.strictEqual(photoLogs(w).length, 1);
    assert.ok(/Delivery link, sales order 100, employee 88: photo used$/.test(photoLogs(w)[0][2]));
    ['http://cdn.example.com/ray.jpg', '', 'not a url'].forEach(function (u) {
        w = sendLink(function (x) { x.employees[88].custentity_employee_photo_link = u; });
        assert.strictEqual(w.emails.length, 1, u);
        assert.strictEqual(w.emails[0].body.indexOf('alt="Ray Rep"'), -1, u);
        assert.strictEqual(photoLogs(w).length, 1, u);
        assert.ok(photoLogs(w)[0][2].indexOf('photo skipped: ') > 0, u);
    });
});

test('send link: a photo field the account lacks costs the photo only, never the send', function () {
    var w = sendLink(function (x) { x.photoFieldThrows = true; });
    assert.strictEqual(w.emails.length, 1);
    assert.strictEqual(w.emails[0].author, 88, 'still the rep');
    assert.ok(w.emails[0].body.indexOf('<b>Ray Rep</b>') > 0);
    assert.ok(photoLogs(w)[0][2].indexOf('photo skipped: employee lookup with the photo field failed') > 0);
});

test('digest: the same card, one CDB AM_PHOTO per email', function () {
    var w = ns.world();
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42' };
    w.employees[88].custentity_employee_photo_link = 'https://cdn.example.com/ray.jpg';
    amd.load('cdb_mr_digest', ns.stubs(w)).map({ value: JSON.stringify({ customerId: '42' }), write: function () {} });
    assert.strictEqual(w.emails.length, 1);
    assert.strictEqual(w.emails[0].subject, 'Your Nu-Heat projects: an update', 'subject unchanged');
    assert.ok(w.emails[0].body.indexOf('alt="Ray Rep"') > 0 && w.emails[0].body.indexOf('<b>EMAIL RAY</b>') > 0);
    assert.strictEqual(photoLogs(w).length, 1);
    assert.ok(/Digest, customer 42, employee 88: photo used$/.test(photoLogs(w)[0][2]));
});
