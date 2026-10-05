'use strict';
/**
 * Release 2.3, "Tell us about your property": the dashboard's a=designinfo flow, the card states on the dashboard
 * and in the digest, the opportunity's "Request design information" button and the Send design information
 * Suitelet, against the in-memory NetSuite (test/helpers/netsuite.js). Grouped as the brief's §9 "Flow" list.
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var REGISTRY_PATH = 'SuiteScripts/NuHeat/Customer Dashboard Content/design-info-registry.csv';
var REGISTRY = fs.readFileSync(path.join(__dirname, '..', 'content', 'design-info-registry.csv'), 'utf8');
var HEADER = 'section,section_title,panel,qid,type,label,hint,options,field,required,when,why';

var SETTINGS = {
    DESIGNINFO_REGISTRY: REGISTRY_PATH,
    DESIGNINFO_FOLDER: '555',
    FC_MAP: '{"7": "solid|joisted", "8": "none", "6": "hp"}',
    HEAT_MAP: '{"3": "nuheat_hp", "4": "boiler"}',
    VP_MAP: '{"2": "hp", "1": "ufh", "5": "ufh_plus"}',
    NEWBUILD_MARKET_IDS: '9',
    UPD_BUILD_STAGES: '4,2'
};

/**
 * The world: customer 42's opportunity 20, Won (13), Awaiting Design Info (1), FC 7 (solid + joisted), a Nu-Heat heat
 * pump (3), HP Design (VP 2, a PE case: PE 77), existing house (market 8). opts.settings overrides SETTINGS (null
 * removes a key); opts.registry replaces the registry text.
 */
function setup(opts) {
    var o = opts || {};
    var w = ns.world();
    var settings = {};
    var s;
    Object.keys(SETTINGS).forEach(function (k) { settings[k] = SETTINGS[k]; });
    Object.keys(o.settings || {}).forEach(function (k) { settings[k] = o.settings[k]; });
    w.settings = Object.keys(settings).filter(function (k) { return settings[k] !== null; }).map(function (k, i) {
        return { id: String(300 + i), name: k, value: settings[k] };
    });
    w.files[REGISTRY_PATH] = o.registry === undefined ? REGISTRY : o.registry;
    w.opps[20] = { entity: '42', title: 'Barn conversion', tranid: 'QR20', entitystatus: '13', custbody_opportunity_sub_status: '1',
        salesrep: '88', custbody_pe: '77', custbody_value_proposition: '2', custbody_value_proposition_text: 'HP Design',
        custbody_opp_site_adress: 'Plot 4\nVillage', custbody_mi_opp_fc: '7', custbody_mi_opp_fc_text: 'In floor, solid + joisted',
        custbody_mi_heat_source: '3', custbody_mi_heat_source_text: 'Nu-Heat heat pump', custbody_mis_opp_market: '8',
        custbody_build_stage: '2', custbody_build_stage_text: '2 - Foundations', custbody_opp_del_date: '2026-11-14',
        custbody_sections_ceiling_heights_2026: 'All 2.4 m', custbody16: '3', custbody16_text: 'Neo thermostats',
        custbody_on_hub_tick: true, custbody_cdb_designinfo_state: '' };
    w.oppFieldTypes = { custbody_build_stage: 'select', custbody28: 'checkbox', custbody_des_cont_phone: 'text',
        custbody_sections_ceiling_heights_2026: 'textarea' };
    w.selectOptions = { custbody_build_stage: [{ value: '', text: '' }, { value: '2', text: '2 - Foundations' },
        { value: '4', text: '4 - Roof on' }, { value: '6', text: '6 - First fix' }] };
    s = ns.stubs(w);
    return { w: w, s: s, sl: amd.load('cdb_sl_dashboard', s), tok: amd.load('lib/cdb_lib_token', s).sign(42, 0) };
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

/** 2.4.0: the query parameters of a URL. */
function query(u) {
    var p = {};
    String(u).split('?')[1].split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return p;
}

/** 2.4.0: a GET of the URL the last POST redirected to, as the browser does after the 302. */
function follow(t) {
    var u = t.redirect;
    assert.ok(u, 'the POST redirected');
    return run(t, 'GET', query(u));
}

function get(t, opp) {
    return run(t, 'GET', { t: t.tok, a: 'designinfo', opp: opp || '20' });
}

/** 2.4.0: a POST; a save redirects, so the page returned is the GET it redirects to (t.redirect keeps the URL). */
function post(t, extra, files) {
    var p = { t: t.tok, a: 'designinfo', opp: '20' };
    var html;
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    html = run(t, 'POST', p, files);
    return t.redirect ? (function (u) { var h = follow(t); t.redirect = u; return h; })(t.redirect) : html;
}

/** An uploaded part, as request.files gives one: saving it records it in w.savedFiles. */
function part(t, name, size) {
    var f = { name: name, size: size === undefined ? 1000 : size };
    f.save = function () {
        if (t.w.fileSaveThrows) { throw new Error('INSUFFICIENT_PERMISSION: folder'); }
        t.w.savedFiles.push({ name: f.name, folder: f.folder, isOnline: f.isOnline });
        return 900 + t.w.savedFiles.length;
    };
    return f;
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function oppWrites(w) {
    return w.submits.filter(function (o) { return o.type === 'opportunity'; });
}

/** The stored state, as the code reads it (amendment 3: stored as version 2, read through parseState). */
function state(w) {
    var di = amd.load('lib/cdb_lib_designinfo', {});
    var raw = w.opps[20].custbody_cdb_designinfo_state;
    assert.ok(raw.length <= 3900, 'the state fits the Text Area: ' + raw.length);
    assert.strictEqual(JSON.parse(raw).v, 2, 'stored as version 2');
    return di.parseState(raw).state;
}

function nothingWritten(t, why) {
    assert.strictEqual(t.w.submits.length, 0, why + ': no submitFields');
    assert.strictEqual(t.w.notes.length, 0, why + ': no Note');
    assert.strictEqual(t.w.tasks.length, 0, why + ': no Task');
    assert.strictEqual(t.w.savedFiles.length, 0, why + ': no file');
}

// ---------------------------------------------------------------- the page

/** 2.4.0: GET one step of the stepper. */
function getStep(t, step) {
    return run(t, 'GET', { t: t.tok, a: 'designinfo', opp: '20', step: step });
}

test('GET (2.4.0): a step per screen — the step bar, the intro card, one multipart form, Back and Save and continue', function () {
    var t = setup();
    var html = get(t);
    assert.ok(html.indexOf('<title>Your plans \u00b7 Tell us about your property | Nu-Heat</title>') > 0, 'the step in the title');
    assert.ok(html.indexOf('Design questions? Call Pem Engineer on <a href="tel:0101">0101</a>') > 0, 'the PE, a PE case');
    assert.ok(html.indexOf('<form id="diform" class="fcol" method="post" enctype="multipart/form-data"') > 0);
    assert.strictEqual((html.match(/<form /g) || []).length, 1, 'one form');
    assert.ok(html.indexOf('<input type="hidden" name="a" value="designinfo">') > 0);
    assert.ok(html.indexOf('<input type="hidden" name="opp" value="20">') > 0);
    // No step: the first step still to do (Your project has nothing required).
    assert.ok(html.indexOf('<input type="hidden" name="step" value="plans">') > 0);
    // The step bar: HP Design, solid + joisted, Nu-Heat heat pump, existing house; then Review.
    assert.deepStrictEqual((html.match(/name="goto" value="[a-z]+"/g) || []).map(function (x) { return x.split('"')[3]; }),
        ['project', 'plans', 'insulation', 'heating', 'heatpump', 'other', 'review']);
    assert.ok(html.indexOf('aria-label="Step 2 of 7: Your plans" aria-current="step"') > 0);
    assert.ok(html.indexOf('<p class="eyebrow">Step 2 of 7 · about 2 minutes</p><h1 id="h-step">Your plans</h1>') > 0);
    assert.ok(html.indexOf('We designed your quote from the plans you sent us.') > 0, 'the step intro');
    // Only this step's questions.
    assert.ok(html.indexOf('name="q_plans_current"') > 0);
    assert.strictEqual(html.indexOf('name="q_walls_ex"'), -1, 'another step');
    assert.strictEqual(html.indexOf('name="q_build_stage"'), -1, 'another step');
    // Per type.
    assert.ok(html.indexOf('<details class="why"><summary>? Why</summary><p>Plans change between quote and build.') > 0);
    assert.ok(/<input class="sr" type="radio" name="q_plans_current" value="yes"/.test(html), 'yesno');
    assert.ok(html.indexOf('<textarea class="inp" id="di-ceilings" name="q_ceilings" maxlength="4000" placeholder="e.g. sections ' +
        'on the plans.') > 0, 'pre-filled from the opportunity, with its placeholder');
    assert.ok(html.indexOf('>All 2.4 m</textarea>') > 0);
    assert.ok(html.indexOf('accept=".pdf,.dwg,.dxf,.jpg,.jpeg,.png,.gif,.zip,.doc,.docx,.xls,.xlsx,.tif,.tiff,image/*"') > 0);
    // The navigation row and the reassurance line.
    assert.ok(html.indexOf('<button type="submit" class="out" name="nav" value="back">← Back: Your project</button>') > 0);
    assert.ok(html.indexOf('<button type="submit" class="cta" name="nav" value="next">Save and continue →</button>') > 0);
    assert.ok(html.indexOf('form="diform" name="nav" value="exit">Save and exit</button>') > 0, 'in the header');
    assert.ok(html.indexOf('Stuck on anything? It’s fine to skip it. Pem will go through it on your design call. Call 0101 ' +
        'if you’d rather talk now.') > 0);
    // The right column is gone.
    assert.strictEqual(html.indexOf('What each design service needs'), -1);
    assert.strictEqual(html.indexOf('<aside'), -1);
    assert.strictEqual(html.indexOf('Understanding your drawings'), -1);
    // The size warning script, and no third-party script.
    assert.ok(html.indexOf('10485760') > 0);
    assert.strictEqual((html.match(/<script src/g) || []).length, 0);
    // One dynamic load, never saved; nothing written.
    assert.deepStrictEqual(t.w.oppLoadModes, [true]);
    assert.strictEqual(t.w.fileLoads, 1, 'the registry, once');
    nothingWritten(t, 'a GET');
});

test('GET (2.4.0): step 1 — the project facts card; no Back, "Your projects" instead', function () {
    var t = setup();
    var html = getStep(t, 'project');
    assert.ok(html.indexOf('<p class="eyebrow">Step 1 of 7 · about 1 minute</p>') > 0);
    assert.ok(html.indexOf('<h2 id="h-facts">Your project, as we have it</h2>') > 0);
    assert.ok(html.indexOf('<dt>You’re having</dt><dd>In floor, solid + joisted · Nu-Heat heat pump</dd>') > 0);
    assert.ok(html.indexOf('<dt>Thermostats</dt><dd>Neo thermostats with a Neo hub</dd>') > 0);
    assert.ok(html.indexOf('<dt>Design service</dt><dd>HP Design</dd>') > 0);
    assert.ok(html.indexOf('<dt>Site address</dt><dd>Plot 4, Village</dd>') > 0);
    assert.ok(html.indexOf('name="q_design_contact" value="" maxlength="300"') > 0);
    assert.ok(html.indexOf('<input class="inp" type="date" id="di-goods_date" name="q_goods_date" value=""') > 0);
    assert.strictEqual(html.indexOf('name="nav" value="back"'), -1, 'nothing before step 1');
    assert.ok(html.indexOf('← Your projects</a>') > 0);
    assert.strictEqual(getStep(setup(), 'plans').indexOf('h-facts'), -1, 'the facts card is on step 1 only');
});

test('GET: the goods date — the opportunity\'s date read-only beside it; the build stage from UPD_BUILD_STAGES, stripped', function () {
    var t = setup();
    var html = getStep(t, 'project');
    assert.ok(/We currently have: [A-Z][a-z]{2} 14 Nov( 2026)?<\/p><p class="hint" style="margin:0">Has this changed\? Tell us the new date/
        .test(html), 'amendment 1 §1');
    var stage = html.slice(html.indexOf('name="q_build_stage"') - 200, html.indexOf('id="q-goods_date"'));
    assert.deepStrictEqual((stage.match(/value="(\d+)"/g) || []), ['value="4"', 'value="2"'], 'UPD_BUILD_STAGES order, 6 not offered');
    assert.ok(stage.indexOf('<span class="ot">Roof on</span>') > 0 && stage.indexOf('2 - Foundations') < 0, 'stageLabel');
    assert.ok(/value="2" checked/.test(stage), 'the current stage');
});

test('GET: an unparsable state logs DESIGNINFO_STATE_INVALID once and the page renders as nothing received', function () {
    var t = setup();
    t.w.opps[20].custbody_cdb_designinfo_state = '{not json';
    var html = get(t);
    assert.ok(html.indexOf('Tell us about your property') > 0);
    assert.strictEqual(logs(t.w, 'DESIGNINFO_STATE_INVALID').length, 1);
});

// ---------------------------------------------------------------- the guard

test('guard: wrong customer, not Won, a sub-status in neither list, FC none — refused, logged, nothing written', function () {
    var cases = [
        ['wrong customer', function (w) { w.opps[20].entity = '43'; }, 'opportunity belongs to another customer'],
        ['not Won', function (w) { w.opps[20].entitystatus = '10'; }, 'not Won'],
        ['sub-status', function (w) { w.opps[20].custbody_opportunity_sub_status = '8'; }, 'neither NEEDINFO'],
        ['FC none', function (w) { w.opps[20].custbody_mi_opp_fc = '8'; }, 'FC maps to none'],
        ['not a number', null, 'opportunity not found']
    ];
    cases.forEach(function (c) {
        var t = setup();
        if (c[1]) { c[1](t.w); }
        var html = c[1] ? get(t) : get(t, 'abc');
        assert.ok(logs(t.w, 'DESIGNINFO_REFUSED')[0][2].indexOf(c[2]) > 0, c[0]);
        assert.ok(html.indexOf(c[0] === 'FC none' ? 'Nothing is needed from you for this project.' :
            'That project isn\u2019t waiting for design information.') > 0, c[0]);
        html = c[1] ? post(t, { q_ceilings: 'New', sec: 'plans' }) : '';
        nothingWritten(t, c[0]);
    });
});

test('registry: no setting, a missing file or a broken file — "not available right now", DESIGNINFO_NO_REGISTRY', function () {
    [setup({ settings: { DESIGNINFO_REGISTRY: null } }), setup({ registry: 'nope' }), (function () {
        var t = setup();
        delete t.w.files[REGISTRY_PATH];
        return t;
    }())].forEach(function (t, i) {
        var html = get(t);
        assert.ok(html.indexOf('This isn\u2019t available right now.') > 0, String(i));
        assert.strictEqual(logs(t.w, 'DESIGNINFO_NO_REGISTRY').length, 1, String(i));
        assert.strictEqual(t.w.oppLoadModes, undefined, 'no record load');
    });
});

test('view mode (a DESIGN sub-status): Review is the page — no inputs, no Edit, no Send, the banner; a POST writes nothing', function () {
    var t = setup();
    t.w.opps[20].custbody_opportunity_sub_status = '4';
    var html = get(t);
    assert.ok(html.indexOf('<h1>Review and send</h1>') > 0, '2.4.0: Review is the page');
    assert.ok(html.indexOf('Need to change something? Send a note to <a href="mailto:pe@x">Pem Engineer</a> or call Pem Engineer ' +
        'on <a href="tel:0101">0101</a>.') > 0);
    assert.strictEqual(html.indexOf('name="send"'), -1);
    assert.strictEqual(html.indexOf('<form '), -1, 'no form');
    assert.strictEqual((html.match(/<(input|textarea) [^>]*name="(q_|f_)/g) || []).length, 0, 'no inputs');
    assert.strictEqual(html.indexOf('>Edit<'), -1);
    assert.strictEqual(html.indexOf('a=update'), -1, 'no "Give us an update" link: not valid for Won');
    // 2.4.0: a step URL in view mode redirects to Review.
    assert.strictEqual(getStep(t, 'plans'), '');
    assert.ok(/&a=designinfo&opp=20&step=review$/.test(t.redirect), t.redirect);
    assert.ok(getStep(t, 'review').indexOf('<h1>Review and send</h1>') > 0, 'no loop');
    assert.strictEqual(t.redirect, '');
    var after = post(t, { q_ceilings: 'New', step: 'plans', nav: 'next' });
    assert.strictEqual(t.redirect, '', 'no redirect: Review again');
    assert.ok(after.indexOf('Your design is being prepared.') > 0);
    nothingWritten(t, 'view mode');
});

// ---------------------------------------------------------------- a section save

test('save: only changed non-empty fields, ONE submitFields with the state; blank never clears; a Note, no Task', function () {
    var t = setup();
    var html = post(t, { step: 'plans', q_ceilings: 'All 2.4 m', q_windows: 'Bifolds 2.1 m', q_unheated: '', q_plans_current: 'yes',
        q_design_contact: '' });
    var w = oppWrites(t.w);
    assert.strictEqual(w.length, 1, 'one write');
    assert.deepStrictEqual(Object.keys(w[0].values).sort(), ['custbody_cdb_designinfo_state',
        'custbody_elevations_window_sizes_2026']);
    assert.strictEqual(w[0].values.custbody_elevations_window_sizes_2026, 'Bifolds 2.1 m');
    assert.deepStrictEqual(w[0].options, { enableSourcing: false, ignoreMandatoryFields: true });
    assert.strictEqual(t.w.opps[20].custbody_sections_ceiling_heights_2026, 'All 2.4 m', 'unchanged, not written');
    var st = state(t.w);
    assert.strictEqual(st.answers.plans_current, 'yes');
    assert.strictEqual(st.sections.plans.status, 'done', 'its one required question answered');
    assert.strictEqual(st.sent, '');
    assert.strictEqual(t.w.notes.length, 1);
    var n = t.w.notes[0].values;
    assert.ok(/^Design information from customer \u00b7 \d\d\/\d\d\/\d{4} \d\d:\d\d$/.test(n.title));
    assert.strictEqual(n.transaction, '20');
    assert.strictEqual(n.author, '77', 'the PE');
    assert.strictEqual(n.notetype, undefined, 'NOTE_TYPE empty');
    assert.ok(n.note.indexOf('Sections saved: Your plans\nSent to PE: no\n\nYour plans\n') === 0);
    assert.ok(n.note.indexOf(' Are the plans we hold still the current ones?: \u2014 \u2192 Yes') > 0);
    assert.ok(n.note.indexOf(' Windows and external doors: \u2014 \u2192 Bifolds 2.1 m') > 0);
    assert.strictEqual(n.note.indexOf('Ceiling heights'), -1, 'unchanged questions are not listed');
    assert.strictEqual(t.w.tasks.length, 0, 'no Task without Send');
    // 2.4.0: no nav is "stay" — a redirect to the same step, which says Saved and ticks the step in the bar.
    assert.ok(/&step=plans&saved=1$/.test(t.redirect), t.redirect);
    assert.ok(html.indexOf('<div class="donep" role="status"><p>Saved.</p></div>') > 0);
    assert.ok(html.indexOf('aria-label="Step 2 of 7: Your plans, done" aria-current="step"><span class="scirc" ' +
        'aria-hidden="true">\u2713</span>') > 0);
    assert.ok(/CDB DESIGNINFO_SAVED/.test(JSON.stringify(t.w.logs)));
    assert.ok(logs(t.w, 'DESIGNINFO_SAVED')[0][2].indexOf('sections plans; fields custbody_elevations_window_sizes_2026; files 0; ' +
        'send no') > 0);
});

test('save (2.4.1): posting nothing new writes nothing — no state, no Note — and does not say Saved', function () {
    var t = setup();
    post(t, { step: 'plans', q_ceilings: 'All 2.4 m' });
    nothingWritten(t, 'nothing new');
    assert.ok(/&step=plans$/.test(t.redirect), t.redirect);
    assert.strictEqual(logs(t.w, 'DESIGNINFO_NO_CHANGE').length, 1);
});

test('choice @field writes the option ID; one outside UPD_BUILD_STAGES or not offered is rejected, nothing written', function () {
    var t = setup();
    post(t, { step: 'project', q_build_stage: '4' });
    assert.strictEqual(oppWrites(t.w)[0].values.custbody_build_stage, '4');
    assert.ok(t.w.notes[0].values.note.indexOf(' Build stage: Foundations \u2192 Roof on') > 0);
    ['6', '9'].forEach(function (id) {
        var u = setup();
        var html = post(u, { step: 'project', q_build_stage: id });
        assert.ok(html.indexOf('Please choose one of the options shown.') > 0, id);
        assert.ok(html.indexOf('Nothing has been saved yet.') > 0);
        nothingWritten(u, 'stage ' + id);
        assert.ok(logs(u.w, 'DESIGNINFO_REJECTED').length === 1);
    });
});

test('choice @field: getSelectOptions() failing or UPD_BUILD_STAGES empty shows it read-only and logs OPTIONS_UNAVAILABLE', function () {
    [function (t) { t.w.selectOptionsThrow = true; }, null].forEach(function (f, i) {
        var t = i ? setup({ settings: { UPD_BUILD_STAGES: null } }) : setup();
        if (f) { f(t); }
        var html = getStep(t, 'project');
        assert.ok(html.indexOf('<p class="ro">Foundations <span class="muted">(we\u2019ll cover this on your call)</span></p>') > 0);
        assert.strictEqual(html.indexOf('name="q_build_stage"'), -1);
        assert.strictEqual(logs(t.w, 'DESIGNINFO_OPTIONS_UNAVAILABLE').length, 1);
    });
});

test('the goods date (amendment 1 §1): never custbody_opp_del_date — the state, the Note "customer says", the Task line', function () {
    var d = amd.load('lib/cdb_lib_dates');
    var key = d.addDays(d.londonTodayKey(Date.now()), 30);
    var slash = key.slice(8, 10) + '/' + key.slice(5, 7) + '/' + key.slice(0, 4);
    var t = setup();
    post(t, { step: 'project', q_goods_date: key, send: '1' });
    oppWrites(t.w).forEach(function (o) {
        assert.strictEqual(o.values.hasOwnProperty('custbody_opp_del_date'), false);
    });
    assert.strictEqual(t.w.opps[20].custbody_opp_del_date, '2026-11-14', 'unchanged');
    assert.strictEqual(state(t.w).answers.goods_date, key);
    assert.ok(t.w.notes[0].values.note.indexOf(' Goods needed: 14/11/2026 \u2192 customer says ' + slash) > 0);
    assert.ok(t.w.tasks[0].values.message.indexOf('Customer says goods are needed by ' + slash + ' (we hold 14/11/2026). Check ' +
        'and update the opportunity date yourself; the dashboard did not change it.') > 0);
    // A bad date: the update page's rule and message.
    var u = setup();
    assert.ok(post(u, { step: 'project', q_goods_date: '2020-01-01' }).indexOf('Please choose a date from today onwards, within ' +
        'five years.') > 0);
    nothingWritten(u, 'a past date');
});

test('a date question on a DATE field writes a Date; on a non-DATE field it is read-only', function () {
    var reg = [HEADER, 'project,Your project,main,start,date,Start date,,,custbody15,N,,'].join('\n') + '\n';
    var d = amd.load('lib/cdb_lib_dates');
    var key = d.addDays(d.londonTodayKey(Date.now()), 10);
    var t = setup({ registry: reg });
    t.w.oppFieldTypes.custbody15 = 'date';
    post(t, { step: 'project', q_start: key });
    assert.ok(oppWrites(t.w)[0].values.custbody15 instanceof Date);
    var u = setup({ registry: reg });
    assert.ok(getStep(u, 'project').indexOf('(we\u2019ll cover this on your call)') > 0);
    assert.strictEqual(logs(u.w, 'DESIGNINFO_FIELD_MISMATCH').length, 1);
});

test('yesno: a checkbox field gets a boolean, a text field "Yes"', function () {
    var t = setup();
    post(t, { step: 'heating', q_through_walls: 'yes' });
    assert.strictEqual(oppWrites(t.w)[0].values.custbody28, true);
    var u = setup();
    u.w.oppFieldTypes.custbody28 = 'text';
    post(u, { step: 'heating', q_through_walls: 'yes' });
    assert.strictEqual(oppWrites(u.w)[0].values.custbody28, 'Yes');
});

test('a missing field: the question is omitted, logged once, and listed in the Task as not saved', function () {
    var t = setup();
    t.w.missingOppFields = ['custbody17'];
    var html = get(t);
    assert.strictEqual(html.indexOf('q_coverings'), -1);
    assert.strictEqual(logs(t.w, 'DESIGNINFO_FIELD_MISSING').length, 1);
    assert.ok(logs(t.w, 'DESIGNINFO_FIELD_MISSING')[0][2].indexOf('coverings') > 0);
    post(t, { send: '1' });
    assert.ok(t.w.tasks[0].values.message.indexOf('Not saved to the record (the customer was told we\u2019ll cover it on the ' +
        'call): coverings (field missing).') > 0);
});

test('a mismatched field: shown read-only, never written even when posted, listed in the Note and the Task', function () {
    var t = setup();
    t.w.oppFieldTypes.custbody15 = 'select';
    t.w.opps[20].custbody15_text = '1930s';
    var html = getStep(t, 'insulation');
    assert.ok(html.indexOf('<p class="ro">1930s <span class="muted">(we\u2019ll cover this on your call)</span></p>') > 0);
    assert.strictEqual(logs(t.w, 'DESIGNINFO_FIELD_MISMATCH').length, 1);
    post(t, { step: 'insulation', q_year: '1990', send: '1' });
    oppWrites(t.w).forEach(function (o) { assert.strictEqual(o.values.hasOwnProperty('custbody15'), false); });
    assert.ok(t.w.notes[0].values.note.indexOf('Not saved to the record: year (type mismatch: custbody15 is SELECT)') > 0);
    assert.ok(t.w.tasks[0].values.message.indexOf('year (type mismatch: custbody15 is SELECT)') > 0);
});

test('a PHONE field that cannot take the text: not written, kept in the Note, listed as not saved', function () {
    var t = setup();
    t.w.oppFieldTypes.custbody_des_cont_phone = 'phone';
    post(t, { step: 'project', q_design_contact: 'Dave, site manager, 07700 900123' });
    assert.deepStrictEqual(Object.keys(oppWrites(t.w)[0].values), ['custbody_cdb_designinfo_state']);
    assert.ok(t.w.notes[0].values.note.indexOf('Dave, site manager, 07700 900123 (NOT saved to the record: the field takes a ' +
        'phone only)') > 0);
});

test('maxLength: clipped to the field\'s own when getField() exposes one, and said so', function () {
    var t = setup();
    t.w.fieldMaxLength = { custbody_elevations_window_sizes_2026: 10 };
    post(t, { step: 'plans', q_windows: 'Bifolds 2.1 m tall' });
    assert.strictEqual(oppWrites(t.w)[0].values.custbody_elevations_window_sizes_2026, 'Bifolds 2.');
    assert.ok(t.w.notes[0].values.note.indexOf('(clipped to 10 characters on the record)') > 0);
});

test('validation: lengths, a yes/no, a literal choice index — any error re-renders the step with the answers, nothing written', function () {
    var t = setup();
    var html = post(t, { step: 'plans', nav: 'next', q_windows: Array(4002).join('x'), q_plans_current: 'maybe',
        q_unheated: '<b>kept</b>' });
    nothingWritten(t, 'errors');
    assert.strictEqual(t.redirect, '', '2.4.0: no redirect');
    assert.ok(html.indexOf('<input type="hidden" name="step" value="plans">') > 0, 'the same step');
    assert.ok(html.indexOf('Please keep this under 4000 characters.') > 0);
    assert.ok(html.indexOf('Please choose Yes or No.') > 0);
    assert.ok(html.indexOf('Nothing has been saved yet.') > 0);
    assert.ok(html.indexOf('>&lt;b&gt;kept&lt;/b&gt;</textarea>') > 0, 'the answer kept, escaped');
    assert.strictEqual(html.indexOf('<b>kept</b>'), -1);
    var u = setup();
    html = post(u, { step: 'project', nav: 'next', q_design_contact: Array(302).join('y') });
    assert.ok(html.indexOf('<input type="hidden" name="step" value="project">') > 0);
    assert.ok(html.indexOf('Please keep this under 300 characters.') > 0);
    nothingWritten(u, 'project errors');
    // 2.4.0: an error only on another step (a crafted post) shows that step, so it is never hidden.
    var v = setup();
    html = post(v, { step: 'plans', nav: 'next', q_ins_choice: '9' });
    assert.ok(html.indexOf('<input type="hidden" name="step" value="insulation">') > 0);
    assert.ok(html.indexOf('Please choose one of the options shown.') > 0);
    nothingWritten(v, 'insulation error');
});

// ---------------------------------------------------------------- files

test('files: saved into the folder, private, named, attached; the state records each; DESIGNINFO_FILE per file', function () {
    var t = setup();
    var html = post(t, { step: 'plans' }, { f_plans_files_1: part(t, 'Ground floor.pdf', 1258291), f_plans_files_2: part(t, 'b.dwg'),
        f_plans_files_3: { name: '', size: 0 } });
    assert.strictEqual(t.w.savedFiles.length, 2, 'an empty part is not a file');
    assert.ok(/^QR20_plans_files_\d{8}-\d{4}_Ground_floor\.pdf$/.test(t.w.savedFiles[0].name));
    assert.strictEqual(t.w.savedFiles[0].folder, 555);
    assert.strictEqual(t.w.savedFiles[0].isOnline, false);
    assert.deepStrictEqual(t.w.attaches[0], { record: { type: 'file', id: 901 }, to: { type: 'opportunity', id: 20 } });
    assert.strictEqual(logs(t.w, 'DESIGNINFO_FILE').length, 2);
    var st = state(t.w);
    assert.strictEqual(st.files.length, 2);
    assert.deepStrictEqual([st.files[0].qid, st.files[0].id, st.files[0].attached], ['plans_files', '901', true]);
    assert.strictEqual(oppWrites(t.w).length, 1, 'no field change: the state alone, after the files');
    assert.ok(t.w.notes[0].values.note.indexOf(' Files: QR20_plans_files_') > 0 && t.w.notes[0].values.note.indexOf('(1.2 MB)') > 0);
    // 2.4.0: the file control lists each upload as a row: a type badge, the name, the date. No Remove.
    assert.ok(/<div class="frow"><span class="ftype">PDF<\/span><span class="fname" title="QR20_plans_files_\d{8}-\d{4}_Ground_floor\.pdf">/
        .test(html), 'listed under the question');
    assert.ok(/<span class="fwhen">uploaded \d\d\/\d\d\/\d{4}<\/span>/.test(html), 'uploaded date');
    assert.ok(html.indexOf('<span class="ftype">DWG</span>') > 0);
    assert.strictEqual(/>Remove</.test(html), false, 'no Remove');
});

test('files with field changes: the fields first, then the files, then the state (two writes)', function () {
    var t = setup();
    post(t, { step: 'plans', q_windows: 'Lots' }, { f_plans_files_1: part(t, 'a.pdf') });
    var w = oppWrites(t.w);
    assert.strictEqual(w.length, 2);
    assert.deepStrictEqual(Object.keys(w[0].values), ['custbody_elevations_window_sizes_2026']);
    assert.deepStrictEqual(Object.keys(w[1].values), ['custbody_cdb_designinfo_state']);
    assert.strictEqual(state(t.w).sections.plans.status, 'todo', '"Are they still the current ones?" is still unanswered');
    assert.strictEqual(state(t.w).files.length, 1);
});

test('files: the count, the size and the extension are checked before anything is written', function () {
    var cases = [
        [{ f_plans_files_1: 'a.pdf', f_plans_files_2: 'b.pdf', f_plans_files_3: 'c.pdf', f_plans_files_4: 'd.pdf',
            f_plans_files_5: 'e.pdf', f_plans_files_6: 'f.pdf', f_plans_files_7: 'g.pdf' }, 'Please choose at most 6 files'],
        [{ f_plans_files_1: 'big.pdf' }, 'is bigger than 10 MB', 10485761],
        [{ f_plans_files_1: 'setup.exe' }, 'is not a file type we can take']
    ];
    cases.forEach(function (c) {
        var t = setup();
        var files = {};
        Object.keys(c[0]).forEach(function (k) { files[k] = part(t, c[0][k], c[2]); });
        var html = post(t, { step: 'plans', q_windows: 'Lots' }, files);
        assert.ok(html.indexOf(c[1]) > 0, c[1]);
        nothingWritten(t, c[1]);
    });
});

test('files: a failed attach keeps the file and says so; a failed save says so; no folder refuses the files only', function () {
    var t = setup();
    t.w.attachThrows = true;
    post(t, { step: 'plans', send: '1' }, { f_plans_files_1: part(t, 'a.pdf') });
    assert.strictEqual(t.w.savedFiles.length, 1, 'the file stays in the folder');
    assert.strictEqual(state(t.w).files[0].attached, false);
    assert.ok(logs(t.w, 'DESIGNINFO_FILE')[0][2].indexOf('NOT attached to the opportunity') > 0);
    assert.ok(t.w.notes[0].values.note.indexOf('NOT attached to the opportunity') > 0);
    assert.ok(t.w.tasks[0].values.message.indexOf('(NOT attached: in the folder only)') > 0);

    var u = setup();
    u.w.fileSaveThrows = true;
    var html = post(u, { step: 'plans', q_windows: 'Lots' }, { f_plans_files_1: part(u, 'a.pdf') });
    // 2.4.0: after the redirect, a whitelisted warning (&w=files) — nothing the customer typed travels in the URL.
    assert.ok(/&step=plans&saved=1&w=files$/.test(u.redirect), u.redirect);
    assert.ok(html.indexOf('We couldn\u2019t save one of your files. Please try again, or email it to Pem Engineer.') > 0);
    assert.strictEqual(oppWrites(u.w)[0].values.custbody_elevations_window_sizes_2026, 'Lots', 'the answers still save');

    var v = setup({ settings: { DESIGNINFO_FOLDER: null } });
    assert.ok(get(v).indexOf('We can\u2019t take files here at the moment.') > 0);
    html = post(v, { step: 'plans', q_windows: 'Lots' }, { f_plans_files_1: part(v, 'a.pdf') });
    assert.strictEqual(v.w.savedFiles.length, 0);
    assert.strictEqual(logs(v.w, 'DESIGNINFO_NO_FOLDER').length, 1);
    assert.strictEqual(oppWrites(v.w)[0].values.custbody_elevations_window_sizes_2026, 'Lots');
    assert.ok(/&w=uploads$/.test(v.redirect), v.redirect);
    assert.ok(html.indexOf('We can\u2019t take files here at the moment.') > 0);
});

// ---------------------------------------------------------------- the Note and the Task

test('the Note on every save, clipped at 3,900 (DESIGNINFO_NOTE_CLIPPED); a failed Note never stops the save', function () {
    var t = setup();
    var long = Array(3000).join('z');
    post(t, { step: 'plans', q_windows: long, q_unheated: long, q_ceilings: long, q_walls_ex: long, q_windows_ex: long,
        q_roof_ex: long, q_floors_ex: long, q_manifolds: long, q_screed: long, q_joists: long, q_coverings: long, q_hp_location: long,
        q_hp_buffer: long, q_other: long });
    assert.strictEqual(t.w.notes[0].values.note.length, 3900);
    assert.ok(/\(truncated\)$/.test(t.w.notes[0].values.note));
    assert.ok(t.w.notes[0].values.note.indexOf('z\u2026') > 0, 'each value clipped at 300 with …');
    assert.strictEqual(logs(t.w, 'DESIGNINFO_NOTE_CLIPPED').length, 1);

    var u = setup();
    u.w.noteThrows = true;
    var html = post(u, { step: 'plans', q_windows: 'Lots', send: '1' });
    assert.strictEqual(oppWrites(u.w)[0].values.custbody_elevations_window_sizes_2026, 'Lots');
    assert.strictEqual(logs(u.w, 'DESIGNINFO_NOTE_FAILED')[0][0], 'error');
    assert.ok(u.w.tasks[0].values.message.indexOf('Audit note NOT created') > 0);
    assert.ok(html.indexOf('Sent to Pem Engineer.') > 0);
});

test('the Task, only on Send: title, assignee, what is missing, a snapshot of the answers, the Mimecast line', function () {
    var t = setup();
    post(t, { step: 'plans', q_windows: 'First' });
    assert.strictEqual(t.w.tasks.length, 0);
    var html = post(t, { send: '1', q_bigfiles: 'yes', q_unheated: 'Garage' });
    assert.strictEqual(t.w.tasks.length, 1);
    var v = t.w.tasks[0].values;
    assert.strictEqual(v.title, 'DESIGN INFO \u2013 Barn conversion');
    assert.strictEqual(v.assigned, '77');
    assert.strictEqual(v.company, '42');
    assert.strictEqual(v.transaction, '20');
    assert.strictEqual(v.priority, 'MEDIUM');
    assert.ok(v.message.indexOf('Still missing: Your plans, How well insulated is it?, Heating and controls, Your heat pump.') > 0);
    // Amendment 3: a snapshot of every shown section's current answers (the earlier save included).
    assert.ok(v.message.indexOf('Your plans (to do)\n- Are the plans we hold still the current ones?: \u2014') < 0);
    assert.ok(v.message.indexOf('- Ceiling heights: All 2.4 m\n- Windows and external doors: First\n') > 0, v.message);
    // Amendment 2 §5: the Task is plain text — never an HTML entity.
    assert.strictEqual(v.message.indexOf('&#39;'), -1);
    assert.ok(v.message.indexOf('- Anywhere we shouldn\'t heat?: Garage') > 0);
    assert.ok(v.message.indexOf('- I have files bigger than 10 MB: Yes') > 0);
    assert.ok(v.message.indexOf('How well insulated is it? (to do)\n(nothing yet)') > 0);
    assert.strictEqual(v.message.indexOf('Changes since the last send'), -1, 'no earlier send, no request: no pointer');
    assert.ok(v.message.indexOf('LARGE FILES: the customer has files over 10 MB. Send a Mimecast large-file request.') > 0);
    assert.ok(t.w.notes[1].values.note.indexOf('Sent to PE: yes') > 0);
    assert.ok(t.w.notes[1].values.note.indexOf('Large files: customer has files over 10 MB') > 0);
    var st = state(t.w);
    assert.ok(st.sent && st.lastTaskAt === st.sent);
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(st.sent), 'to the minute');
    assert.ok(html.indexOf('<p>Sent to Pem Engineer.</p><p>Pem will read it all before your design call.</p>') > 0);
    assert.ok(logs(t.w, 'DESIGNINFO_SAVED')[1][2].indexOf('send yes, Task 555') > 0);
    // The next Send is a snapshot again, and points to the Notes after the previous send.
    post(t, { send: '1', q_other: 'Zoning please' });
    var m2 = t.w.tasks[1].values.message;
    assert.ok(m2.indexOf('- Windows and external doors: First') > 0, 'the whole picture');
    assert.ok(m2.indexOf('- Anything else: Zoning please') > 0);
    assert.ok(/Changes since the last send are in the opportunity\u2019s Notes dated after \d\d\/\d\d\/\d{4} \d\d:\d\d\./.test(m2));
});

test('a failed Task puts the state back (not sent) and the page says to send again', function () {
    var t = setup();
    t.w.taskThrows = true;
    var html = post(t, { send: '1', q_windows: 'Lots' });
    var st = state(t.w);
    assert.strictEqual(st.sent, '');
    assert.strictEqual(st.lastTaskAt, '');
    assert.strictEqual(logs(t.w, 'TASK_FAILED')[0][0], 'error');
    assert.ok(html.indexOf('We couldn\u2019t pass it on just now. Please press Send again in a few minutes.') > 0);
});

test('a failed field write still saves the state and the Note, and the Task says what was NOT saved', function () {
    var t = setup();
    t.w.submitThrows = function (o) { return o.values.hasOwnProperty('custbody_elevations_window_sizes_2026'); };
    post(t, { send: '1', q_windows: 'Lots' });
    assert.strictEqual(logs(t.w, 'DESIGNINFO_WRITE_FAILED')[0][0], 'error');
    assert.deepStrictEqual(Object.keys(oppWrites(t.w)[0].values), ['custbody_cdb_designinfo_state'], 'the state on its own');
    assert.ok(t.w.notes[0].values.note.indexOf('NOT saved: the answers for the Project Specification tab') > 0);
    assert.ok(t.w.tasks[0].values.message.indexOf('NOT SAVED (please enter by hand):\n- the answers for the Project Specification ' +
        'tab (USER_ERROR: submitFields refused): Windows and external doors') > 0);
});

test('fact warnings reach the Task: an unknown service, an HP Design with a boiler', function () {
    var t = setup();
    t.w.opps[20].custbody_mi_heat_source = '4';
    post(t, { send: '1' });
    assert.ok(t.w.tasks[0].values.message.indexOf('- The design service is HP Design, but the heat source is not a Nu-Heat heat ' +
        'pump.') > 0);
    var u = setup();
    u.w.opps[20].custbody_value_proposition = '99';
    assert.ok(get(u).indexOf('name="goto" value="insulation" aria-label="Step 3 of 7: How well insulated is it?"') > 0,
        'unknown: the UFH Design + set');
    post(u, { send: '1' });
    assert.ok(u.w.tasks[0].values.message.indexOf('Design service unknown: value proposition 99 is not in VP_MAP') > 0);
});

test('state merges: requested and earlier answers survive a save (a version 1 state migrated); unparsable is replaced', function () {
    var t = setup();
    t.w.opps[20].custbody_cdb_designinfo_state = JSON.stringify({ v: 1, requested: '2026-10-01T09:00:00Z', answers: { bigfiles: 'no' },
        sections: {}, files: [], pending: [{ s: 'x', l: 'y', o: '', n: 'z', at: 'w' }], noted: {} });
    post(t, { step: 'plans', q_plans_current: 'no' });
    var st = state(t.w);
    assert.strictEqual(st.requested, '2026-10-01T09:00Z', 'kept, to the minute');
    assert.strictEqual(t.w.opps[20].custbody_cdb_designinfo_state.indexOf('pending'), -1, 'the change list is gone');
    assert.deepStrictEqual(st.answers, { bigfiles: 'no', plans_current: 'no' });
    var u = setup();
    u.w.opps[20].custbody_cdb_designinfo_state = 'garbage';
    post(u, { step: 'plans', q_plans_current: 'yes' });
    assert.strictEqual(state(u.w).answers.plans_current, 'yes');
    assert.strictEqual(logs(u.w, 'DESIGNINFO_STATE_INVALID').length, 1);
});

test('a Note-only answer (not a date) is marked noted (not kept), and the page says so next time', function () {
    var t = setup();
    post(t, { step: 'heatpump', q_nb_which: 'The kitchen window of number 6' });
    post(t, { step: 'project', q_w3w: '///a.b.c' });
    var st = state(t.w);
    assert.ok(st.noted.nb_which && st.noted.w3w);
    assert.strictEqual(st.answers.nb_which, undefined);
    assert.strictEqual(st.answers.w3w, undefined, 'amendment 3: only state answers and Note-only dates are kept');
    assert.ok(getStep(t, 'project').indexOf('You\u2019ve sent us this already. Anything new? Add it here.') > 0);
});

// ---------------------------------------------------------------- the card states (dashboard and digest)

/** Opportunity 20's card on the dashboard and its digest card, with this state and sub-status. */
function cards(st, opts) {
    var o = opts || {};
    var t = setup(o.setup);
    t.w.opps[20].custbody_cdb_designinfo_state = st ? JSON.stringify(st) : '';
    t.w.opps[20].custbody_opportunity_sub_status = o.sub || '1';
    if (o.fc) { t.w.opps[20].custbody_mi_opp_fc = o.fc; }
    if (o.next) { t.w.opps[20].custbody_next_contact = o.next; }
    if (o.extrasThrow) { t.w.oppExtrasThrow = true; }
    var html = run(t, 'GET', { t: t.tok });
    var row = html.slice(html.indexOf('<span class="name">Barn conversion</span>'));
    row = row.slice(0, row.indexOf('</div></div>') + 12);
    return { t: t, html: html, row: row, digest: digest(t) };
}

/** The digest email for customer 42, as the Map/Reduce builds it. */
function digest(t) {
    var s = t.s;
    var w = t.w;
    var mr;
    var input;
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42', custscript_cdbmr_won_statuses: '13',
        custscript_cdbmr_lost_statuses: '14', custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500' };
    w.settings = w.settings.concat([{ id: '399', name: 'PE_VALUEPROPS', value: '2,3' }]);
    mr = amd.load('cdb_mr_digest', s);
    input = mr.getInputData();
    w.emails = [];
    mr.map({ value: JSON.stringify(input[0]), write: function () {} });
    w.scriptId = 'customscript_cdb_sl_dashboard';
    return w.emails.length ? w.emails[0].body : '';
}

var SAVED = { v: 1, sections: { plans: { saved: '2026-10-02T10:00:00Z', status: 'done' } }, answers: {}, noted: {}, files: [],
    pending: [] };

test('cards: needs_info — the line and "Tell us about your property", on the dashboard and in the digest', function () {
    var c = cards(null);
    assert.ok(c.row.indexOf('We need some information about your property to start your design. Plans are the main thing. It ' +
        'takes about 10 minutes, and you can do it in stages.') > 0);
    assert.ok(c.row.indexOf('<a class="cta" href="https://acct.extforms.netsuite.com/sl?t=' + c.t.tok +
        '&amp;a=designinfo&amp;opp=20">Tell us about your property</a>') > 0);
    assert.ok(c.digest.indexOf('We need some information about your property to start your design.') > 0);
    assert.ok(c.digest.indexOf('<b>TELL US ABOUT YOUR PROPERTY</b>') > 0);
    assert.ok(c.digest.indexOf('a=designinfo&amp;opp=20') > 0, 'the direct link');
    // The extras search failing: still needs_info, logged.
    var f = cards(SAVED, { extrasThrow: true });
    assert.ok(f.row.indexOf('Tell us about your property</a>') > 0);
    assert.strictEqual(logs(f.t.w, 'OPP_EXTRAS_FAILED').length >= 1, true);
});

test('cards: info_partial — what we have, what is still to do, a progress bar, Continue', function () {
    var c = cards(SAVED);
    assert.ok(c.row.indexOf('Thanks, we have: Your plans. Still to do: How well insulated is it?, Heating and controls, Your heat ' +
        'pump.') > 0, c.row);
    assert.ok(c.row.indexOf('<span class="pbar" aria-hidden="true"><span style="width:25%"></span></span>') > 0);
    assert.ok(c.row.indexOf('>Continue</a>') > 0);
    assert.ok(c.html.indexOf('.pbar{') > 0, 'its CSS only on this page');
    assert.ok(c.digest.indexOf('Thanks, we have: Your plans. Still to do:') > 0);
    assert.ok(c.digest.indexOf('<b>CONTINUE</b>') > 0);
    assert.ok(c.digest.indexOf('<td width="25%" height="6" bgcolor="#ffb500"') > 0, 'the email-safe bar');
    // No registry: "a few more details".
    var n = cards(SAVED, { setup: { registry: 'broken' } });
    assert.ok(n.row.indexOf('Thanks for what you\u2019ve sent so far. Still to do: a few more details.') > 0);
    assert.ok(n.digest.indexOf('Still to do: a few more details.') > 0);
    assert.strictEqual(logs(n.t.w, 'DESIGNINFO_NO_REGISTRY').length >= 1, true);
});

test('cards: info_sent — received on the date, the PE\'s first name, "View or add to what you sent"', function () {
    var st = JSON.parse(JSON.stringify(SAVED));
    st.sent = '2026-10-02T14:10:00Z';
    var c = cards(st);
    assert.ok(/Information received, [A-Z][a-z]{2} 2 Oct( 2026)?\. Pem is reviewing it and will go through any questions on your design call\./
        .test(c.row), c.row);
    assert.ok(c.row.indexOf('<a class="out" href="') > 0 && c.row.indexOf('>View or add to what you sent</a>') > 0);
    assert.ok(c.digest.indexOf('Pem is reviewing it') > 0);
    assert.ok(c.digest.indexOf('<b>VIEW OR ADD TO WHAT YOU SENT</b>') > 0);
});

test('cards: designing — the line, no button; a design call date today or later; FC none shows the old card', function () {
    var d = amd.load('lib/cdb_lib_dates');
    var c = cards(null, { sub: '4', next: d.addDays(d.londonTodayKey(Date.now()), 3) });
    assert.ok(c.row.indexOf('Your design is being prepared. We\u2019ll email you when your installation drawings are ready.') > 0);
    assert.ok(c.row.indexOf('Design call: ') > 0);
    assert.strictEqual(c.row.indexOf('a=designinfo'), -1, 'nothing saved: no view link');
    assert.ok(c.digest.indexOf('Your design is being prepared.') > 0);
    assert.strictEqual(c.digest.indexOf('a=designinfo'), -1);
    var past = cards(null, { sub: '4', next: '2020-01-01' });
    assert.strictEqual(past.row.indexOf('Design call: '), -1, 'a past call is not shown');
    var none = cards(null, { fc: '8' });
    assert.ok(none.row.indexOf('Designing your system') > 0);
    assert.strictEqual(none.row.indexOf('We need some information'), -1);
    assert.strictEqual(none.row.indexOf('a=designinfo'), -1);
    assert.ok(none.digest.indexOf('Our design team is working on it. Nothing needed from you.') > 0, 'as before');
    assert.strictEqual(none.digest.indexOf('a=designinfo'), -1);
});

test('cards: no DESIGNINFO_REGISTRY setting — the lines stay, no button', function () {
    var c = cards(null, { setup: { settings: { DESIGNINFO_REGISTRY: null } } });
    assert.ok(c.row.indexOf('We need some information about your property') > 0);
    assert.strictEqual(c.row.indexOf('a=designinfo'), -1);
    assert.strictEqual(c.digest.indexOf('a=designinfo'), -1);
});

// ---------------------------------------------------------------- the request button (cdb_ue_opportunity.js)

function ue(values, opts) {
    var o = opts || {};
    var w = ns.world();
    var buttons = [];
    var messages = [];
    var s;
    w.scriptId = 'customscript_cdb_ue_opportunity';
    w.settings = o.settings || [{ id: '1', name: 'WON_STATUSES', value: '13' }, { id: '2', name: 'NEEDINFO_SUBSTATUS', value: '1' },
        { id: '3', name: 'FC_MAP', value: SETTINGS.FC_MAP }];
    s = ns.stubs(w);
    amd.load('cdb_ue_opportunity', s).beforeLoad({
        type: o.type || 'view', UserEventType: { VIEW: 'view' },
        request: { parameters: o.params || {} },
        newRecord: { id: '20', getValue: function (f) { return values[f.fieldId] === undefined ? '' : values[f.fieldId]; } },
        form: { addButton: function (b) { buttons.push(b); }, addPageInitMessage: function (m) { messages.push(m); } }
    });
    return { buttons: buttons, messages: messages, w: w };
}

var READY = { entitystatus: '13', custbody_opportunity_sub_status: '1', custbody_mi_opp_fc: '7' };

test('the button: only Won, Awaiting Design Info and an FC that is not none; any failure or empty setting: none', function () {
    var r = ue(READY);
    assert.strictEqual(r.buttons.length, 1);
    assert.strictEqual(r.buttons[0].label, 'Request design information');
    assert.strictEqual(r.buttons[0].functionName, 'window.location.assign(\'/app/site/hosting/scriptlet.nl?script=' +
        'customscript_cdb_sl_send_designinfo&deploy=customdeploy_cdb_sl_send_designinfo&opp=20\')');
    [['not Won', { entitystatus: '10' }], ['sub-status', { custbody_opportunity_sub_status: '4' }],
        ['FC none', { custbody_mi_opp_fc: '8' }]].forEach(function (c) {
        var v = Object.assign({}, READY, c[1]);
        assert.strictEqual(ue(v).buttons.length, 0, c[0]);
    });
    assert.strictEqual(ue(READY, { settings: [{ id: '1', name: 'WON_STATUSES', value: '13' },
        { id: '2', name: 'NEEDINFO_SUBSTATUS', value: '1' }] }).buttons.length, 0, 'FC_MAP empty: no button');
    assert.strictEqual(ue(READY, { settings: [{ id: '3', name: 'FC_MAP', value: SETTINGS.FC_MAP }] }).buttons.length, 0,
        'a missing setting: no button');
    assert.strictEqual(ue(READY, { type: 'edit' }).buttons.length, 0, 'view only');
});

test('the banner: whitelisted, recent only', function () {
    var r = ue({}, { params: { cdbdi: 'sent', cdbdt: String(Date.now()) } });
    assert.strictEqual(r.messages[0].title, 'Design information requested');
    assert.strictEqual(ue({}, { params: { cdbdi: 'nope', cdbdt: String(Date.now()) } }).messages.length, 0);
    assert.strictEqual(ue({}, { params: { cdbdi: 'sent', cdbdt: String(Date.now() - 600000) } }).messages.length, 0);
});

// ---------------------------------------------------------------- the Send design information Suitelet

/** The Suitelet on opportunity 20 (PE case). Returns { w, form, redirects, emails }. */
function request(method, opts) {
    var o = opts || {};
    var t = setup(o.setup);
    var w = t.w;
    var out = { form: null };
    w.scriptId = 'customscript_cdb_sl_send_designinfo';
    w.settings = w.settings.concat([{ id: '401', name: 'WON_STATUSES', value: '13' }, { id: '402', name: 'NEEDINFO_SUBSTATUS', value: '1' },
        { id: '406', name: 'DESIGN_SUBSTATUS', value: '1,4,5,13' },
        { id: '403', name: 'PE_VALUEPROPS', value: '2,3' }, { id: '404', name: 'FALLBACK_EMPLOYEE', value: '500' }]).concat(o.extra || []);
    if (o.world) { o.world(w); }
    amd.load('cdb_sl_send_designinfo', t.s).onRequest({
        request: { method: method, parameters: method === 'POST' ? { custpage_opp: '20' } : { opp: '20' } },
        response: { writePage: function (f) { out.form = f; }, setHeader: function () {}, write: function () {} }
    });
    out.w = w;
    return out;
}

test('send: GET shows the confirm page — customer, project, sender, recipient, the sections that will be asked', function () {
    var r = request('GET');
    var html = r.form.fields[0].defaultValue;
    assert.strictEqual(r.form.title, 'Request design information');
    assert.ok(html.indexOf('Acme Ltd') > 0 && html.indexOf('Barn conversion \u00b7 QR20') > 0);
    assert.ok(html.indexOf('Pem Engineer (Project Engineer)') > 0);
    assert.ok(html.indexOf('acme@example.com') > 0);
    assert.ok(html.indexOf('Your project, Your plans, How well insulated is it?, Heating and controls, Your heat pump, Anything ' +
        'else for your Project Engineer?') > 0);
    assert.strictEqual(r.form.submit, 'Send the email');
    assert.strictEqual(r.w.emails.length, 0);
});

test('send: refuses on each failed condition, with the reason, sending nothing', function () {
    var cases = [
        ['not Won', function (w) { w.opps[20].entitystatus = '10'; }, 'not Won'],
        ['sub-status', function (w) { w.opps[20].custbody_opportunity_sub_status = '4'; }, 'Awaiting Design Info'],
        ['FC none', function (w) { w.opps[20].custbody_mi_opp_fc = '8'; }, 'nothing is needed'],
        ['no FC_MAP', function (w) { w.settings = w.settings.filter(function (s) { return s.name !== 'FC_MAP'; }); }, 'FC_MAP is empty'],
        ['no email', function (w) { w.customers[42].email = ''; }, 'no valid email'],
        ['no registry', function (w) { delete w.files[REGISTRY_PATH]; }, 'registry is unavailable']
    ];
    cases.forEach(function (c) {
        ['GET', 'POST'].forEach(function (m) {
            var r = request(m, { world: c[1] });
            assert.strictEqual(r.form.title, 'Design information NOT requested', c[0] + ' ' + m);
            assert.ok(r.form.fields[0].defaultValue.indexOf(c[2]) > 0, c[0] + ' ' + m);
            assert.ok(logs(r.w, 'DESIGNINFO_REQUEST_REFUSED')[0][2].indexOf(c[2]) > 0, c[0] + ' ' + m);
            assert.strictEqual(r.w.emails.length, 0, c[0] + ' ' + m);
            assert.strictEqual(r.w.submits.length, 0, c[0] + ' ' + m);
        });
    });
});

test('send: POST emails emailRecipient() only, from the PE, with both records; sets requested (merged); the banner', function () {
    var r = request('POST', { world: function (w) {
        w.opps[20].custbody_cdb_designinfo_state = JSON.stringify({ v: 1, answers: { bigfiles: 'yes' } });
    } });
    var e = r.w.emails[0];
    assert.strictEqual(r.w.emails.length, 1);
    assert.deepStrictEqual(e.recipients, ['acme@example.com']);
    assert.strictEqual(e.author, 77);
    assert.deepStrictEqual(e.relatedRecords, { entityId: 42, transactionId: 20 });
    assert.strictEqual(e.subject, 'Let\u2019s start your design: tell us about your property');
    var st = JSON.parse(r.w.opps[20].custbody_cdb_designinfo_state);
    assert.strictEqual(st.v, 2, 'migrated and stored as version 2');
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(st.req));
    st = { requested: st.req, answers: st.a };
    assert.strictEqual(st.answers.bigfiles, 'yes', 'merged, never clobbered');
    assert.deepStrictEqual(Object.keys(r.w.submits[0].values), ['custbody_cdb_designinfo_state']);
    assert.strictEqual(logs(r.w, 'DESIGNINFO_REQUESTED').length, 1);
    assert.strictEqual(r.w.redirects[0].parameters.cdbdi, 'sent');
    assert.strictEqual(r.w.redirects[0].id, '20');
    // A contact's email beats the customer's (the digest's rule).
    var c = request('POST', { world: function (w) {
        w.customers[42].custentity_cdb_dashboard_contact = '61';
        w.contacts[61] = { email: 'site@example.com' };
    } });
    assert.deepStrictEqual(c.w.emails[0].recipients, ['site@example.com']);
    // Amendment 2 §7: an unparsable state is treated as empty, logged once, and replaced by a fresh one with requested
    // (amendment 3: version 2, req).
    var u = request('POST', { world: function (w) { w.opps[20].custbody_cdb_designinfo_state = 'garbage'; } });
    assert.strictEqual(u.w.emails.length, 1, 'the email went');
    assert.strictEqual(logs(u.w, 'DESIGNINFO_STATE_INVALID').length, 1);
    var fresh = JSON.parse(u.w.opps[20].custbody_cdb_designinfo_state);
    assert.strictEqual(fresh.v, 2);
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(fresh.req));
});

test('send: a failed email redirects with cdbdi=failed and records nothing', function () {
    var r = request('POST', { world: function (w) { w.emailThrow = true; } });
    assert.strictEqual(r.w.redirects[0].parameters.cdbdi, 'failed');
    assert.strictEqual(r.w.submits.length, 0);
    assert.strictEqual(logs(r.w, 'DESIGNINFO_REQUEST_FAILED')[0][0], 'error');
});

test('the email: band, personal paragraph (PE), facts rows present and omitted, steps, the button, DESIGN_EMAIL_ADDRESS', function () {
    var d = amd.load('lib/cdb_lib_dates');
    var call = d.addDays(d.londonTodayKey(Date.now()), 5);
    var r = request('POST', { world: function (w) { w.opps[20].custbody_next_contact = call; },
        extra: [{ id: '405', name: 'DESIGN_EMAIL_ADDRESS', value: 'design@nu-heat.co.uk' }] });
    var b = r.w.emails[0].body;
    assert.ok(b.indexOf('Let\u2019s start your design') > 0);
    assert.ok(b.indexOf('Tell us about your property, Acme Ltd') > 0);
    assert.ok(b.indexOf('Your plans and a few details are all we need to begin. About 10 minutes.') > 0);
    assert.ok(b.indexOf('I\u2019m Pem, your Project Engineer for this system, and I\u2019ll be designing it with you.') > 0);
    assert.ok(b.indexOf('QR20 \u00b7 Plot 4, Village') > 0);
    assert.ok(b.indexOf('In floor, solid + joisted \u00b7 Nu-Heat heat pump') > 0);
    assert.ok(b.indexOf('>Design call</font>') > 0);
    assert.ok(b.indexOf('>Goods needed</font>') > 0);
    assert.ok(b.indexOf('<b>TELL US ABOUT YOUR PROPERTY</b>') > 0);
    assert.ok(b.indexOf('a=designinfo&amp;opp=20') > 0);
    assert.ok(b.indexOf('Or view all your projects') > 0);
    assert.ok(b.indexOf('How well insulated it is') > 0, 'HP Design: step 2');
    assert.ok(b.indexOf('And where the heat pump, cylinder and buffer tank will go.') > 0, 'nuheat_hp: the heat pump sentence');
    assert.ok(b.indexOf('We only ask about what\u2019s on your quote, and you can stop and come back.') > 0);
    assert.ok(b.indexOf('What happens next') > 0 && b.indexOf('Drawings in 5\u20137 days') > 0);
    assert.ok(b.indexOf('<b>YOUR PROJECT ENGINEER</b>') > 0);
    assert.ok(b.indexOf('design@nu-heat.co.uk') > 0 && b.indexOf('pe@x') < 0, 'the design address instead of the PE\'s own');
    assert.ok(b.indexOf('You\u2019re receiving this because you have a project in design with Nu-Heat.') > 0);
    // No call date, no goods date: the rows are left out.
    var n = request('POST', { world: function (w) { w.opps[20].custbody_opp_del_date = ''; w.opps[20].custbody_next_contact = '2020-01-01'; } });
    assert.strictEqual(n.w.emails[0].body.indexOf('>Design call</font>'), -1);
    assert.strictEqual(n.w.emails[0].body.indexOf('>Goods needed</font>'), -1);
});

test('the email: the account manager variant — UFH Design, a boiler: no step 2, no heat pump sentence, the PE named', function () {
    var r = request('POST', { world: function (w) {
        w.opps[20].custbody_value_proposition = '1';
        w.opps[20].custbody_mi_heat_source = '4';
    } });
    var b = r.w.emails[0].body;
    assert.strictEqual(r.w.emails[0].author, 88, 'not a PE case: the sales rep');
    assert.ok(b.indexOf('I\u2019m Ray, your account manager. Pem Engineer will design your system with you.') > 0);
    assert.ok(b.indexOf('<b>YOUR ACCOUNT MANAGER</b>') > 0);
    assert.strictEqual(b.indexOf('How well insulated it is'), -1);
    assert.strictEqual(b.indexOf('And where the heat pump'), -1);
    assert.ok(b.indexOf('rep@x') > 0, 'the rep\'s own email');
    assert.ok(/<b>2<\/b>/.test(b) && !/<b>3<\/b><\/font><\/td><\/tr><\/table><\/td><td align="left" valign="top" style="padding:0 0 16px 0;"><p[^>]*><font[^>]*><b>Where things go/.test(b),
        'two steps, renumbered');
});

// ---------------------------------------------------------------- amendment 2 (2.3.1)

test('A2. writeDesignInfo refuses a deny-listed key, a key outside the allow-list and a blank (CDB_BAD_DESIGNINFO_WRITE)', function () {
    var t = setup();
    var data = amd.load('lib/cdb_lib_data', t.s);
    [{ custbody_opp_del_date: new Date() }, { custbody_opportunity_sub_status: '4' }, { custbody_not_ours: 'x' },
        { custbody15: '' }, { custbody15: '   ' }, { custbody15: null }].forEach(function (values) {
        assert.throws(function () { data.writeDesignInfo('20', values, '{}'); }, function (e) {
            return e.name === 'CDB_BAD_DESIGNINFO_WRITE';
        }, JSON.stringify(values));
    });
    assert.throws(function () { data.writeDesignInfo('20', {}); }, /nothing to write/);
    assert.strictEqual(t.w.submits.length, 0, 'nothing written');
    data.writeDesignInfo('20', { custbody28: false });
    assert.strictEqual(t.w.submits[0].values.custbody28, false, 'a checkbox "No" is a value, not a blank');
});

test('A2. yesno on a CHECKBOX: unticked reads back as "no"; "no" over a ticked box writes false; the section is done', function () {
    var reg = [HEADER, 'project,Your project,main,w3w,text,what3words,,,note,N,,',
        'heating,Heating and controls,general,through_walls,yesno,Through walls?,,,custbody28,Y,,'].join('\n') + '\n';
    var t = setup({ registry: reg });
    t.w.opps[20].custbody28 = false;
    var html = getStep(t, 'heating');
    assert.ok(/name="q_through_walls" value="no" checked/.test(html), 'a stored false is "no"');
    assert.ok(html.indexOf('aria-label="Step 2 of 3: Heating and controls, done"') > 0, 'answered');
    assert.ok(getStep(t, 'review').indexOf('Heating and controls<span class="chip chip-done">Done</span>') > 0, 'answered');
    var u = setup({ registry: reg });
    u.w.opps[20].custbody28 = true;
    post(u, { step: 'heating', q_through_walls: 'no' });
    assert.strictEqual(oppWrites(u.w)[0].values.custbody28, false, 'unticks the box');
    assert.strictEqual(state(u.w).sections.heating.status, 'done');
    assert.ok(u.w.notes[0].values.note.indexOf(' Through walls?: Yes → No') > 0);
    var v = setup({ registry: reg });
    v.w.opps[20].custbody28 = false;
    post(v, { step: 'heating', q_through_walls: 'no' });
    nothingWritten(v, '"no" over "no": no change (2.4.1: nothing written)');
});

test('A2. a question hidden by its `when`, posted anyway, is ignored: no write, no Note line', function () {
    var t = setup();
    post(t, { step: 'heating', q_heat_boiler: 'Combi in the kitchen', q_walls_new: 'Timber frame', q_overfloor: 'Old floor' });
    // 2.4.1: hidden answers are not changes, so nothing at all is written.
    nothingWritten(t, 'hidden answers only');
    assert.strictEqual(t.w.opps[20].custbody_cdb_designinfo_state, '');
    // With a real change beside them, the hidden ones are still left out.
    post(t, { step: 'heating', q_manifolds: 'Utility', q_heat_boiler: 'Combi in the kitchen', q_walls_new: 'Timber frame' });
    assert.deepStrictEqual(Object.keys(oppWrites(t.w)[0].values).sort(), ['custbody_cdb_designinfo_state',
        'custbody_manifold_locations_2026']);
    var note = t.w.notes[0].values.note;
    ['Combi in the kitchen', 'Timber frame'].forEach(function (x) { assert.strictEqual(note.indexOf(x), -1, x); });
    var st = state(t.w);
    assert.strictEqual(st.noted.heat_boiler, undefined);
    assert.deepStrictEqual(st.answers, {});
});

/** Fourteen long answers in one post: fourteen changes of 300+ characters each. */
function longAnswers(tag) {
    var long = tag + Array(3000).join('z');
    var p = {};
    ['windows', 'unheated', 'ceilings', 'walls_ex', 'windows_ex', 'roof_ex', 'floors_ex', 'manifolds', 'screed', 'joists',
        'coverings', 'hp_location', 'hp_buffer', 'other'].forEach(function (k) { p['q_' + k] = long; });
    return p;
}

test('A3. the Task snapshot is clipped at 3,900 (DESIGNINFO_TASK_CLIPPED); long values at 200; the Send still succeeds', function () {
    var t = setup();
    var p = longAnswers('a');
    var files = {};
    var i;
    for (i = 1; i <= 6; i++) {
        files['f_plans_files_' + i] = part(t, 'Plot4-ground-floor-revision-C-with-sections-and-elevations-' + i + '.pdf');
        files['f_layouts_files_' + i] = part(t, 'Plot4-kitchen-and-bathroom-layouts-from-the-kitchen-company-' + i + '.pdf');
    }
    p.send = '1';
    post(t, p, files);
    assert.strictEqual(t.w.tasks.length, 1, 'the Send succeeds');
    var m = t.w.tasks[0].values.message;
    assert.strictEqual(m.length, 3900);
    assert.ok(/\n\(truncated\)$/.test(m));
    assert.ok(m.indexOf('- Windows and external doors: a' + Array(199).join('z') + '\u2026\n') > 0, 'clipped at 200');
    assert.strictEqual(logs(t.w, 'DESIGNINFO_TASK_CLIPPED').length, 1);
    assert.ok(t.w.opps[20].custbody_cdb_designinfo_state.length <= 3500, 'and the state still fits');
});

test('A2. a RICHTEXT target is a type mismatch: read-only, never written, listed under "Not saved to the record"', function () {
    var t = setup();
    t.w.oppFieldTypes.custbody_elevations_window_sizes_2026 = 'richtext';
    var html = get(t);
    assert.strictEqual(html.indexOf('name="q_windows"'), -1);
    assert.ok(html.indexOf('(we’ll cover this on your call)') > 0);
    assert.ok(logs(t.w, 'DESIGNINFO_FIELD_MISMATCH')[0][2].indexOf('windows (custbody_elevations_window_sizes_2026 is RICHTEXT)') > 0);
    post(t, { step: 'plans', q_windows: '<img src=x onerror=alert(1)>', q_unheated: 'Garage' });
    oppWrites(t.w).forEach(function (o) {
        assert.strictEqual(o.values.hasOwnProperty('custbody_elevations_window_sizes_2026'), false);
    });
    assert.ok(t.w.notes[0].values.note.indexOf('Not saved to the record: windows (type mismatch: ' +
        'custbody_elevations_window_sizes_2026 is RICHTEXT)') > 0);
});

test('A2. line endings: a stored "a\\r\\nb" and a posted "a\\nb" is not a change', function () {
    var t = setup();
    t.w.opps[20].custbody_sections_ceiling_heights_2026 = 'a\r\nb';
    post(t, { step: 'plans', q_ceilings: 'a\nb' });
    post(t, { step: 'plans', q_ceilings: 'a\r\nb' });
    oppWrites(t.w).forEach(function (o) {
        assert.strictEqual(o.values.hasOwnProperty('custbody_sections_ceiling_heights_2026'), false);
    });
    t.w.notes.forEach(function (n) { assert.strictEqual(n.values.note.indexOf('Ceiling heights'), -1); });
});

test('A2. the Note and the Task are plain text: Don\'t & "quote" verbatim, never an entity; the page still escapes', function () {
    var t = setup();
    var html = post(t, { send: '1', q_unheated: 'Don\'t & "quote" <b>' });
    var note = t.w.notes[0].values.note;
    var msg = t.w.tasks[0].values.message;
    assert.ok(note.indexOf(' Anywhere we shouldn\'t heat?: — → Don\'t & "quote" <b>') > 0, note);
    assert.ok(msg.indexOf('- Anywhere we shouldn\'t heat?: Don\'t & "quote" <b>') > 0, msg);
    [note, msg].forEach(function (x) { assert.ok(!/&(amp|quot|#39|lt|gt);/.test(x)); });
    // Control characters are stripped from the plain text.
    var u = setup();
    post(u, { step: 'plans', q_unheated: 'Garage\u0007 only' });
    assert.ok(u.w.notes[0].values.note.indexOf('Garage only') > 0);
    // Every HTML surface still escapes: Review after the Send, and the step.
    assert.ok(html.indexOf('<dd>Don&#39;t &amp; &quot;quote&quot; &lt;b&gt;</dd>') > 0);
    assert.strictEqual(html.indexOf('Don\'t & "quote" <b>'), -1);
    html = getStep(t, 'plans');
    assert.ok(html.indexOf('>Don&#39;t &amp; &quot;quote&quot; &lt;b&gt;</textarea>') > 0);
    assert.strictEqual(html.indexOf('Don\'t & "quote" <b>'), -1);
});

test('A3. the state size guard: over 3,500 characters the files drop to the last 5 (DESIGNINFO_STATE_TRIMMED); fields written', function () {
    var t = setup();
    var big = { v: 1, sections: {}, answers: {}, noted: {}, pending: [], files: [] };
    var i;
    for (i = 0; i < 30; i++) {
        big.files.push({ qid: 'plans_files', id: String(1000 + i), name: Array(90).join('f'), at: '2026-10-02T10:00:00Z' });
        big.answers['extra_answer_' + i] = Array(30).join('a');
    }
    t.w.opps[20].custbody_cdb_designinfo_state = JSON.stringify(big);
    post(t, { step: 'plans', q_windows: 'Lots' });
    assert.strictEqual(logs(t.w, 'DESIGNINFO_STATE_TRIMMED').length, 1);
    assert.strictEqual(oppWrites(t.w)[0].values.custbody_elevations_window_sizes_2026, 'Lots', 'the fields still written');
    var st = state(t.w);
    assert.strictEqual(st.files.length, 5);
    assert.strictEqual(st.files[4].id, '1029', 'the newest kept');
});

test('A2. the fields are retried alone when the one write of the fields and the state fails', function () {
    var t = setup();
    t.w.submitThrows = function (o) { return o.values.hasOwnProperty('custbody_cdb_designinfo_state') &&
        Object.keys(o.values).length > 1; };
    post(t, { step: 'plans', q_windows: 'Lots' });
    var w = oppWrites(t.w);
    assert.deepStrictEqual(w.map(function (o) { return Object.keys(o.values).sort().join(','); }),
        ['custbody_elevations_window_sizes_2026', 'custbody_cdb_designinfo_state']);
    assert.strictEqual(logs(t.w, 'DESIGNINFO_WRITE_RETRY').length, 1);
    assert.strictEqual(logs(t.w, 'DESIGNINFO_WRITE_FAILED').length, 0);
});

// ---------------------------------------------------------------- amendment 2 §6: every key read is listed

/**
 * Loads a script with its config wrapped so every setting key it READS is recorded; returns the reads that are not
 * in that script's SCRIPT_KEYS (config.load would throw on a listed key that is missing, but an unlisted key just
 * reads as undefined — a silent bug).
 */
function unlistedReads(t, file, scriptId, drive) {
    var cache = {};
    var cfgMod = amd.load('lib/cdb_lib_config', t.s, cache);
    var orig = cfgMod.load;
    var reads = {};
    cfgMod.load = function (l, q) {
        var c = orig(l, q);
        return new Proxy(c, { get: function (target, k) {
            if (typeof k === 'string' && cfgMod.PARAMETERS.hasOwnProperty(k)) { reads[k] = true; }
            return target[k];
        } });
    };
    t.w.scriptId = scriptId;
    drive(amd.load(file, t.s, cache));
    return Object.keys(reads).filter(function (k) { return cfgMod.SCRIPT_KEYS[scriptId].indexOf(k) < 0; });
}

test('A2. every settings key a script reads is in its SCRIPT_KEYS list (dashboard, digest, User Event, Send Suitelet)', function () {
    var d = amd.load('lib/cdb_lib_dates');
    var t = setup();
    var sent = JSON.stringify({ v: 1, sent: '2026-10-02T10:00:00Z', sections: { plans: { saved: 'x', status: 'done' } } });
    t.w.opps[20].custbody_cdb_designinfo_state = sent;
    t.w.opps[20].custbody_next_contact = d.addDays(d.londonTodayKey(Date.now()), 2);
    assert.deepStrictEqual(unlistedReads(t, 'cdb_sl_dashboard', 'customscript_cdb_sl_dashboard', function (sl) {
        t.sl = sl;
        run(t, 'GET', { t: t.tok });
        t.w.opps[20].custbody_cdb_designinfo_state = '';
        run(t, 'GET', { t: t.tok });
        get(t);
        post(t, { send: '1', q_windows: 'Lots' }, { f_plans_files_1: part(t, 'a.pdf') });
    }), [], 'dashboard Suitelet');

    var u = setup();
    u.w.opps[20].custbody_cdb_designinfo_state = JSON.stringify({ v: 1, sections: { plans: { saved: 'x', status: 'done' } } });
    u.w.params = { custscript_cdb_digest_mode: 'TEST', custscript_cdb_digest_test_customers: '42', custscript_cdbmr_won_statuses: '13',
        custscript_cdbmr_lost_statuses: '14', custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500' };
    u.w.settings = u.w.settings.concat([{ id: '399', name: 'PE_VALUEPROPS', value: '2,3' }]);
    assert.deepStrictEqual(unlistedReads(u, 'cdb_mr_digest', 'customscript_cdb_mr_digest', function (mr) {
        var input = mr.getInputData();
        mr.map({ value: JSON.stringify(input[0]), write: function () {} });
    }), [], 'digest');
    assert.strictEqual(u.w.emails.length, 1);

    var v = setup();
    v.w.settings = [{ id: '1', name: 'WON_STATUSES', value: '13' }, { id: '2', name: 'NEEDINFO_SUBSTATUS', value: '1' },
        { id: '3', name: 'FC_MAP', value: SETTINGS.FC_MAP }];
    var buttons = [];
    assert.deepStrictEqual(unlistedReads(v, 'cdb_ue_opportunity', 'customscript_cdb_ue_opportunity', function (ue) {
        ue.beforeLoad({ type: 'view', UserEventType: { VIEW: 'view' }, request: { parameters: {} },
            newRecord: { id: '20', getValue: function (f) { return READY[f.fieldId] || ''; } },
            form: { addButton: function (b) { buttons.push(b); }, addPageInitMessage: function () {} } });
    }), [], 'opportunity User Event');
    assert.strictEqual(buttons.length, 1, 'with only its three keys');

    var x = setup();
    x.w.settings = x.w.settings.concat([{ id: '401', name: 'WON_STATUSES', value: '13' }, { id: '402', name: 'NEEDINFO_SUBSTATUS',
        value: '1' }, { id: '406', name: 'DESIGN_SUBSTATUS', value: '1,4,5,13' }, { id: '403', name: 'PE_VALUEPROPS', value: '2,3' },
        { id: '404', name: 'FALLBACK_EMPLOYEE', value: '500' }]);
    assert.deepStrictEqual(unlistedReads(x, 'cdb_sl_send_designinfo', 'customscript_cdb_sl_send_designinfo', function (sl) {
        ['GET', 'POST'].forEach(function (m) {
            sl.onRequest({ request: { method: m, parameters: m === 'POST' ? { custpage_opp: '20' } : { opp: '20' } },
                response: { writePage: function () {}, setHeader: function () {}, write: function () {} } });
        });
    }), [], 'Send design information Suitelet');
    assert.strictEqual(x.w.emails.length, 1);
});

// ---------------------------------------------------------------- amendment 3: the state field is a Text Area

test('A3. the state as a Text Area works in the extras search and the request lookup; as Long Text both fail (Production)', function () {
    var st = JSON.stringify({ v: 2, s: { plans: { at: '2026-10-02T14:02Z', st: 'done' } }, a: {}, f: [], req: '', sent: '', task: '' });
    // Text Area (the stub's default): the card reads the state; the request Suitelet's lookup reads it.
    var c = cards(JSON.parse(st));
    assert.ok(c.row.indexOf('Thanks, we have: Your plans.') > 0);
    assert.strictEqual(logs(c.t.w, 'OPP_EXTRAS_FAILED').length, 0);
    var r = request('POST');
    assert.strictEqual(r.w.emails.length, 1);
    // Long Text, as first created in Production: the lookup and the search both reject the column.
    var lt = request('POST', { world: function (w) { w.longTextFields = ['custbody_cdb_designinfo_state']; } });
    assert.strictEqual(lt.w.emails.length, 0);
    assert.ok(lt.form.fields[0].defaultValue.indexOf('An nlobjSearchColumn contains an invalid column') > 0);
    var t = setup();
    t.w.longTextFields = ['custbody_cdb_designinfo_state'];
    t.w.opps[20].custbody_opportunity_sub_status = '1';
    var html = run(t, 'GET', { t: t.tok });
    assert.strictEqual(logs(t.w, 'OPP_EXTRAS_FAILED').length, 1);
    assert.ok(html.indexOf('We need some information about your property') > 0, 'every card degrades to needs_info');
});

test('A3. card B comes from the stored section statuses; sent with no sections (migrated or trimmed) is card C', function () {
    var c = cards({ v: 2, s: { plans: { at: '2026-10-02T14:02Z', st: 'done' }, heating: { at: '2026-10-02T14:02Z', st: 'todo' } },
        a: {}, f: [], req: '', sent: '', task: '' });
    assert.ok(c.row.indexOf('Thanks, we have: Your plans. Still to do: How well insulated is it?, Heating and controls, Your heat ' +
        'pump.') > 0, c.row);
    assert.ok(c.digest.indexOf('Thanks, we have: Your plans. Still to do:') > 0);
    var d = cards({ v: 2, s: {}, a: {}, f: [], req: '', sent: '2026-10-02T14:10Z', task: '2026-10-02T14:10Z' });
    assert.ok(/Information received, [A-Z][a-z]{2} 2 Oct( 2026)?\. Pem is reviewing it/.test(d.row), d.row);
    assert.ok(d.digest.indexOf('Pem is reviewing it') > 0);
});

// ---------------------------------------------------------------- 2.4.0: the stepper (release 2.3b)

/** The step a URL names. */
function stepOf(u) {
    return query(u).step;
}

/** A POST that should redirect: returns the URL (the GET is not followed). */
function postNav(t, extra, files) {
    var p = { t: t.tok, a: 'designinfo', opp: '20' };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    assert.strictEqual(run(t, 'POST', p, files), '', 'no page: a redirect');
    assert.ok(t.redirect, 'redirected');
    return t.redirect;
}

test('2.4.0 routing: no step goes to the first step still to do, else Review; a valid step is shown', function () {
    var t = setup();
    assert.ok(get(t).indexOf('<input type="hidden" name="step" value="plans">') > 0, 'the first todo');
    assert.ok(getStep(t, 'heatpump').indexOf('<input type="hidden" name="step" value="heatpump">') > 0);
    assert.ok(getStep(t, 'review').indexOf('<h1>Review and send</h1>') > 0);
    // Nothing still to do: Review.
    var reg = [HEADER, 'project,Your project,main,w3w,text,what3words,,,note,N,,',
        'plans,Your plans,main,bigfiles,yesno,Big?,,,state,N,,'].join('\n') + '\n';
    var u = setup({ registry: reg });
    assert.ok(get(u).indexOf('<h1>Review and send</h1>') > 0, 'no todo step: Review');
    nothingWritten(t, 'GETs');
});

test('2.4.0 routing: a hidden or unknown &step= shows the first step and logs DESIGNINFO_STEP_UNKNOWN (debug)', function () {
    ['heatpump', 'zzz', '<b>'].forEach(function (step) {
        var t = setup();
        t.w.opps[20].custbody_mi_heat_source = '4'; // a boiler: no heat pump step
        var html = getStep(t, step);
        assert.ok(html.indexOf('<input type="hidden" name="step" value="project">') > 0, step);
        assert.strictEqual(html.indexOf('<b>'), -1, 'never echoed');
        var l = logs(t.w, 'DESIGNINFO_STEP_UNKNOWN');
        assert.strictEqual(l.length, 1, step);
        assert.strictEqual(l[0][0], 'debug');
    });
});

test('2.4.0 POST: nav=next, back, exit, stay, goto and the last step\'s next — saved first, then redirected', function () {
    var t = setup();
    var u;
    u = postNav(t, { step: 'plans', nav: 'next', q_plans_current: 'yes' });
    assert.strictEqual(stepOf(u), 'insulation');
    assert.ok(/&saved=1$/.test(u));
    assert.strictEqual(state(t.w).answers.plans_current, 'yes', 'saved before the redirect');
    assert.strictEqual(oppWrites(t.w).length, 1, 'one write');
    assert.strictEqual(t.w.notes.length, 1, 'one Note');
    u = postNav(t, { step: 'insulation', nav: 'back', q_year: '1990' });
    assert.strictEqual(stepOf(u), 'plans', 'back: the previous step');
    assert.ok(/&saved=1$/.test(u));
    assert.strictEqual(oppWrites(t.w).slice(-1)[0].values.custbody15, '1990', 'back saves first');
    u = postNav(t, { step: 'plans', goto: 'heatpump', q_unheated: 'Garage' });
    assert.strictEqual(stepOf(u), 'heatpump', 'the step bar saves first');
    assert.strictEqual(t.w.opps[20].custbody_unheated_areas, 'Garage');
    u = postNav(t, { step: 'plans', nav: 'exit', q_windows: 'Bifolds' });
    assert.strictEqual(u, 'https://acct.extforms.netsuite.com/sl?t=' + t.tok, 'exit: the dashboard');
    assert.strictEqual(t.w.opps[20].custbody_elevations_window_sizes_2026, 'Bifolds', 'exit saves first');
    assert.strictEqual(t.w.notes.length, 4);
    assert.strictEqual(t.w.tasks.length, 0, 'no Task without Send');
    // Where each one goes (nothing changed on these: 2.4.1 writes nothing for them).
    assert.strictEqual(stepOf(postNav(t, { step: 'project', nav: 'back' })), 'project', 'back on step 1: stays');
    assert.strictEqual(stepOf(postNav(t, { step: 'heating', nav: 'stay' })), 'heating');
    assert.strictEqual(stepOf(postNav(t, { step: 'heating' })), 'heating', 'no nav: stay');
    assert.strictEqual(stepOf(postNav(t, { step: 'plans', goto: 'review' })), 'review');
    assert.strictEqual(stepOf(postNav(t, { step: 'plans', goto: 'nonsense' })), 'plans', 'an unknown goto: stay');
    assert.strictEqual(stepOf(postNav(t, { step: 'other', nav: 'next' })), 'review', 'the last step\'s next: Review');
    assert.strictEqual(t.w.notes.length, 4, 'no Note for those');
});

test('2.4.1 a navigation with nothing changed writes nothing: next, back, exit, goto, more — no saved=1, one debug line', function () {
    [
        [{ nav: 'next' }, /&step=insulation$/],
        [{ nav: 'back' }, /&step=project$/],
        [{ nav: 'exit' }, /\?t=[^&]+$/],
        [{ goto: 'review' }, /&step=review$/],
        [{ more: 'plans_files', more_plans_files: '1' }, /&step=plans&more_plans_files=2$/]
    ].forEach(function (c) {
        var t = setup();
        var p = { step: 'plans', q_ceilings: 'All 2.4 m', q_windows: '', q_plans_current: '' };
        Object.keys(c[0]).forEach(function (k) { p[k] = c[0][k]; });
        var u = postNav(t, p);
        var why = JSON.stringify(c[0]);
        assert.ok(c[1].test(u), why + ' ' + u);
        assert.strictEqual(u.indexOf('saved=1'), -1, why + ': nothing was saved');
        nothingWritten(t, why);
        assert.strictEqual(t.w.opps[20].custbody_cdb_designinfo_state, '', why + ': no state write');
        var l = logs(t.w, 'DESIGNINFO_NO_CHANGE');
        assert.strictEqual(l.length, 1, why);
        assert.strictEqual(l[0][0], 'debug');
        assert.strictEqual(l[0][2], 'Opportunity 20: step plans, nothing changed; nothing written');
        assert.strictEqual(follow(t).indexOf('<div class="donep"'), -1, why + ': no Saved.');
    });
});

test('2.4.1 Send with nothing changed since the last save still writes the state, the Note and the Task', function () {
    var t = setup();
    postNav(t, { step: 'plans', nav: 'next', q_plans_current: 'yes' });
    var writes = oppWrites(t.w).length;
    post(t, { step: 'review', send: '1' });
    assert.strictEqual(oppWrites(t.w).length, writes + 1, 'the state (sent)');
    assert.ok(state(t.w).sent, 'sent');
    assert.strictEqual(t.w.notes.length, 2);
    assert.strictEqual(t.w.tasks.length, 1);
    assert.strictEqual(logs(t.w, 'DESIGNINFO_NO_CHANGE').length, 0);
});

test('2.4.1 the header: Review says Back to your projects; a step page keeps Save and exit', function () {
    var review = getStep(setup(), 'review');
    var head = review.slice(review.indexOf('<header'), review.indexOf('</header>'));
    assert.ok(head.indexOf('>Back to your projects</a>') > 0, head);
    assert.strictEqual(review.indexOf('Save and exit'), -1);
    var step = getStep(setup(), 'plans');
    head = step.slice(step.indexOf('<header'), step.indexOf('</header>'));
    assert.ok(head.indexOf('name="nav" value="exit">Save and exit</button>') > 0);
    assert.strictEqual(head.indexOf('Back to your projects'), -1);
});

test('2.4.0 Review: values, files by name, Yes/No, clipped at 200, "Given", chips, "Not answered yet" in todo steps only', function () {
    var t = setup({ settings: { DESIGNINFO_DRAWINGS_URL: 'https://example.com/drawings' } });
    post(t, { step: 'heatpump', nav: 'next', q_nb_which: 'Kitchen window' });
    post(t, { step: 'plans', nav: 'next', q_plans_current: 'no', q_unheated: Array(260).join('z') },
        { f_plans_files_1: part(t, 'Rev C.pdf') });
    var html = getStep(t, 'review');
    assert.ok(/<dt>New or extra files \(optional\)<\/dt><dd>QR20_plans_files_\d{8}-\d{4}_Rev_C\.pdf<\/dd>/.test(html), 'by name');
    assert.ok(html.indexOf('<dt>Are the plans we hold still the current ones?</dt><dd>No</dd>') > 0);
    assert.ok(html.indexOf('<dd>' + Array(200).join('z') + '…</dd>') > 0, 'clipped at 200');
    assert.ok(html.indexOf('<dt>Which window or door is it?</dt><dd>Given</dd>') > 0, 'a Note-only answer sent');
    assert.ok(html.indexOf('Your plans<span class="chip chip-done">Done</span>') > 0);
    assert.ok(html.indexOf('How well insulated is it?<span class="chip chip-todo">Still to do</span>') > 0);
    assert.ok(html.indexOf('Your project<span class="chip chip-checked">Checked</span>') > 0);
    // "Not answered yet" only in the steps still to do.
    var plans = html.slice(html.indexOf('id="rv-plans"'), html.indexOf('id="rv-insulation"'));
    var ins = html.slice(html.indexOf('id="rv-insulation"'), html.indexOf('id="rv-heating"'));
    assert.strictEqual(plans.indexOf('Not answered yet'), -1, 'a done step lists only its answers');
    assert.strictEqual(plans.indexOf('Windows and external doors'), -1);
    assert.ok(ins.indexOf('<dt>Age of the property, or year built</dt><dd class="muted" style="font-weight:400">Not answered ' +
        'yet</dd>') > 0);
    assert.ok(html.indexOf('<p class="muted" style="margin:0">Nothing added.</p>') > 0, 'the optional step, empty');
    // The edit links, the banner, the footer.
    assert.ok(html.indexOf('<a href="https://acct.extforms.netsuite.com/sl?t=' + t.tok + '&amp;a=designinfo&amp;opp=20&amp;' +
        'step=plans">Edit<span class="sr" style="position:absolute"> Your plans</span></a>') > 0);
    assert.ok(html.indexOf('<div class="amber" role="status"><p><strong>Nearly there. 3 steps still need you: How well insulated ' +
        'is it?, Heating and controls, Your heat pump.</strong></p>') > 0);
    assert.ok(html.indexOf('<span class="cap">Goes to</span><span class="amn">Pem Engineer</span>') > 0);
    assert.ok(html.indexOf('<input type="hidden" name="step" value="review"><div class="submitrow"><button type="submit" ' +
        'class="cta" name="send" value="1">Send to Pem</button><span class="meta">Sends what you’ve done so far</span>') > 0);
    assert.ok(html.indexOf('<a href="https://example.com/drawings" target="_blank" rel="noopener">') > 0, 'the drawings link');
    assert.strictEqual(getStep(t, 'plans').indexOf('example.com/drawings'), -1, 'on Review only');
});

test('2.4.0 Send from Review: today\'s Send — the Task, then Review with the confirmation (no redirect)', function () {
    var t = setup();
    var html = post(t, { step: 'review', send: '1' });
    assert.strictEqual(t.redirect, '', 'Send renders, it does not redirect');
    assert.strictEqual(t.w.tasks.length, 1);
    assert.strictEqual(t.w.notes.length, 1);
    assert.ok(t.w.notes[0].values.note.indexOf('Sent to PE: yes') > 0);
    assert.ok(html.indexOf('<div class="donep" role="status"><p>Sent to Pem Engineer.</p><p>Pem will read it all before your ' +
        'design call.</p></div>') > 0);
    assert.ok(html.indexOf('<h1>Review and send</h1>') > 0);
    assert.ok(state(t.w).sent, 'sent');
});

test('2.4.0 the file control: one input, "+ Add another file" up to the cap, a photo input; f_<qid>_2 and the photo save', function () {
    var t = setup();
    var html = getStep(t, 'plans');
    var block = html.slice(html.indexOf('id="q-plans_files"'), html.indexOf('id="q-bigfiles"'));
    assert.strictEqual((block.match(/<input class="fin" type="file"[^>]*name="f_plans_files_\d"[^>]*>/g) || []).filter(function (i) {
        return !/ hidden>$/.test(i);
    }).length, 1, 'one input shown');
    assert.strictEqual((block.match(/name="f_plans_files_[1-5]"/g) || []).length, 5, 'the rest hidden (revealed by script)');
    assert.ok(block.indexOf('<button type="submit" class="out addf" name="more" value="plans_files" data-qid="plans_files">+ Add ' +
        'another file</button>') > 0);
    assert.ok(block.indexOf('<input class="sr" type="file" id="di-plans_files-photo" name="f_plans_files_6" accept="image/*" ' +
        'capture="environment">') > 0, 'Take a photo: the last slot');
    assert.ok(block.indexOf('>Take a photo</label>') > 0);
    // Without JavaScript: "+ Add another file" saves, then shows one more input.
    var u = postNav(t, { step: 'plans', more: 'plans_files', more_plans_files: '1' });
    assert.ok(/&step=plans&more_plans_files=2$/.test(u), u); // 2.4.1: nothing changed, no saved=1
    assert.ok(/&more_plans_files=5$/.test(postNav(t, { step: 'plans', more: 'plans_files', more_plans_files: '4' })));
    assert.ok(/&more_plans_files=5$/.test(postNav(t, { step: 'plans', more: 'plans_files', more_plans_files: '5' })), 'capped');
    assert.ok(/&more_plans_files=5$/.test(postNav(t, { step: 'plans', more: 'plans_files', more_plans_files: '99' })), 'capped');
    assert.ok(!/more_/.test(postNav(t, { step: 'plans', more: 'heat_boiler' })), 'not a files question on this step: ignored');
    html = run(t, 'GET', query(t.redirect.replace(/&step=plans/, '&step=plans&more_plans_files=3')));
    block = html.slice(html.indexOf('id="q-plans_files"'), html.indexOf('id="q-bigfiles"'));
    assert.strictEqual((block.match(/name="f_plans_files_\d"[^>]*>/g) || []).filter(function (i) {
        return !/ hidden>$/.test(i) && !/capture/.test(i);
    }).length, 3);
    html = run(t, 'GET', { t: t.tok, a: 'designinfo', opp: '20', step: 'plans', more_plans_files: '5' });
    block = html.slice(html.indexOf('id="q-plans_files"'), html.indexOf('id="q-bigfiles"'));
    assert.strictEqual(block.indexOf('+ Add another file'), -1, 'at the cap: no button');
    // A file in the second input, and one from the camera, save.
    var v = setup();
    postNav(v, { step: 'plans', nav: 'next' }, { f_plans_files_2: part(v, 'b.pdf'), f_plans_files_6: part(v, 'IMG_0001.jpg') });
    assert.deepStrictEqual(v.w.savedFiles.map(function (f) { return f.name.replace(/^.*_\d{8}-\d{4}_/, ''); }),
        ['b.pdf', 'IMG_0001.jpg']);
    assert.strictEqual(state(v.w).files.length, 2);
});

test('2.4.0 phone: the stepper CSS at max-width 600px — titles hidden, full-width buttons, the photo input shown', function () {
    var html = getStep(setup(), 'plans');
    var css = html.slice(html.indexOf('@media (max-width:600px){'));
    css = css.slice(0, css.indexOf('}}') + 2);
    ['.sbar li{min-width:0}', '.sbar li .stitle{display:none}', '.scurt{display:block', '.navrow{flex-direction:column', '.fphoto{display:flex}']
        .forEach(function (rule) { assert.ok(css.indexOf(rule) > 0, rule); });
    assert.ok(html.indexOf('.fphoto{display:none}') > 0, 'no photo input on a desktop');
    assert.ok(html.indexOf('<meta name="viewport" content="width=device-width, initial-scale=1">') > 0);
});

test('2.4.0 Enter in a text box continues: the form\'s first submit button is a hidden nav=next', function () {
    var html = getStep(setup(), 'plans');
    var first = html.match(/<button type="submit"[^>]*form="diform"[^>]*>|<button type="submit"[^>]*>/)[0];
    assert.ok(/name="nav" value="next"/.test(first), first);
});

test('2.4.0 old qids in the state are ignored, logged once per request (DESIGNINFO_STATE_QID_UNKNOWN)', function () {
    var t = setup();
    t.w.opps[20].custbody_cdb_designinfo_state = JSON.stringify({ v: 2, s: {}, a: { mcs_reflect: '1', plans_current: 'yes' },
        n: ['mcs_position'], f: [] });
    var html = getStep(t, 'plans');
    assert.ok(/name="q_plans_current" value="yes" checked/.test(html), 'a known answer still reads');
    var l = logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN');
    assert.strictEqual(l.length, 1);
    assert.ok(l[0][2].indexOf('mcs_reflect') > 0 && l[0][2].indexOf('mcs_position') > 0, l[0][2]);
    postNav(t, { step: 'plans', nav: 'next', q_unheated: 'Garage' });
    assert.strictEqual(logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN').length, 2, 'once for the GET, once for the POST');
    assert.strictEqual(t.w.notes[0].values.note.indexOf('mcs_'), -1, 'never in the Note');
});

test('2.4.0 the Note and the Task: "Sections saved" names the step; the snapshot follows step order; "Still missing" the titles', function () {
    var t = setup();
    postNav(t, { step: 'heating', nav: 'next', q_manifolds: 'Utility' });
    assert.ok(t.w.notes[0].values.note.indexOf('Sections saved: Heating and controls\n') === 0);
    post(t, { step: 'review', send: '1' });
    var msg = t.w.tasks[0].values.message;
    var order = ['Your project (', 'Your plans (', 'How well insulated is it? (', 'Heating and controls (', 'Your heat pump (',
        'Anything else for your Project Engineer? ('].map(function (x) { return msg.indexOf('\n' + x); });
    order.forEach(function (i) { assert.ok(i > 0); });
    assert.deepStrictEqual(order.slice().sort(function (a, b) { return a - b; }), order, 'step order');
    assert.ok(msg.indexOf('Still missing: Your plans, How well insulated is it?, Heating and controls, Your heat pump.') > 0, msg);
});
