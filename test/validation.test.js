'use strict';
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');

var data = amd.load('lib/cdb_lib_data', { 'N/search': {}, 'N/record': {}, 'N/format': {}, 'N/runtime': {} });
var dates = amd.load('lib/cdb_lib_dates');

var CTX = {
    todayKey: '2026-09-29', noticeDays: 3, holidays: dates.toSet(['2026-10-12']), horizonMonths: 6,
    timeIds: ['2', '5', '3'], vehicleIds: ['1', '2'], unloadIds: ['1', '2', '3'], addressIds: ['900', '901'],
    payBacs: '1', payCard: '2'
};

function input(extra) {
    var i = { date: '2026-10-05', time: '5', address: '901', vehicle: '2', unload: '3', contactName: 'Sam Site',
        contactPhone: '01234 567890', contactEmail: 'sam@example.com', requests: 'Ring first', payment: 'BACS' };
    Object.keys(extra || {}).forEach(function (k) { i[k] = extra[k]; });
    return i;
}

test('a valid request passes and maps the payment choice', function () {
    var r = data.validateDelivery(input(), CTX);
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.strictEqual(r.values.payIntent, '1');
    assert.strictEqual(data.validateDelivery(input({ payment: 'card' }), CTX).values.payIntent, '2');
});

test('dates before the first allowed date, weekends and holidays are rejected', function () {
    ['2026-10-02', '2026-10-10', '2026-10-12', '2027-04-01', 'garbage'].forEach(function (d) {
        var r = data.validateDelivery(input({ date: d }), CTX);
        assert.strictEqual(r.ok, false, d);
        assert.ok(r.errors.date, d);
        assert.strictEqual(r.values.contactName, 'Sam Site', 'input kept for re-render');
    });
});

test('list IDs outside their allowed list are rejected', function () {
    var r = data.validateDelivery(input({ time: '4', vehicle: '9', unload: '', address: '555', payment: 'CASH' }), CTX);
    assert.deepStrictEqual(Object.keys(r.errors).sort(), ['address', 'payment', 'time', 'unload', 'vehicle']);
});

test('contact and text lengths', function () {
    assert.ok(data.validateDelivery(input({ contactEmail: 'not an email' }), CTX).errors.contactEmail);
    assert.strictEqual(data.validateDelivery(input({ contactEmail: '' }), CTX).ok, true, 'email optional');
    assert.ok(data.validateDelivery(input({ contactName: '' }), CTX).errors.contactName);
    assert.ok(data.validateDelivery(input({ contactPhone: 'call me' }), CTX).errors.contactPhone);
    assert.ok(data.validateDelivery(input({ requests: new Array(1002).join('x') }), CTX).errors.requests);
    assert.strictEqual(data.validateDelivery(input({ requests: new Array(1001).join('x') }), CTX).ok, true);
});
