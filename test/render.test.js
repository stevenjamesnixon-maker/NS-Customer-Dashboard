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
    return (html.match(/(?:src|href)="(https?:[^"]+)"/g) || []);
}

test('dashboard escapes values and loads nothing but the logo', function () {
    var html = render.dashboard({ customerName: 'A & B', logoUrl: LOGO, am: { name: 'Pat', phone: '01234 5' },
        groups: groups(), bank: { name: 'Bank', sort: '00', account: '1' }, payBacs: '1',
        deliveryUrl: function (id) { return 'https://acct.extforms.netsuite.com/x?t=a&a=delivery&so=' + id; } });
    assert.ok(html.indexOf('<script>') === -1);
    assert.ok(html.indexOf('A &amp; B') > 0);
    assert.ok(html.indexOf('Arrange delivery') > 0);
    assert.ok(html.indexOf('Projects in design') === -1, 'empty section hidden');
    assert.ok(html.indexOf('fonts.googleapis') === -1);
    externalUrls(html).forEach(function (u) {
        assert.ok(u.indexOf('src="' + LOGO) === 0 || u.indexOf('href="https://acct.extforms.netsuite.com') === 0, u);
    });
});

test('invalid page says only the generic text', function () {
    var html = render.invalidPage('');
    assert.ok(html.indexOf('This link is no longer valid. Please contact your account manager') > 0);
});

test('digest email: tables, inline styles, no display:none, the button and the footer', function () {
    var html = render.digestEmail({ customerName: 'Sam', logoUrl: LOGO, rows: render.digestRows(groups(), '1'),
        anyReady: true, link: 'https://acct.extforms.netsuite.com/x?t=a', am: { name: 'Pat', phone: '1', email: 'p@x.com' },
        digestDays: 14 });
    assert.ok(html.indexOf('display:none') === -1);
    assert.ok(html.indexOf('<style') === -1);
    assert.ok(html.indexOf('VIEW YOUR PROJECTS') > 0);
    assert.ok(html.indexOf('every 14 days') > 0);
    assert.ok(html.indexOf('reply to this email') > 0);
    assert.ok(html.indexOf('ready to deliver') > 0, 'banner');
    externalUrls(html).forEach(function (u) {
        assert.ok(u.indexOf('src="' + LOGO) === 0 || u.indexOf('href="https://acct.extforms.netsuite.com') === 0, u);
    });
});

test('BACS confirmation shows the reference and no amount', function () {
    var html = render.confirmation({ logoUrl: '', am: { name: 'Pat' }, payment: 'BACS',
        bank: { name: 'Bank', sort: '00-00-00', account: '12345678' }, tranId: 'SO1234', backUrl: 'u',
        dateKey: '2026-10-05', timeText: 'AM delivery' });
    assert.ok(html.indexOf('<span class="ref">SO1234</span>') > 0);
    assert.ok(html.indexOf('once payment reaches us') > 0);
    assert.ok(html.indexOf('£') === -1 && html.indexOf('&pound;') === -1);
    assert.ok(html.indexOf('Back to your projects') > 0);
    html = render.confirmation({ logoUrl: '', am: { name: 'Pat' }, payment: 'CARD', bank: {}, tranId: 'SO1', backUrl: 'u' });
    assert.ok(html.indexOf('Your account manager, Pat, will call you to take payment. We never ask for card details online') > 0);
});
