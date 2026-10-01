'use strict';
var test = require('node:test');
var assert = require('node:assert');
var config = require('./helpers/amd').load('lib/cdb_lib_config', { 'N/runtime': {} });

function slValues() {
    return {
        custscript_cdb_won_statuses: '13', custscript_cdb_lost_statuses: '14',
        custscript_cdb_design_substatus: '1,4,5,13', custscript_cdb_needinfo_substatus: '1',
        custscript_cdb_delivery_substatus: '8, 11', custscript_cdb_excluded_statuses: '90',
        custscript_cdb_excluded_quote_types: '7,8', custscript_cdb_pay_bacs: 1, custscript_cdb_pay_card: 2,
        custscript_cdb_fallback_employee: '500', custscript_cdb_logo_url: 'https://www.nu-heat.co.uk/logo.png',
        custscript_cdb_time_values: '2,5,3', custscript_cdb_vehicle_values: '1,2,3,4,5,6',
        custscript_cdb_unload_values: '1,2,3', custscript_cdb_pe_valueprops: '2,3', custscript_cdb_notice_days: '',
        custscript_cdb_bank_name: 'Bank', custscript_cdb_bank_sort: '00-00-00', custscript_cdb_bank_account: '12345678'
    };
}

test('Suitelet: complete parameters parse, defaults apply', function () {
    var v = slValues();
    var r = config.readParameters(function (id) { return v[id]; }, 'SL');
    assert.deepStrictEqual(r.missing, []);
    assert.deepStrictEqual(r.config.DELIVERY_SUBSTATUS, ['8', '11']);
    assert.deepStrictEqual(r.config.TIME_VALUES, ['2', '5', '3'], 'order kept');
    assert.strictEqual(r.config.NOTICE_DAYS, 3);
    assert.strictEqual(r.config.PAY_BACS, '1');
    assert.strictEqual(r.config.DIGEST_MODE, undefined, 'digest parameters are not the Suitelet\'s');
});

test('Suitelet: every missing parameter is named in one error', function () {
    var v = slValues();
    v.custscript_cdb_excluded_quote_types = '';
    v.custscript_cdb_bank_sort = null;
    v.custscript_cdb_won_statuses = '13,abc';
    var r = config.readParameters(function (id) { return v[id]; }, 'SL');
    assert.strictEqual(r.missing.length, 3);
    assert.ok(r.missing[0].indexOf('custscript_cdb_won_statuses (invalid') === 0);
    assert.ok(config.missingError(r.missing).message.indexOf('custscript_cdb_excluded_quote_types') > 0);
});

test('Suitelet: empty pe_valueprops and logo mean none, logged', function () {
    var v = slValues();
    v.custscript_cdb_pe_valueprops = '';
    v.custscript_cdb_logo_url = 'http://insecure.example/logo.png';
    var r = config.readParameters(function (id) { return v[id]; }, 'SL');
    assert.deepStrictEqual(r.missing, []);
    assert.deepStrictEqual(r.config.PE_VALUEPROPS, []);
    assert.strictEqual(r.config.LOGO_URL, '', 'http is not https');
    // 1.1: option hints and the EDD value are also empty in this fixture (5 notes); 1.2 adds the
    // prepay terms, the account pay value and the type labels (8); 1.3 adds the released statuses,
    // the recent days and the recent hidden statuses (11).
    assert.strictEqual(r.notes.length, 11);
});

function mrValues() {
    return {
        custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdbmr_logo_url: '',
        custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42',
        custscript_cdb_digest_days: '', custscript_cdb_digest_cap: '50'
    };
}

test('digest: TEST mode needs the test customers; LIVE does not', function () {
    var v = mrValues();
    var r = config.readParameters(function (id) { return v[id]; }, 'MR');
    assert.deepStrictEqual(r.missing, []);
    assert.deepStrictEqual(r.config.DIGEST_TEST_CUSTOMERS, ['42']);
    assert.strictEqual(r.config.DIGEST_DAYS, 14);
    assert.strictEqual(r.config.DIGEST_CAP, 50);

    v.custscript_cdb_digest_test_customers = '';
    r = config.readParameters(function (id) { return v[id]; }, 'MR');
    assert.strictEqual(r.missing.length, 1);
    assert.ok(r.missing[0].indexOf('custscript_cdb_digest_test_customers') === 0);

    v.custscript_cdb_digest_mode = 'live';
    r = config.readParameters(function (id) { return v[id]; }, 'MR');
    assert.deepStrictEqual(r.missing, []);
    assert.strictEqual(r.config.DIGEST_MODE, 'LIVE');
});

test('digest: a cleared mode or excluded quote types throws', function () {
    var v = mrValues();
    v.custscript_cdb_digest_mode = '';
    v.custscript_cdbmr_excluded_quote_types = '';
    var r = config.readParameters(function (id) { return v[id]; }, 'MR');
    assert.ok(r.missing.some(function (m) { return m.indexOf('custscript_cdb_digest_mode') === 0; }));
    assert.ok(r.missing.some(function (m) { return m.indexOf('custscript_cdbmr_excluded_quote_types') === 0; }));
});

test('no parameter ID is used by both scripts', function () {
    var seen = {};
    Object.keys(config.PARAMETERS).forEach(function (k) {
        var ids = config.PARAMETERS[k].ids;
        Object.keys(ids).forEach(function (col) {
            assert.ok(!seen[ids[col]], ids[col] + ' appears twice');
            seen[ids[col]] = true;
        });
    });
});
