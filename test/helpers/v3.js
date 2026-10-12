'use strict';
/**
 * Release 2.3c: a world with the COMMITTED v3 registry, its content files, the 2.3c settings rows and opportunity 20 with
 * the 2.3c fields — for test/r2-5.test.js. Built on test/helpers/netsuite.js. Every ID here is a test fixture.
 */
var fs = require('fs');
var path = require('path');
var assert = require('node:assert');
var amd = require('./amd');
var ns = require('./netsuite');

var FOLDER = 'SuiteScripts/NuHeat/Customer Dashboard Content/';
var CONTENT = path.join(__dirname, '..', '..', 'content');

function read(name) {
    return fs.readFileSync(path.join(CONTENT, name), 'utf8');
}

var OPTIONS = {
    DI_BUILD_TYPE_OPTIONS: [{ id: '1', key: 'detached', label: 'Detached house' }, { id: '2', key: 'semi', label: 'Semi-detached' },
        { id: '3', key: 'end', label: 'End terrace' }, { id: '4', key: 'mid', label: 'Mid terrace' },
        { id: '5', key: 'bungalow', label: 'Bungalow' }, { id: '6', key: 'flat', label: 'Flat or apartment' }],
    DI_MARKET_OPTIONS: [{ id: '9', key: 'new', label: 'New build',
        sub: 'Including full conversions, such as a barn or commercial building made into a home' },
        { id: '8', key: 'reno', label: 'Renovation', sub: 'An existing home, including extensions' }],
    DI_PIC_REFLECT: [{ id: '21', key: 'r1', label: '1 surface', file: '501' }, { id: '22', key: 'r2', label: '2 surfaces', file: '502' },
        { id: '23', key: 'r3', label: '3 surfaces', file: '503' }],
    DI_PIC_BARRIER: [{ id: '31', key: 'b1', label: 'In full view', file: '511' }, { id: '32', key: 'b2', label: 'Partly hidden',
        file: '512' }, { id: '33', key: 'b3', label: 'Out of sight', file: '513' }]
};

var SETTINGS = {
    DESIGNINFO_REGISTRY: FOLDER + 'design-info-registry.csv',
    DESIGNINFO_FOLDER: '555',
    FC_MAP: '{"7": "solid|joisted", "8": "none", "6": "hp", "12": "solid", "13": "joisted"}',
    HEAT_MAP: '{"3": "nuheat_hp", "4": "boiler", "5": "user_hp"}',
    VP_MAP: '{"2": "hp", "1": "ufh", "5": "ufh_plus"}',
    NEWBUILD_MARKET_IDS: '9',
    UPD_BUILD_STAGES: '4,2',
    DI_HEAT26_MAP: '{"4": "ashp", "7": "gshp_loop", "8": "gshp_bore", "10": "boiler", "3": "user_hp"}',
    DI_BUILD_TYPE_OPTIONS: JSON.stringify(OPTIONS.DI_BUILD_TYPE_OPTIONS),
    DI_MARKET_OPTIONS: JSON.stringify(OPTIONS.DI_MARKET_OPTIONS),
    DI_PIC_REFLECT: JSON.stringify(OPTIONS.DI_PIC_REFLECT),
    DI_PIC_BARRIER: JSON.stringify(OPTIONS.DI_PIC_BARRIER),
    // House (17) may be replaced; any market value is kept once set.
    DI_FILL_REPLACEABLE: '{"custbodyopp_build_type": ["17"], "custbody_mis_opp_market": []}',
    EPC_BEARER_TOKEN: 'tok-SECRET-123'
};

/** A fake epc_lib (config.EPCLIB.PATH): its calls are recorded in lib.calls; results set per test. */
function fakeEpcLib(version, w) {
    var lib = {
        LIB_VERSION: version || '1.0.0',
        calls: [],
        searchResult: { ok: true, rows: [], message: 'No EPC certificates found for this postcode', statusCode: 404 },
        certResult: { ok: false, data: null, message: 'x', statusCode: 404 },
        search: function (postcode, token) {
            lib.calls.push(['search', postcode, token]);
            if (lib.w) { lib.w.units = (lib.w.units || 0) + 10; lib.w.unitLog = (lib.w.unitLog || []).concat(['https']); }
            if (lib.searchThrows) { throw new Error('boom'); }
            return lib.searchResult;
        },
        certificate: function (number, token) {
            lib.calls.push(['certificate', number, token]);
            if (lib.w) { lib.w.units = (lib.w.units || 0) + 10; lib.w.unitLog = (lib.w.unitLog || []).concat(['https']); }
            return lib.certResult;
        },
        validCertificateNumber: function (s) { return /^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/.test(String(s)); }
    };
    return lib;
}

/**
 * The world: customer 42's opportunity 20 — Won, Awaiting Design Info, FC 7 (solid + joisted), HP Design (PE 77), Heat
 * Source Type [4] (an ASHP), the Sales MI a Nu-Heat heat pump, renovation (market 8). opts.settings overrides SETTINGS
 * (null removes); opts.opp overrides fields; opts.epcLib (false: no library).
 */
function setup(opts) {
    var o = opts || {};
    var w = ns.world();
    var settings = {};
    var s;
    var t;
    Object.keys(SETTINGS).forEach(function (k) { settings[k] = SETTINGS[k]; });
    Object.keys(o.settings || {}).forEach(function (k) { settings[k] = o.settings[k]; });
    w.settings = Object.keys(settings).filter(function (k) { return settings[k] !== null; }).map(function (k, i) {
        return { id: String(300 + i), name: k, value: settings[k] };
    });
    w.files[FOLDER + 'design-info-registry.csv'] = o.registry === undefined ? read('design-info-registry.csv') : o.registry;
    ['element-presets.csv', 'age-bands.csv', 'epc-element-map.csv'].forEach(function (n) {
        if (!(o.missingContent || []).length || o.missingContent.indexOf(n) < 0) {
            w.files[FOLDER + n] = read(n);
        }
    });
    w.opps[20] = { entity: '42', title: 'Barn conversion', tranid: 'QR20', entitystatus: '13', custbody_opportunity_sub_status: '1',
        salesrep: '88', custbody_pe: '77', custbody_value_proposition: '2', custbody_value_proposition_text: 'HP Design',
        custbody_opp_site_adress: 'Plot 4\nVillage', custbody_mi_opp_fc: '7', custbody_mi_opp_fc_text: 'In floor, solid + joisted',
        custbody_mi_heat_source: '3', custbody_mi_heat_source_text: 'Nu-Heat heat pump', custbody_mis_opp_market: '8',
        custbody_mis_opp_market_text: 'Renovation', custbody_heat_source_type_26: ['4'],
        custbody_heat_source_type_26_text: 'Air source heat pump', custbody_opp_del_date: '2026-11-14',
        custbody_cdb_designinfo_state: '', custbodyopp_build_type: '', custbody15: '', custbody_pq_cylinder_location: '',
        custbody_existing_walls_2026: '', custbody_existing_windows_2026: '', custbody_existing_roofs_2026: '',
        custbody_existing_floors_2026: '', custbody_new_walls_2026: '', custbody_new_windows_2026: '',
        custbody_new_roofs_2026: '', custbody_new_floors_2026: '', custbody_epc_number: '', custbody_epc_date: '',
        custbody37: '', custbody36: '', custbody29: '' };
    Object.keys(o.opp || {}).forEach(function (k) { w.opps[20][k] = o.opp[k]; });
    w.oppFieldTypes = { custbody_build_stage: 'select', custbody28: 'checkbox', custbody_des_cont_phone: 'text',
        custbodyopp_build_type: 'select', custbody_mis_opp_market: 'select', custbody37: 'select', custbody36: 'select',
        custbody_epc_date: 'date', custbody_existing_walls_2026: 'textarea', custbody_new_walls_2026: 'textarea',
        custbody_existing_windows_2026: 'textarea', custbody_new_windows_2026: 'textarea',
        custbody_existing_roofs_2026: 'textarea', custbody_new_roofs_2026: 'textarea',
        custbody_existing_floors_2026: 'textarea', custbody_new_floors_2026: 'textarea',
        custbody_heat_source_type_26: 'multiselect', custbody_mi_heat_source: 'select', custbody_mi_opp_fc: 'select' };
    w.selectOptions = {
        custbody_heat_source_type_26: [{ value: '4', text: 'ASHP' }, { value: '7', text: 'GSHP loop' }, { value: '10', text: 'Boiler' }],
        custbody_mi_heat_source: [{ value: '', text: '' }, { value: '3', text: 'Nu-Heat heat pump' }, { value: '4', text: 'Boiler' }],
        custbody_mi_opp_fc: [{ value: '', text: '' }, { value: '7', text: 'Solid + joisted' }, { value: '12', text: 'Solid' }]
    };
    w.fileUrls = { 501: '/core/media/media.nl?id=501&c=1234567&h=a', 502: '/core/media/media.nl?id=502&c=1234567&h=b',
        503: '/core/media/media.nl?id=503&c=1234567&h=c', 511: '/core/media/media.nl?id=511&c=1234567&h=d',
        512: '/core/media/media.nl?id=512&c=1234567&h=e', 513: '/core/media/media.nl?id=513&c=1234567&h=f' };
    s = ns.stubs(w);
    s.modules = {};
    if (o.epcLib !== false) {
        s.modules['/SuiteScripts/NuHeat/Quick Quote Tool/epc_lib'] = o.epcLib || fakeEpcLib();
    }
    t = { w: w, s: s, epc: s.modules['/SuiteScripts/NuHeat/Quick Quote Tool/epc_lib'] };
    if (t.epc) {
        // The library's https.get, one call each, metered as N/https (10).
        t.epc.w = w;
    }
    t.sl = amd.load('cdb_sl_dashboard', s);
    t.tok = amd.load('lib/cdb_lib_token', s).sign(42, 0);
    return t;
}

function run(t, method, params, files) {
    var out = { html: '' };
    var before = t.w.redirects.length;
    t.redirect = '';
    t.sl.onRequest({
        request: { method: method, parameters: params, files: files || {} },
        response: { setHeader: function () {}, write: function (o) { out.html += o.output; } }
    });
    if (t.w.redirects.length > before) {
        t.redirect = t.w.redirects[t.w.redirects.length - 1].url;
        assert.strictEqual(out.html, '', 'a redirect writes no page');
    }
    return out.html;
}

function step(t, id) {
    return run(t, 'GET', { t: t.tok, a: 'designinfo', opp: '20', step: id });
}

/** A POST of a step (no redirect followed: t.redirect keeps the URL; the html is the page when there is one). */
function post(t, extra, files) {
    var p = { t: t.tok, a: 'designinfo', opp: '20' };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return run(t, 'POST', p, files);
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function state(w) {
    var di = amd.load('lib/cdb_lib_designinfo', {});
    return di.parseState(w.opps[20].custbody_cdb_designinfo_state).state;
}

function oppWrites(w) {
    return w.submits.filter(function (o) { return o.type === 'opportunity'; });
}

module.exports = { FOLDER: FOLDER, SETTINGS: SETTINGS, OPTIONS: OPTIONS, setup: setup, run: run, step: step, post: post,
    logs: logs, state: state, oppWrites: oppWrites, fakeEpcLib: fakeEpcLib, read: read };
