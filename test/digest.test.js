'use strict';
/** The digest in TEST mode against the in-memory NetSuite. Mirrors Sandbox scenarios 9 and 10. */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

function params(extra) {
    var p = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdbmr_logo_url: 'https://www.nu-heat.co.uk/logo.png',
        custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42,43' };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return p;
}

function setup(extra) {
    var w = ns.world();
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = params(extra);
    return { w: w, mr: amd.load('cdb_mr_digest', ns.stubs(w)) };
}

function runMap(mr, value) {
    var written = [];
    mr.map({ value: JSON.stringify(value), write: function (o) { written.push(o); } });
    return written;
}

test('TEST mode: exactly the listed customers', function () {
    var s = setup();
    assert.deepStrictEqual(s.mr.getInputData(), [{ customerId: '42' }, { customerId: '43' }]);
});

test('one email from the sales rep, on the customer, with the link; last digest stamped', function () {
    var s = setup();
    var written = runMap(s.mr, { customerId: '42' });
    assert.deepStrictEqual(written, [{ key: 'sent', value: '42' }]);
    assert.strictEqual(s.w.emails.length, 1);
    assert.strictEqual(s.w.emails[0].author, 88);
    assert.deepStrictEqual(s.w.emails[0].recipients, ['acme@example.com']);
    assert.deepStrictEqual(s.w.emails[0].relatedRecords, { entityId: 42 });
    assert.ok(s.w.emails[0].body.indexOf('https://acct.extforms.netsuite.com/sl?t=') > 0);
    assert.strictEqual(s.w.submits.length, 1);
    assert.ok(s.w.submits[0].values.custentity_cdb_last_digest instanceof Date);
    assert.deepStrictEqual(Object.keys(s.w.submits[0].values), ['custentity_cdb_last_digest'], 'the only customer field');
});

test('the dashboard contact wins over the customer email', function () {
    var s = setup();
    s.w.customers[42].custentity_cdb_dashboard_contact = [{ value: '700', text: 'Site Manager' }];
    s.w.contacts[700] = { email: 'manager@example.com' };
    runMap(s.mr, { customerId: '42' });
    assert.deepStrictEqual(s.w.emails[0].recipients, ['manager@example.com']);
});

test('skips: no recipient, nothing to show', function () {
    var s = setup();
    assert.deepStrictEqual(runMap(s.mr, { customerId: '43' }), [{ key: 'skipped: no recipient email', value: '43' }]);
    s.w.customers[43].email = 'other@example.com';
    s.w.opps[9].entitystatus = '14';
    assert.deepStrictEqual(runMap(s.mr, { customerId: '43' }), [{ key: 'skipped: nothing to show', value: '43' }]);
    assert.strictEqual(s.w.emails.length, 0);
});

test('a cleared mode, or test customers in TEST, throws and names it', function () {
    assert.throws(function () { setup({ custscript_cdb_digest_mode: '' }).mr.getInputData(); },
        /custscript_cdb_digest_mode/);
    assert.throws(function () { setup({ custscript_cdb_digest_test_customers: '' }).mr.getInputData(); },
        /custscript_cdb_digest_test_customers/);
    assert.throws(function () { setup({ custscript_cdbmr_excluded_quote_types: '' }).mr.getInputData(); },
        /custscript_cdbmr_excluded_quote_types/);
});
