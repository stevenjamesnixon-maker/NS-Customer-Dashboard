'use strict';
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var fx = require('./helpers/fixtures');

var render = amd.load('lib/cdb_lib_render');
var data = amd.load('lib/cdb_lib_data', { 'N/search': {}, 'N/record': {}, 'N/format': {}, 'N/runtime': {} });

var LOGO = 'https://www.nu-heat.co.uk/logo.png';

function groups() {
    return data.groupProjects([
        fx.opp('1', '10', '', { title: '<script>alert(1)</script>' }),
        fx.opp('4', '13', '8')
    ], [
        fx.order('100', '4', { ready: true }),
        fx.order('102', '4', { payIntent: '1', shipDateKey: '2026-10-05' })
    ], fx.CFG);
}

function externalUrls(html) {
    return (html.match(/(?:src|href)="(https?:[^"]+)"/g) || []).filter(function (u) {
        // 1.1: the pages load Source Sans 3 from Google Fonts (the email does not).
        return u.indexOf('href="https://fonts.googleapis.com') !== 0 && u.indexOf('href="https://fonts.gstatic.com') !== 0;
    });
}

test('dashboard escapes values and loads nothing but the logo and the font', function () {
    var html = render.dashboard({ customerName: 'A & B', logoUrl: LOGO, am: { name: 'Pat', phone: '01234 5' },
        groups: groups(), bank: { name: 'Bank', sort: '00', account: '1' }, payBacs: '1',
        deliveryUrl: function (id) { return 'https://acct.extforms.netsuite.com/x?t=a&a=delivery&so=' + id; } });
    assert.ok(html.indexOf('<script>') === -1);
    assert.ok(html.indexOf('A &amp; B') > 0);
    assert.ok(html.indexOf('Arrange delivery') > 0);
    assert.ok(html.indexOf('Projects in design') === -1, 'empty section hidden');
    assert.ok(html.indexOf('fonts.googleapis.com/css2?family=Source+Sans+3') > 0, '1.1: font on pages');
    externalUrls(html).forEach(function (u) {
        assert.ok(u.indexOf('src="' + LOGO) === 0 || u.indexOf('href="https://acct.extforms.netsuite.com') === 0, u);
    });
});

test('invalid page says only the generic text', function () {
    var html = render.invalidPage('');
    assert.ok(html.indexOf('This link is no longer valid. Please contact your account manager') > 0);
});

test('digest email: tables, the Send Quote standard, the button and the footer', function () {
    // 2.0.2: a whole document with the Send Quote <style> block (phone stacking); display:none only in
    // the preheader and the media query; external URLs: our logo, our link, and the Send Quote image
    // host and social links (config.EMAIL_STANDARD).
    var std = amd.load('lib/cdb_lib_config', { 'N/runtime': {} }).EMAIL_STANDARD;
    var html = render.digestEmail({ customerName: 'Sam', logoUrl: LOGO, groups: groups(), payBacs: '1',
        link: 'https://acct.extforms.netsuite.com/x?t=a', am: { name: 'Pat', phone: '1', email: 'p@x.com' },
        digestDays: 14 });
    var body = html.slice(html.indexOf('<body'));
    assert.strictEqual((body.match(/display:none/g) || []).length, 1, 'the preheader only');
    assert.strictEqual((html.match(/<style>/g) || []).length, 2, 'the standard block and the Outlook one');
    assert.ok(html.indexOf('VIEW ALL YOUR PROJECTS') > 0, '2.0.3 wording');
    assert.ok(html.indexOf('every 2 weeks') > 0);
    assert.ok(html.indexOf('reply to this email') > 0);
    assert.ok(html.indexOf('ready to deliver</b>') > 0, '2.0.3: the action box');
    externalUrls(html).forEach(function (u) {
        var ok = u.indexOf('src="' + LOGO) === 0 || u.indexOf('href="https://acct.extforms.netsuite.com') === 0 ||
            u.indexOf('src="' + std.IMG_BASE) === 0 || std.SOCIAL_LINKS.some(function (l) { return u === 'href="' + l[0] + '"'; });
        assert.ok(ok, u);
    });
});

test('BACS confirmation shows the reference and no amount', function () {
    var html = render.confirmation({ logoUrl: '', am: { name: 'Pat' }, payment: 'BACS',
        bank: { name: 'Bank', sort: '00-00-00', account: '12345678' }, tranId: 'SO1234', backUrl: 'u',
        dateKey: '2026-10-05', timeText: 'AM delivery' });
    assert.ok(html.indexOf('<div class="srow ref"><span>Reference</span><span>SO1234</span></div>') > 0);
    assert.ok(html.indexOf('once payment reaches us') > 0);
    assert.ok(html.indexOf('£') === -1 && html.indexOf('&pound;') === -1);
    assert.ok(html.indexOf('Back to your projects') > 0);
    html = render.confirmation({ logoUrl: '', am: { name: 'Pat' }, payment: 'CARD', bank: {}, tranId: 'SO1', backUrl: 'u' });
    // PR #3 amendment 1: neutral card wording that names nobody.
    assert.ok(html.indexOf('We’ll call you to take payment.') > 0);
    assert.strictEqual(html.indexOf('Pat'), -1);
});
