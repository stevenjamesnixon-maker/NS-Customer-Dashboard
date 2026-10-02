'use strict';
/**
 * Release 3.0 (config 3.0): one settings record instead of twin parameters. Numbered as the brief's
 * table; the unnumbered tests pin the decisions recorded in docs/context.md.
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var SL = 'customscript_cdb_sl_dashboard';
var MR = 'customscript_cdb_mr_digest';
var SEND = 'customscript_cdb_sl_send_link';

/** A config module on the in-memory NetSuite. opts: scriptId, params, settings, settingsThrow. */
function setup(opts) {
    var o = opts || {};
    var w = ns.world();
    w.scriptId = o.scriptId || SL;
    if (o.params) { w.params = o.params; }
    w.settings = o.settings || [];
    w.settingsThrow = !!o.settingsThrow;
    var stubs = ns.stubs(w);
    var asked = [];
    var runtime = stubs['N/runtime'];
    stubs['N/runtime'] = { getCurrentScript: function () {
        var s = runtime.getCurrentScript();
        return { id: s.id, getParameter: function (p) { asked.push(p.name); return s.getParameter(p); } };
    } };
    return { w: w, asked: asked, config: amd.load('lib/cdb_lib_config', stubs), log: stubs['N/log'] };
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function settingSearches(w) {
    return (w.searches || []).filter(function (d) { return d.type === 'customrecord_cdb_setting'; });
}

var nextId = 1;
function row(name, value, inactive) {
    nextId += 1;
    return { id: String(nextId), name: name, value: value, isinactive: !!inactive };
}

/** Every parameter of a script, complete and valid, keyed by parameter ID. */
function fullParams(scriptId) {
    var base = {
        WON_STATUSES: '13', LOST_STATUSES: '14', DESIGN_SUBSTATUS: '1,4,5,13', NEEDINFO_SUBSTATUS: '1',
        DELIVERY_SUBSTATUS: '8, 11', EXCLUDED_STATUSES: '90', EXCLUDED_QUOTE_TYPES: '7,8', PAY_BACS: 1, PAY_CARD: '2',
        FALLBACK_EMPLOYEE: '500', PREPAY_TERMS: '4,5', PAY_ACCOUNT: '3', RELEASED_STATUSES: '2', RECENT_DAYS: '10',
        RECENT_HIDDEN_STATUSES: '6', QUOTE_TYPE_LABELS: ' {"1": "UFH", "2": "HP"} ',
        LOGO_URL: 'https://www.nu-heat.co.uk/logo.png', TIME_VALUES: '2,5,3', VEHICLE_VALUES: '1,2,3,4,5,6',
        UNLOAD_VALUES: '1,2,3', PE_VALUEPROPS: '2,3', NOTICE_DAYS: '4', BANK_NAME: 'Test Bank', BANK_SORT: '11-22-33',
        BANK_ACCOUNT: '87654321', OPTION_HINTS: '{"vehicle":{"1":"Up to 16 m long"}}', EDD_DEFINITE: '3',
        DIGEST_MODE: 'test', DIGEST_TEST_CUSTOMERS: '42, 43', DIGEST_DAYS: '21', DIGEST_CAP: '50'
    };
    var c = setup().config;
    var column = c.PARAMETER_COLUMNS[scriptId];
    var p = {};
    // 3.4.0: a key with no parameter in this column (record only, e.g. the digest's design keys) has none to fill.
    c.SCRIPT_KEYS[scriptId].forEach(function (k) {
        if (c.PARAMETERS[k].ids[column]) { p[c.PARAMETERS[k].ids[column]] = base[k]; }
    });
    return p;
}

/** The same values as fullParams, as settings rows, with every parameter blank. */
function asRecord(scriptId, params) {
    var c = setup().config;
    var column = c.PARAMETER_COLUMNS[scriptId];
    var settings = [];
    var blank = {};
    c.SCRIPT_KEYS[scriptId].forEach(function (k) {
        var id = c.PARAMETERS[k].ids[column];
        if (!id) { return; }
        settings.push(row(k, params[id] === undefined || params[id] === null ? '' : String(params[id])));
        blank[id] = '';
    });
    return { settings: settings, params: blank };
}

// ---------------------------------------------------------------- 1-6 the order a value is chosen in

test('1. a key on the record only: the record value, source record', function () {
    var p = fullParams(SL);
    p.custscript_cdb_logo_url = '';
    var s = setup({ params: p, settings: [row('LOGO_URL', 'https://record.example/logo.png')] });
    var cfg = s.config.load(s.log);
    assert.strictEqual(cfg.LOGO_URL, 'https://record.example/logo.png');
    assert.ok(/(^|, )LOGO_URL=record(,|$)/.test(logs(s.w, 'SETTINGS_SOURCE')[0][2]));
});

test('2. a key as a parameter only: the parameter value, source parameter', function () {
    var s = setup({ params: fullParams(SL), settings: [] });
    var cfg = s.config.load(s.log);
    assert.strictEqual(cfg.LOGO_URL, 'https://www.nu-heat.co.uk/logo.png');
    assert.ok(/(^|, )LOGO_URL=parameter(,|$)/.test(logs(s.w, 'SETTINGS_SOURCE')[0][2]));
});

test('3. on both with different values: the record wins', function () {
    var s = setup({ params: fullParams(SL), settings: [row('WON_STATUSES', '13,65,66'), row('RECENT_DAYS', '30')] });
    var cfg = s.config.load(s.log);
    assert.deepStrictEqual(cfg.WON_STATUSES, ['13', '65', '66']);
    assert.strictEqual(cfg.RECENT_DAYS, 30);
    assert.ok(s.asked.indexOf('custscript_cdb_won_statuses') < 0, 'the parameter is not even read');
});

test('4. a record row present but blank: falls back to the parameter', function () {
    var s = setup({ params: fullParams(SL), settings: [row('WON_STATUSES', '   '), row('LOGO_URL', '')] });
    var cfg = s.config.load(s.log);
    assert.deepStrictEqual(cfg.WON_STATUSES, ['13']);
    assert.strictEqual(cfg.LOGO_URL, 'https://www.nu-heat.co.uk/logo.png');
    assert.ok(/WON_STATUSES=parameter/.test(logs(s.w, 'SETTINGS_SOURCE')[0][2]));
});

test('5. an inactive record row is ignored (and is no duplicate)', function () {
    var s = setup({ params: fullParams(SL), settings: [row('WON_STATUSES', '99', true),
        row('LOGO_URL', 'https://old.example/logo.png', true), row('LOGO_URL', 'https://new.example/logo.png')] });
    var cfg = s.config.load(s.log);
    assert.deepStrictEqual(cfg.WON_STATUSES, ['13']);
    assert.strictEqual(cfg.LOGO_URL, 'https://new.example/logo.png');
    assert.deepStrictEqual(settingSearches(s.w)[0].filters, [['isinactive', 'is', 'F']], 'filtered in the search');
});

test('6. neither: a throw key throws as today; a default key gets the default as today', function () {
    var p = fullParams(SL);
    p.custscript_cdb_won_statuses = '';
    p.custscript_cdb_recent_days = '';
    var s = setup({ params: p });
    assert.throws(function () { s.config.load(s.log); }, function (e) {
        return e.name === 'CDB_PARAMETER_MISSING' && e.message.indexOf('custscript_cdb_won_statuses [setting WON_STATUSES]') > 0;
    });
    assert.ok(logs(s.w, 'PARAMETER_MISSING')[0][2].indexOf('custscript_cdb_won_statuses') === 0, 'starts as in 2.x');
    assert.ok(/WON_STATUSES=missing/.test(logs(s.w, 'SETTINGS_SOURCE')[0][2]));

    p = fullParams(SL);
    p.custscript_cdb_recent_days = '';
    s = setup({ params: p });
    assert.strictEqual(s.config.load(s.log).RECENT_DAYS, 7);
    assert.ok(/RECENT_DAYS=default/.test(logs(s.w, 'SETTINGS_SOURCE')[0][2]));
    // 3.1: plus the three record-only keys, empty here (no row, no parameter), noted as every 'none' key is.
    assert.deepStrictEqual(logs(s.w, 'PARAMETER_DEFAULT').map(function (l) { return l[2]; }),
        ['custscript_cdb_recent_days is empty: using the default 7', 'setting UPD_LOST_STATUS_MAP is empty: treated as none',
            'setting UPD_BUILD_STAGES is empty: treated as none', 'setting UPD_OBJECTION_TYPES is empty: treated as none',
            // 3.2.1: the two delivery-form record-only keys, the same way.
            'setting TIME_DEFAULT is empty: treated as none', 'setting UNLOAD_SURCHARGE is empty: treated as none',
            // 3.4.0 (release 2.3): the dashboard's design information keys, the same way.
            'setting DESIGNINFO_REGISTRY is empty: treated as none', 'setting DESIGNINFO_FOLDER is empty: treated as none',
            'setting DESIGNINFO_MAX_FILES is empty: using the default 6', 'setting FC_MAP is empty: treated as none',
            'setting HEAT_MAP is empty: treated as none', 'setting VP_MAP is empty: treated as none',
            'setting NEWBUILD_MARKET_IDS is empty: treated as none', 'setting NOTE_TYPE is empty: treated as none',
            'setting DESIGNINFO_DRAWINGS_URL is empty: treated as none'],
        'the 2.x note, word for word');
});

test('an invalid record value does not fall back: it is the setting, and the empty rule names it', function () {
    var s = setup({ params: fullParams(SL), settings: [row('RECENT_DAYS', 'ten'), row('WON_STATUSES', '13,abc')] });
    assert.throws(function () { s.config.load(s.log); }, /setting WON_STATUSES \(invalid value "13,abc"\)/);
    s = setup({ params: fullParams(SL), settings: [row('RECENT_DAYS', 'ten')] });
    assert.strictEqual(s.config.load(s.log).RECENT_DAYS, 7);
    assert.deepStrictEqual(logs(s.w, 'PARAMETER_DEFAULT')[0][2], 'setting RECENT_DAYS is invalid ("ten"): using the default 7');
});

// ---------------------------------------------------------------- 7-9 duplicates, unknown keys, no search

test('7. two active rows for one key: CDB_SETTING_DUPLICATE with both internal IDs', function () {
    var a = row('WON_STATUSES', '13');
    var b = row('WON_STATUSES', '13');
    var s = setup({ params: fullParams(SL), settings: [a, b] });
    assert.throws(function () { s.config.load(s.log); }, function (e) {
        return e.name === 'CDB_SETTING_DUPLICATE' &&
            e.message.indexOf('CDB_SETTING_DUPLICATE: WON_STATUSES (' + a.id + ', ' + b.id + ')') === 0;
    });
    assert.strictEqual(logs(s.w, 'SETTING_DUPLICATE')[0][0], 'error');
});

test('7b. a duplicate of a key this script does not need does not stop it', function () {
    var s = setup({ params: fullParams(SEND), scriptId: SEND,
        settings: [row('BANK_NAME', 'A'), row('BANK_NAME', 'B')] });
    assert.doesNotThrow(function () { s.config.load(s.log); });
    s = setup({ params: fullParams(SL), settings: [row('BANK_NAME', 'A'), row('BANK_NAME', 'B')] });
    assert.throws(function () { s.config.load(s.log); }, /CDB_SETTING_DUPLICATE: BANK_NAME/);
});

test('8. an unknown key row: one SETTING_UNKNOWN line; the load succeeds', function () {
    var s = setup({ params: fullParams(SL), settings: [row('WON_STATUS', '13'), row('LOGO_URL', 'https://r.example/l.png')] });
    var cfg = s.config.load(s.log);
    assert.strictEqual(cfg.LOGO_URL, 'https://r.example/l.png');
    assert.deepStrictEqual(cfg.WON_STATUSES, ['13']);
    var lines = logs(s.w, 'SETTING_UNKNOWN');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0][0], 'audit');
    assert.ok(lines[0][2].indexOf('"WON_STATUS"') > 0);
    s.config.load(s.log);
    assert.strictEqual(logs(s.w, 'SETTING_UNKNOWN').length, 1, 'once per execution');
});

test('9. the settings search throws: one SETTINGS_UNAVAILABLE line; the parameters are used', function () {
    var s = setup({ params: fullParams(SL), settingsThrow: true });
    var expected = setup({ params: fullParams(SL) }).config.readParameters(function (id) {
        return fullParams(SL)[id];
    }, 'SL').config;
    // 3.1: the record-only keys have no parameter, so with no search they take their empty rule.
    expected.UPD_LOST_STATUS_MAP = '';
    expected.UPD_BUILD_STAGES = [];
    expected.UPD_OBJECTION_TYPES = [];
    expected.TIME_DEFAULT = '';
    expected.UNLOAD_SURCHARGE = '';
    // 3.4.0: the dashboard's design information keys.
    expected.DESIGNINFO_REGISTRY = '';
    expected.DESIGNINFO_FOLDER = '';
    expected.DESIGNINFO_MAX_FILES = 6;
    expected.FC_MAP = '';
    expected.HEAT_MAP = '';
    expected.VP_MAP = '';
    expected.NEWBUILD_MARKET_IDS = [];
    expected.NOTE_TYPE = '';
    expected.DESIGNINFO_DRAWINGS_URL = '';
    assert.deepStrictEqual(s.config.load(s.log), expected);
    s.config.load(s.log);
    var lines = logs(s.w, 'SETTINGS_UNAVAILABLE');
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0][2].indexOf('SSS_INVALID_SRCH_TYPE') > 0);
    assert.ok(/WON_STATUSES=parameter/.test(logs(s.w, 'SETTINGS_SOURCE')[0][2]));
});

test('9b. no N/search at all (the 2.x test harness): still the parameters', function () {
    var c = amd.load('lib/cdb_lib_config', { 'N/runtime': { getCurrentScript: function () {
        return { id: SEND, getParameter: function (o) { return fullParams(SEND)[o.name]; } };
    } } });
    assert.strictEqual(c.load({ audit: function () {}, error: function () {} }).FALLBACK_EMPLOYEE, '500');
});

// ---------------------------------------------------------------- 10 the same value, either source

test('10. the same values from the record or the parameters give identical config, every kind, every script', function () {
    [SL, MR, SEND].forEach(function (scriptId) {
        var p = fullParams(scriptId);
        var fromParams = setup({ scriptId: scriptId, params: p });
        var moved = asRecord(scriptId, p);
        var fromRecord = setup({ scriptId: scriptId, params: moved.params, settings: moved.settings });
        var a = fromParams.config.load(fromParams.log);
        var b = fromRecord.config.load(fromRecord.log);
        assert.deepStrictEqual(b, a, scriptId);
        assert.ok(!/=parameter/.test(logs(fromRecord.w, 'SETTINGS_SOURCE')[0][2]), scriptId + ' all from the record');
    });
    // Kinds covered: idlist, id (an Integer parameter returns a number), int, https, text, mode. 3.3.0: scope
    // is record only (LINK_BACKFILL_SCOPE has no parameter), so it has no parameter twin to compare.
    var kinds = {};
    var c = setup().config;
    Object.keys(c.PARAMETERS).forEach(function (k) { kinds[c.PARAMETERS[k].kind] = true; });
    assert.deepStrictEqual(Object.keys(kinds).sort(), ['https', 'id', 'idlist', 'int', 'mode', 'scope', 'text']);
});

test('10b. invalid values give the same result from either source (the empty rule)', function () {
    var p = fullParams(SL);
    p.custscript_cdb_recent_days = '-1';
    p.custscript_cdb_logo_url = 'http://insecure.example/l.png';
    p.custscript_cdb_pe_valueprops = 'two';
    var fromParams = setup({ params: p });
    var moved = asRecord(SL, p);
    var fromRecord = setup({ params: moved.params, settings: moved.settings });
    assert.deepStrictEqual(fromRecord.config.load(fromRecord.log), fromParams.config.load(fromParams.log));
});

// ---------------------------------------------------------------- 11-12 one search, the source line

test('11. one execution, load() three times: one search, one SETTINGS_SOURCE', function () {
    var s = setup({ params: fullParams(MR), scriptId: MR, settings: [row('DIGEST_CAP', '75')] });
    s.config.load(s.log);
    s.config.load(s.log, true);
    var cfg = s.config.load(s.log);
    assert.strictEqual(cfg.DIGEST_CAP, 75);
    assert.strictEqual(settingSearches(s.w).length, 1);
    assert.deepStrictEqual(settingSearches(s.w)[0].columns, ['name', 'custrecord_cdb_setting_value']);
    assert.strictEqual(logs(s.w, 'SETTINGS_SOURCE').length, 1);
});

test('11b. a failed search is not retried', function () {
    var s = setup({ params: fullParams(SL), settingsThrow: true });
    s.config.load(s.log);
    s.config.load(s.log);
    assert.strictEqual(logs(s.w, 'SETTINGS_UNAVAILABLE').length, 1);
    assert.strictEqual(settingSearches(s.w).length, 1);
});

test('12. SETTINGS_SOURCE lists every key the script reads with its source; never when quiet', function () {
    var p = fullParams(MR);
    p.custscript_cdbmr_logo_url = '';
    p.custscript_cdb_digest_days = '';
    p.custscript_cdb_digest_mode = 'LIVE';
    var s = setup({ scriptId: MR, params: p, settings: [row('WON_STATUSES', '13'), row('PAY_CARD', '2')] });
    s.config.load(s.log);
    var lines = logs(s.w, 'SETTINGS_SOURCE');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0][0], 'audit');
    var got = {};
    lines[0][2].split(', ').forEach(function (pair) { var kv = pair.split('='); got[kv[0]] = kv[1]; });
    assert.deepStrictEqual(Object.keys(got).sort(), s.config.SCRIPT_KEYS[MR].slice().sort(), 'every key, once');
    assert.strictEqual(got.WON_STATUSES, 'record');
    assert.strictEqual(got.PAY_CARD, 'record');
    assert.strictEqual(got.LOST_STATUSES, 'parameter');
    assert.strictEqual(got.LOGO_URL, 'none');
    assert.strictEqual(got.DIGEST_DAYS, 'default');
    assert.strictEqual(got.DIGEST_TEST_CUSTOMERS, 'unused', 'LIVE: not read');
    assert.ok(lines[0][2].indexOf('WON_STATUSES=record, LOST_STATUSES=parameter') === 0, 'PARAMETERS order');

    var q = setup({ scriptId: MR, params: fullParams(MR), settings: [row('NOPE', '1')], settingsThrow: false });
    q.config.load(q.log, true);
    assert.strictEqual(q.w.logs.length, 0, 'quiet: no source, unknown or default line');
    q = setup({ scriptId: MR, params: fullParams(MR), settingsThrow: true });
    q.config.load(q.log, true);
    assert.strictEqual(q.w.logs.length, 0, 'quiet: no unavailable line');
});

// ---------------------------------------------------------------- 13 the seed file

/** A small RFC 4180 reader: enough for the seed file. */
function readCsv(text) {
    var rows = [];
    var rowCells = [];
    var cell = '';
    var quoted = false;
    var i;
    var ch;
    for (i = 0; i < text.length; i++) {
        ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') { quoted = false; } else { cell += ch; }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ',') {
            rowCells.push(cell); cell = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') { i++; }
            rowCells.push(cell); rows.push(rowCells); rowCells = []; cell = '';
        } else {
            cell += ch;
        }
    }
    if (cell !== '' || rowCells.length) { rowCells.push(cell); rows.push(rowCells); }
    return rows;
}

test('13. the seed CSV has every PARAMETERS key exactly once, no values, a note each', function () {
    var rows = readCsv(fs.readFileSync(path.join(__dirname, '..', 'docs', 'settings-seed.csv'), 'utf8'));
    var c = setup().config;
    assert.deepStrictEqual(rows[0], ['Name', 'Value', 'Notes']);
    var names = rows.slice(1).map(function (r) {
        assert.strictEqual(r.length, 3, r.join('|'));
        assert.strictEqual(r[1], '', r[0] + ' has no value');
        assert.ok(r[2].length > 10, r[0] + ' has a note');
        return r[0];
    });
    assert.deepStrictEqual(names.slice().sort(), Object.keys(c.PARAMETERS).sort());
    assert.strictEqual(names.length, Object.keys(c.PARAMETERS).length, 'no key twice');
});

// ---------------------------------------------------------------- 14 a script with no parameters

test('14. a script with no parameter column and every key on the record loads; no CDB_UNKNOWN_SCRIPT', function () {
    var s = setup({ scriptId: 'customscript_cdb_future', settings: [row('WON_STATUSES', '13,65'),
        row('LOGO_URL', 'https://r.example/l.png')] });
    s.config.SCRIPT_KEYS.customscript_cdb_future = ['WON_STATUSES', 'LOGO_URL', 'RECENT_DAYS'];
    var cfg = s.config.load(s.log);
    assert.deepStrictEqual(cfg, { WON_STATUSES: ['13', '65'], RECENT_DAYS: 7, LOGO_URL: 'https://r.example/l.png' });
    assert.deepStrictEqual(s.asked, [], 'no parameter read');
    assert.strictEqual(logs(s.w, 'SETTINGS_SOURCE')[0][2], 'WON_STATUSES=record, RECENT_DAYS=default, LOGO_URL=record');
    assert.strictEqual(logs(s.w, 'PARAMETER_DEFAULT')[0][2], 'setting RECENT_DAYS is empty: using the default 7');
});

test('14b. such a script with a required key off the record names the setting', function () {
    var s = setup({ scriptId: 'customscript_cdb_future', settings: [] });
    s.config.SCRIPT_KEYS.customscript_cdb_future = ['WON_STATUSES'];
    assert.throws(function () { s.config.load(s.log); }, function (e) {
        return e.name === 'CDB_PARAMETER_MISSING' && /: setting WON_STATUSES$/.test(e.message);
    });
});

test('14c. a script in neither table still throws CDB_UNKNOWN_SCRIPT', function () {
    var s = setup({ scriptId: 'customscript_someone_else' });
    assert.throws(function () { s.config.load(s.log); }, /^Error: CDB_UNKNOWN_SCRIPT/);
});

// ---------------------------------------------------------------- the tables

test('SCRIPT_KEYS lists exactly the keys of each script\'s parameter column, plus its record-only keys', function () {
    var c = setup().config;
    // 3.1: the record-only keys (no parameter on any script) — the dashboard Suitelet's update settings.
    var recordOnly = Object.keys(c.PARAMETERS).filter(function (k) { return !Object.keys(c.PARAMETERS[k].ids).length; });
    assert.deepStrictEqual(recordOnly, ['UPD_LOST_STATUS_MAP', 'UPD_BUILD_STAGES', 'UPD_OBJECTION_TYPES',
        'TIME_DEFAULT', 'UNLOAD_SURCHARGE', 'LINK_BACKFILL_SCOPE',
        // 3.4.0 (release 2.3)
        'DESIGNINFO_REGISTRY', 'DESIGNINFO_FOLDER', 'DESIGNINFO_MAX_FILES', 'FC_MAP', 'HEAT_MAP', 'VP_MAP',
        'NEWBUILD_MARKET_IDS', 'NOTE_TYPE', 'DESIGN_EMAIL_ADDRESS', 'DESIGNINFO_EMAIL', 'DESIGNINFO_DRAWINGS_URL']);
    // 3.3.0: LINK_BACKFILL_SCOPE is the link backfill's, not the dashboard's. 3.4.0: the request email's two keys are the
    // Send design information Suitelet's.
    var slRecordOnly = recordOnly.filter(function (k) {
        return ['LINK_BACKFILL_SCOPE', 'DESIGN_EMAIL_ADDRESS', 'DESIGNINFO_EMAIL'].indexOf(k) < 0;
    });
    // 3.4.0 (amendment 1 §3): the digest reads the design keys from the record, and PE_VALUEPROPS (no MR twin).
    var mrRecordOnly = ['DESIGNINFO_REGISTRY', 'FC_MAP', 'HEAT_MAP', 'VP_MAP', 'NEWBUILD_MARKET_IDS', 'PE_VALUEPROPS'];
    Object.keys(c.PARAMETER_COLUMNS).forEach(function (scriptId) {
        assert.deepStrictEqual(c.SCRIPT_KEYS[scriptId].slice().sort(),
            c.keysForColumn(c.PARAMETER_COLUMNS[scriptId]).concat(scriptId === SL ? slRecordOnly : scriptId === MR ?
                mrRecordOnly : []).sort(), scriptId);
    });
    // 3.4.0: the two new scripts have no parameters: every key they read, from the record.
    assert.strictEqual(c.PARAMETER_COLUMNS[c.SCRIPTS.OPP_UE], undefined);
    assert.strictEqual(c.PARAMETER_COLUMNS[c.SCRIPTS.SEND_DESIGNINFO], undefined);
    assert.deepStrictEqual(c.SCRIPT_KEYS[c.SCRIPTS.OPP_UE], ['WON_STATUSES', 'NEEDINFO_SUBSTATUS', 'FC_MAP']);
    // 3.4.1 (amendment 2): DESIGN_SUBSTATUS, which the facts read.
    assert.deepStrictEqual(c.SCRIPT_KEYS[c.SCRIPTS.SEND_DESIGNINFO], ['WON_STATUSES', 'NEEDINFO_SUBSTATUS', 'DESIGN_SUBSTATUS', 'PE_VALUEPROPS',
        'FALLBACK_EMPLOYEE', 'LOGO_URL', 'DESIGNINFO_REGISTRY', 'FC_MAP', 'HEAT_MAP', 'VP_MAP', 'NEWBUILD_MARKET_IDS',
        'DESIGN_EMAIL_ADDRESS', 'DESIGNINFO_EMAIL']);
    // 3.3.0: the link backfill has no parameters: the "open" keys and its scope, from the record only.
    assert.strictEqual(c.PARAMETER_COLUMNS[c.SCRIPTS.LINK_BACKFILL], undefined);
    assert.deepStrictEqual(c.SCRIPT_KEYS[c.SCRIPTS.LINK_BACKFILL], ['WON_STATUSES', 'LOST_STATUSES', 'DESIGN_SUBSTATUS',
        'DELIVERY_SUBSTATUS', 'EXCLUDED_STATUSES', 'EXCLUDED_QUOTE_TYPES', 'RELEASED_STATUSES', 'LINK_BACKFILL_SCOPE']);
    assert.deepStrictEqual(Object.keys(c.SCRIPT_KEYS).sort(), [MR, SL, SEND, c.SCRIPTS.LINK_BACKFILL, c.SCRIPTS.OPP_UE,
        c.SCRIPTS.SEND_DESIGNINFO].sort());
    assert.strictEqual(Object.keys(c.PARAMETERS).length, 48,
        'the 2.0.5 keys, the three 3.1 keys, the two 3.2.1 keys, the 3.3.0 key and the eleven 3.4.0 keys, no more');
    assert.strictEqual(c.VERSION, '3.4.1');
});
