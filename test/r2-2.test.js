'use strict';
/**
 * Release 2.2: the project name, "Add a new address…", and the polish. Grouped as the brief's test
 * list. The Online-quote library is stubbed as in r2-1 (lib 1.2.0); the title and the address writes are
 * the dashboard's own, against the in-memory NetSuite (test/helpers/netsuite.js).
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');
var fx = require('./helpers/fixtures');
var capture = require('./helpers/booking-capture').capture;

var LIB_PATH = '/SuiteScripts/NuHeat/2026 Quote/nuheat_opp_update_lib';
var STAGES = [{ id: '', text: '' }, { id: '2', text: 'Foundations' }, { id: '4', text: 'Roof on' }];
var FIELD_IDS = { build_stage: 'custbody_build_stage', del_date: 'custbody_opp_del_date', entitystatus: 'entitystatus' };

/** The library's part-A behaviour, as far as the update path uses it. Calls go to w.calls in order. */
function libStub(w) {
    function key(k) {
        return Object.keys(FIELD_IDS).filter(function (x) { return x === k || FIELD_IDS[x] === k; })[0];
    }
    return {
        LIB_VERSION: '1.2.0',
        fieldOptions: function () { return STAGES.slice(); },
        writeOppUpdate: function (o) {
            var out = { written: {}, unchanged: [] };
            w.calls.push(['writeOppUpdate', o]);
            if (w.oppWriteThrows) {
                var e = new Error('OPPLIB_WRITE_FAILED: submitFields refused');
                e.name = 'OPPLIB_WRITE_FAILED';
                throw e;
            }
            Object.keys(o.values).forEach(function (k) {
                var f = FIELD_IDS[key(k)];
                out.written[key(k)] = { old: String(w.opps[o.oppId][f] || ''), new: String(o.values[k]) };
                w.opps[o.oppId][f] = String(o.values[k]);
            });
            return out;
        },
        createObjections: function () { return { created: ['9001'], failed: [], errors: {} }; }
    };
}

/** The dashboard with open quote 5 ("New build", QR5) of customer 42, the library and the settings. */
function setup() {
    var w = ns.world();
    var s;
    w.calls = [];
    w.opps[5] = { entity: '42', title: 'New build', tranid: 'QR5', entitystatus: '10', custbody_opportunity_sub_status: '',
        salesrep: '88', custbody_pe: '', custbody_value_proposition: '1', custbody_opp_site_adress: 'Plot 4\nVillage',
        custbody_build_stage: '2', custbody_build_stage_text: '2 - Foundations', custbody_opp_del_date: '2027-01-15' };
    w.customers[42].stage = 'CUSTOMER';
    w.lists.customrecord_nh_objection_type = { 21: 'Price' };
    w.settings = [{ id: '100', name: 'UPD_BUILD_STAGES', value: '4,2' }, { id: '101', name: 'UPD_OBJECTION_TYPES', value: '21' },
        { id: '102', name: 'UPD_LOST_STATUS_MAP', value: '{"CUSTOMER": "14"}' }];
    // The amount to pay (2.0.5's system balances), so the confirmation shows one.
    w.orders[100].custbodycustbody_sys_bal_incvat = '1200';
    w.orders[100].custbody_sys_bal_exvat = '1000';
    s = ns.stubs(w);
    s.modules = {};
    s.modules[LIB_PATH] = libStub(w);
    var submit = s['N/record'].submitFields;
    s['N/record'].submitFields = function (o) {
        w.calls.push(['submitFields', o]);
        return submit(o);
    };
    var create = s['N/record'].create;
    s['N/record'].create = function (c) {
        w.calls.push(['task']);
        return create(c);
    };
    return { w: w, s: s, sl: amd.load('cdb_sl_dashboard', s), tok: amd.load('lib/cdb_lib_token', s).sign(42, 0),
        data: amd.load('lib/cdb_lib_data', s), render: amd.load('lib/cdb_lib_render', s) };
}

function run(sl, method, params) {
    var out = { html: '' };
    sl.onRequest({
        request: { method: method, parameters: params },
        response: { setHeader: function () {}, write: function (o) { out.html += o.output; } }
    });
    return out.html;
}

function logs(w, key) {
    return w.logs.filter(function (l) { return l[1] === 'CDB ' + key; });
}

function update(s, extra) {
    var p = { t: s.tok, a: 'update', opp: '5', mode: 'update' };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return run(s.sl, 'POST', p);
}

function names(w) {
    return w.calls.map(function (c) { return c[0]; });
}

function titleWrites(w) {
    return w.submits.filter(function (o) { return o.type === 'opportunity' && o.values.hasOwnProperty('title'); });
}

function today() {
    var d = amd.load('lib/cdb_lib_dates');
    return d.londonTodayKey(Date.now());
}

function book(s, extra) {
    var d = amd.load('lib/cdb_lib_dates');
    var p = { t: s.tok, a: 'delivery', so: '100', date: d.firstAllowedDate(today(), 3, {}), time: '5', address: 'new',
        vehicle: '2', unload: '3', contactName: 'Sam Site', contactPhone: '07700 900000', contactEmail: 'sam@example.com',
        requests: 'Ring first', payment: 'BACS', addr1: '12 New Street', addr2: '', city: 'Newtown', county: 'Kent',
        zip: 'me14  1xx' };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return run(s.sl, 'POST', p);
}

function nothingWritten(s, why) {
    assert.strictEqual(s.w.saves.length, 0, why + ': no order save');
    assert.strictEqual((s.w.customerSaves || []).length, 0, why + ': no customer save');
    assert.strictEqual(s.w.submits.length, 0, why + ': no submitFields');
    assert.strictEqual(s.w.tasks.length, 0, why + ': no Task');
}

// ---------------------------------------------------------------- 1 the project name

test('name: the update page asks first, prefilled with the title, maxlength 60, with the hint', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
    // 2.2.1 (PR #8 amendment 1): "Your project details", the reference first.
    var q = html.indexOf('<span class="num">1</span>Your project details</h2>');
    assert.ok(q > 0, 'the first question');
    assert.ok(q < html.indexOf('What stage is your project at?'), 'before the stage');
    assert.ok(html.indexOf('<label class="lbl" for="f-projectName">Your reference</label>' +
        '<input class="inp" type="text" id="f-projectName" name="projectName" value="New build" maxlength="60">') > 0, html);
    assert.ok(html.indexOf('A name that makes this project easy for you to spot, e.g. ‘Barn conversion’.') > 0);
});

test('name: a changed title writes { title } only — one submitFields, after the library, no sourcing', function () {
    var s = setup();
    var html = update(s, { projectName: '  Barn conversion ', buildStage: '4' });
    var w = s.w;
    assert.deepStrictEqual(names(w), ['writeOppUpdate', 'submitFields', 'task'], 'the library first, then the title');
    assert.deepStrictEqual(w.submits, [{ type: 'opportunity', id: '5', values: { title: 'Barn conversion' },
        options: { enableSourcing: false, ignoreMandatoryFields: true } }]);
    assert.ok(!w.calls[0][1].values.hasOwnProperty('title'), 'never through the library');
    assert.ok(html.indexOf('Your reference: <strong>Barn conversion</strong>') > 0, 'the confirmation lists it');
    // The name alone: no library call at all.
    s = setup();
    update(s, { projectName: 'Barn conversion' });
    assert.deepStrictEqual(names(s.w), ['submitFields', 'task']);
    assert.strictEqual(titleWrites(s.w).length, 1);
});

test('name: blank or unchanged writes nothing; control characters are stripped', function () {
    var s = setup();
    var html = update(s, { projectName: '   ' });
    assert.ok(html.indexOf('Nothing to update') > 0, 'blank never clears, and alone is nothing');
    assert.strictEqual(s.w.submits.length + s.w.tasks.length, 0);
    s = setup();
    update(s, { projectName: ' New build ', note: 'Hello' });
    assert.strictEqual(titleWrites(s.w).length, 0, 'unchanged');
    assert.ok(s.w.tasks[0].values.message.indexOf('No changes to the opportunity.') > 0);
    s = setup();
    update(s, { projectName: 'Barn\tconversion\u0007\n' });
    assert.strictEqual(titleWrites(s.w)[0].values.title, 'Barn conversion');
    assert.strictEqual(s.data.cleanLine('a\u0000b\u009fc\r\n'), 'a b c');
});

test('name: 61 characters is an error and nothing is written', function () {
    var s = setup();
    var long = new Array(62).join('x');
    var html;
    assert.strictEqual(long.length, 61);
    html = update(s, { projectName: long, buildStage: '4', note: 'x' });
    assert.ok(html.indexOf('<p class="err" id="err-projectName" role="alert">Please keep this under 60 characters.</p>') > 0, html);
    assert.ok(html.indexOf('aria-describedby="err-projectName"') > 0);
    assert.strictEqual(s.w.calls.length, 0, 'no library write, no title, no Task');
    assert.strictEqual(s.w.submits.length, 0);
    s = setup();
    update(s, { projectName: long.slice(1) });
    assert.strictEqual(titleWrites(s.w).length, 1, '60 is allowed');
});

test('name: a failed title write says "Project details NOT saved" in the Task, apart from the stage', function () {
    var s = setup();
    s.w.submitThrows = function (o) { return o.values.hasOwnProperty('title'); };
    var html = update(s, { projectName: 'Barn conversion', buildStage: '4' });
    var msg = s.w.tasks[0].values.message;
    assert.ok(msg.indexOf('Saved on the opportunity (old → new):\n- Project stage: Foundations → Roof on') > 0, msg);
    assert.ok(msg.indexOf('Project details NOT saved: USER_ERROR: submitFields refused. Please update them by hand (old → new):\n' +
        '- Your reference: New build → Barn conversion') > 0, msg);
    assert.strictEqual(logs(s.w, 'OPP_NAME_FAILED')[0][0], 'error');
    assert.ok(html.indexOf('passed your update on') > 0);
    // And the other way round: the library fails, the name is saved; each reported on its own.
    s = setup();
    s.w.oppWriteThrows = true;
    update(s, { projectName: 'Barn conversion', buildStage: '4' });
    msg = s.w.tasks[0].values.message;
    assert.ok(msg.indexOf('NOT saved on the opportunity (OPPLIB_WRITE_FAILED: submitFields refused). Please update it by hand ' +
        '(old → new):\n- Project stage: Foundations → Roof on\n\nSaved on the opportunity (old → new):\n' +
        '- Your reference: New build → Barn conversion') > 0, msg);
    assert.strictEqual(titleWrites(s.w).length, 1);
});

test('name: the Task shows old → new, and CDB OPP_UPDATED includes it', function () {
    var s = setup();
    update(s, { projectName: 'Barn conversion', buildStage: '4' });
    var msg = s.w.tasks[0].values.message;
    assert.ok(msg.indexOf('Saved on the opportunity (old → new):\n- Your reference: New build → Barn conversion\n' +
        '- Project stage: Foundations → Roof on') > 0, msg);
    assert.ok(logs(s.w, 'OPP_UPDATED')[0][2].indexOf('Your reference New build -> Barn conversion; Project stage Foundations -> Roof on') > 0,
        logs(s.w, 'OPP_UPDATED')[0][2]);
    assert.ok(/ \| details written: title$/.test(logs(s.w, 'OPP_UPDATED')[0][2]));
});

test('name: escaped on the confirmation, in the Task, on the update page and on the dashboard', function () {
    var s = setup();
    var name = '<b>Tom & Jerry\'s</b>';
    var html = update(s, { projectName: name });
    var esc = '&lt;b&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;';
    assert.strictEqual(titleWrites(s.w)[0].values.title, name, 'stored as typed');
    assert.ok(html.indexOf('Your reference: <strong>' + esc + '</strong>') > 0, 'confirmation');
    assert.strictEqual(html.indexOf('<b>Tom'), -1);
    assert.ok(s.w.tasks[0].values.message.indexOf('- Your reference: New build → ' + esc) > 0, 'Task');
    html = run(s.sl, 'GET', { t: s.tok });
    assert.ok(html.indexOf('<span class="name">' + esc + '</span>') > 0, 'dashboard');
    assert.strictEqual(html.indexOf('<b>Tom'), -1);
    html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
    assert.ok(html.indexOf('name="projectName" value="' + esc + '"') > 0, 'update page');
});

test('name: writeProjectDetails refuses rather than writes a bad value (fail closed)', function () {
    var s = setup();
    // 2.2.1: writeProjectName() became writeProjectDetails(oppId, { title, siteAddress }).
    assert.throws(function () { s.data.writeProjectDetails('5', { title: '  ' }); }, /CDB_BAD_PROJECT_DETAILS/);
    assert.throws(function () { s.data.writeProjectDetails('5', { title: new Array(62).join('x') }); }, /CDB_BAD_PROJECT_DETAILS/);
    assert.throws(function () { s.data.writeProjectDetails('5 OR 1', { title: 'x' }); }, /CDB_BAD_PROJECT_DETAILS/);
    assert.throws(function () { s.data.writeProjectDetails('5', {}); }, /CDB_BAD_PROJECT_DETAILS: opportunity "5": nothing to write/);
    assert.throws(function () { s.data.writeProjectDetails('5', { title: 'Fine', siteAddress: ' ' }); }, /CDB_BAD_PROJECT_DETAILS/,
        'one bad value refuses the whole write');
    assert.throws(function () { s.data.writeProjectDetails('5', { siteAddress: new Array(302).join('x') }); },
        /CDB_BAD_PROJECT_DETAILS/);
    assert.strictEqual(s.w.submits.length, 0);
    assert.deepStrictEqual(s.data.writeProjectDetails('5', { title: 'Fine', siteAddress: 'Plot 4, Village', entitystatus: '14' }),
        { title: 'Fine', custbody_opp_site_adress: 'Plot 4, Village' }, 'only these two fields, ever');
    assert.deepStrictEqual(Object.keys(s.w.submits[0].values), ['title', 'custbody_opp_site_adress']);
});

// ---------------------------------------------------------------- 2 a new delivery address

test('address: the dropdown lists the address book, then "Add a new address…"; five plain inputs', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('<option value="900">1 Home Rd, Town</option><option value="901" selected>Plot 2, Village</option>' +
        '<option value="new">Add a new address…</option></select>') > 0, html);
    [['addr1', 'address-line1', '100'], ['addr2', 'address-line2', '100'], ['city', 'address-level2', '60'],
        ['county', 'address-level1', '60'], ['zip', 'postal-code', '10']].forEach(function (f) {
        assert.ok(html.indexOf('<input class="inp" type="text" id="' + f[0] + '" name="' + f[0] + '" value="" maxlength="' + f[2] +
            '" autocomplete="' + f[1] + '">') > 0, f[0]);
    });
    assert.ok(html.indexOf('<div class="newaddr" id="newaddr"><p class="hint newaddr-nojs" style="margin:0">Only if you chose ' +
        '‘Add a new address’</p>') > 0, 'shown without script, with the hint');
    assert.ok(html.indexOf('.js .newaddr{display:none}.js .newaddr.on{display:flex}.js .newaddr-nojs{display:none}') > 0,
        'with script: hidden until chosen');
    assert.ok(html.indexOf('el.required=on') > 0, 'the script makes them required only while chosen');
    // No address book at all: the new address is the only choice.
    s.w.addressBooks = { 42: [] };
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(/<select class="inp" id="f-address" name="address" required><option value="new">Add a new address…<\/option><\/select>/
        .test(html));
});

test('address: every validation failure writes nothing', function () {
    var cases = [
        [{ addr1: '' }, 'addr1', 'Please give the first line of the address.'],
        [{ city: ' ' }, 'city', 'Please give the town or city.'],
        [{ zip: '' }, 'zip', 'Please give the postcode.'],
        [{ zip: 'ABC 123' }, 'zip', 'Please check the postcode, for example SW1A 1AA.'],
        [{ zip: 'SW1A 1AAA' }, 'zip', 'Please check the postcode, for example SW1A 1AA.'],
        [{ addr1: new Array(102).join('a') }, 'addr1', 'Please keep this under 100 characters.'],
        [{ addr2: new Array(102).join('a') }, 'addr2', 'Please keep this under 100 characters.'],
        [{ city: new Array(62).join('a') }, 'city', 'Please keep this under 60 characters.'],
        [{ county: new Array(62).join('a') }, 'county', 'Please keep this under 60 characters.']
    ];
    cases.forEach(function (c) {
        var s = setup();
        var html = book(s, c[0]);
        assert.ok(html.indexOf('<p class="err" id="err-' + c[1] + '" role="alert">' + c[2] + '</p>') > 0, c[1] + ': ' + c[2]);
        assert.ok(html.indexOf('<div class="newaddr on" id="newaddr">') > 0, 'the fields stay open');
        assert.ok(html.indexOf('<option value="new" selected>') > 0);
        nothingWritten(s, JSON.stringify(c[0]));
        assert.strictEqual(s.w.addressBooks[42].length, 2);
    });
    // At the limits: accepted.
    var s = setup();
    book(s, { addr1: new Array(101).join('a'), addr2: new Array(101).join('b'), city: new Array(61).join('c'),
        county: new Array(61).join('d') });
    assert.strictEqual(s.w.saves.length, 1);
});

test('address: the new fields are ignored unless "Add a new address…" was posted', function () {
    var s = setup();
    book(s, { address: '900', addr1: '', zip: 'nonsense', city: new Array(70).join('x') });
    assert.strictEqual(s.w.saves.length, 1);
    assert.strictEqual(s.w.saves[0].values.shipaddresslist, '900');
    assert.strictEqual((s.w.customerSaves || []).length, 0);
    assert.strictEqual(s.w.submits.length, 0);
    assert.strictEqual(s.w.tasks[0].values.title.indexOf('NEW ADDRESS'), -1);
});

test('address: postcodes — tolerant in, upper case with one space out', function () {
    var data = setup().data;
    [['sw1a1aa', 'SW1A 1AA'], [' m1  1ae ', 'M1 1AE'], ['B33 8TH', 'B33 8TH'], ['cr2 6xh', 'CR2 6XH'],
        ['dn551pt', 'DN55 1PT'], ['W1A 0AX', 'W1A 0AX'], ['EC1A 1BB', 'EC1A 1BB'], ['gir 0aa', 'GIR 0AA']]
        .forEach(function (c) { assert.strictEqual(data.normalisePostcode(c[0]), c[1], c[0]); });
    ['', 'ABC', '12345', 'SW1A', 'SW1A 1A', 'Q1A 1AA1', 'SW1A-1AA'].forEach(function (z) {
        assert.strictEqual(data.normalisePostcode(z), '', z);
    });
});

test('address: a valid new address is added (labelled, neither default), set as ship-to, kept on the opportunity', function () {
    var s = setup();
    var html = book(s);
    var w = s.w;
    var line = w.addressBooks[42][2];
    var label = 'Added by customer (dashboard) ' + s.data.slashDate(today());
    var task = w.tasks[0].values;
    assert.strictEqual(w.addressBooks[42].length, 3, 'one line added');
    assert.strictEqual(line.label, label);
    assert.strictEqual(line.defaultshipping, false);
    assert.strictEqual(line.defaultbilling, false);
    assert.deepStrictEqual(line.addr, { country: 'GB', addr1: '12 New Street', city: 'Newtown', zip: 'ME14 1XX', state: 'Kent' });
    assert.deepStrictEqual(w.customerSaves.map(function (c) { return c.opts; }), [{ ignoreMandatoryFields: true }]);
    assert.strictEqual(w.saves.length, 1);
    assert.strictEqual(w.saves[0].values.shipaddresslist, line.id, 'shipaddresslist is the new line');
    assert.deepStrictEqual(w.submits, [{ type: 'opportunity', id: '4', values: {
        custbody_cdb_delivery_address: '12 New Street\nNewtown\nKent\nME14 1XX' },
        options: { enableSourcing: false, ignoreMandatoryFields: true } }], 'the one opportunity write');
    assert.strictEqual(task.title, 'NEW ADDRESS – Delivery requested: SO100 · Underfloor heating system');
    assert.strictEqual(task.message.indexOf('The customer gave a new delivery address. It has been added to their address book ' +
        '(labelled \'Added by customer (dashboard)\') and set as this order\'s ship-to address. Check access, the vehicle and ' +
        'any delivery charge, correct the address if needed, then confirm the date.\n\nNew delivery address:\n12 New Street\n' +
        'Newtown\nKent\nME14 1XX\n\nAddress book: added as address ' + line.id + ', labelled "' + label + '", neither default ' +
        'shipping nor default billing.\nShip-to address: set to address ' + line.id + '.\nOpportunity: the address is saved in ' +
        '"Customer-added delivery address" (custbody_cdb_delivery_address).\n\nThe customer requested a delivery'), 0, task.message);
    assert.ok(task.message.indexOf('- Delivery address: 901 → 12 New Street, Newtown, Kent, ME14 1XX') > 0, task.message);
    assert.ok(html.indexOf('<p>As this is a new address, we’ll check access and any delivery charge before we confirm your ' +
        'date.</p>') > 0, 'the confirmation sentence');
    assert.ok(html.indexOf('<span>Amount to pay</span><span>£1,200.00 inc VAT (£1,000.00 ex VAT)</span></div><p class="hint" ' +
        'style="margin:8px 0 0">This may change if delivery to the new address costs more. We’ll tell you before you pay.</p>') > 0,
    'the amount, with its note');
    assert.ok(logs(w, 'ADDRESS_ADDED')[0][2].indexOf('Customer 42: address ' + line.id + ' added to the address book') === 0);
    assert.ok(/county in state$/.test(logs(w, 'ADDRESS_ADDED')[0][2]));
    assert.strictEqual(logs(w, 'OPP_ADDRESS_SAVED').length, 1);
    // Next time, it is in the dropdown (the order made bookable again; it is now the order's ship-to).
    w.orders[100].custbody_cust_pay_intent = '';
    html = run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
    assert.ok(html.indexOf('<option value="' + line.id + '" selected>12 New Street, Newtown, Kent, ME14 1XX</option>' +
        '<option value="new">Add a new address…</option>') > 0);
});

test('address: card payment shows the note with the amount; add to account has no amount and no note', function () {
    var s = setup();
    var html = book(s, { payment: 'CARD' });
    assert.ok(html.indexOf('We’ll call you to take <strong>£1,200.00 inc VAT (£1,000.00 ex VAT)</strong>') > 0);
    assert.ok(html.indexOf('This may change if delivery to the new address costs more.') > 0);
    assert.ok(html.indexOf('As this is a new address') > 0);
    s = setup();
    s.w.paramOverrides = { custscript_cdb_pay_account: '3' };
    html = s.render.confirmation({ am: {}, payment: 'ACCOUNT', bank: {}, tranId: 'SO1', backUrl: 'https://x', newAddress: true,
        amount: { incVat: 10, exVat: 8 } });
    assert.ok(html.indexOf('As this is a new address') > 0);
    assert.strictEqual(html.indexOf('This may change'), -1);
});

test('address: an address-book booking shows neither the sentence nor the note, and has no prefix', function () {
    var s = setup();
    var html = book(s, { address: '900' });
    assert.strictEqual(html.indexOf('As this is a new address'), -1);
    assert.strictEqual(html.indexOf('This may change'), -1);
    assert.ok(html.indexOf('£1,200.00 inc VAT') > 0, 'the amount as today');
    assert.strictEqual(s.w.tasks[0].values.title, 'Delivery requested: SO100 · Underfloor heating system');
    assert.strictEqual(s.w.tasks[0].values.message.indexOf('The customer requested a delivery'), 0);
});

test('address: the same line 1 and postcode (other case, spacing, punctuation) reuses the line; none added', function () {
    var s = setup();
    book(s, { addr1: '  1, HOME rd. ', city: 'Elsewhere', county: '', zip: 'tn11aa' });
    var w = s.w;
    assert.strictEqual(w.addressBooks[42].length, 2, 'no line added');
    assert.strictEqual((w.customerSaves || []).length, 0, 'the customer is not saved');
    assert.strictEqual(w.saves[0].values.shipaddresslist, '900');
    assert.ok(/address book line 900 \("Home"\)/.test(logs(w, 'ADDRESS_MATCHED')[0][2]));
    assert.strictEqual(logs(w, 'ADDRESS_ADDED').length, 0);
    assert.strictEqual(w.tasks[0].values.title.indexOf('NEW ADDRESS – '), 0, 'the prefix, matched or not');
    assert.ok(w.tasks[0].values.message.indexOf('Address book: matches the existing line "Home" (address 900) on line 1 and ' +
        'postcode, so no line was added.\nShip-to address: set to address 900.') > 0);
    assert.ok(w.tasks[0].values.message.indexOf('- Delivery address: 901 → 1 Home Rd, Town') > 0, 'the line as the book has it');
    assert.strictEqual(w.submits[0].values.custbody_cdb_delivery_address, '1, HOME rd.\nElsewhere\nTN1 1AA', 'as the customer typed it');
    var data = s.data;
    assert.strictEqual(data.matchAddress([{ id: '1', addr1: '', zip: '' }], { addr1: '', zip: '' }), null, 'blank never matches');
    assert.strictEqual(data.matchAddress([{ id: '1', addr1: '1 Home Rd', zip: 'TN1 1AB' }], { addr1: '1 Home Rd', zip: 'TN1 1AA' }),
        null, 'another postcode');
});

test('address: a failed address-book save — the booking still saves, ship-to unchanged, the Task says NOT added', function () {
    var s = setup();
    s.w.customerSaveThrows = true;
    var html = book(s);
    var w = s.w;
    assert.strictEqual(w.saves.length, 1, 'the booking saved');
    assert.ok(!w.saves[0].values.hasOwnProperty('shipaddresslist'), 'ship-to not written');
    assert.strictEqual(w.orders[100].shipaddresslist, '901', 'ship-to unchanged');
    assert.strictEqual(w.addressBooks[42].length, 2);
    assert.ok(w.tasks[0].values.message.indexOf('New address NOT added to the address book (USER_ERROR: a script on the ' +
        'customer refused the save). Add it and set it as the ship-to address by hand.') > 0, w.tasks[0].values.message);
    assert.ok(w.tasks[0].values.message.indexOf('Ship-to address: NOT changed.') > 0);
    assert.strictEqual(w.tasks[0].values.message.indexOf('- Delivery address:'), -1);
    assert.strictEqual(logs(w, 'ADDRESS_ADD_FAILED')[0][0], 'error');
    assert.strictEqual(w.submits.length, 1, 'the opportunity still keeps the address');
    assert.ok(html.indexOf('Delivery requested</h1>') > 0 && html.indexOf('As this is a new address') > 0, 'the same confirmation');
});

test('address: the opportunity field missing (or its write failing) never stops the booking; the Task says so', function () {
    var s = setup();
    s.w.missingOppFields = ['custbody_cdb_delivery_address'];
    book(s);
    assert.strictEqual(s.w.saves.length, 1);
    assert.strictEqual(s.w.submits.length, 0);
    assert.ok(s.w.tasks[0].values.message.indexOf('Opportunity NOT updated: the field custbody_cdb_delivery_address is not on ' +
        'the opportunity.') > 0);
    assert.ok(logs(s.w, 'FIELD_MISSING').some(function (l) { return /custbody_cdb_delivery_address/.test(l[2]); }));
    s = setup();
    s.w.submitThrows = function () { return true; };
    book(s);
    assert.strictEqual(s.w.saves.length, 1);
    assert.ok(s.w.tasks[0].values.message.indexOf('Opportunity NOT updated (USER_ERROR: submitFields refused).') > 0);
    assert.strictEqual(logs(s.w, 'OPP_ADDRESS_FAILED')[0][0], 'error');
});

test('address: the county goes in state when it is a text field, else dispstate, else not at all (and the Task says)', function () {
    var s = setup();
    s.w.stateField = { id: 'state', type: 'select' };
    s.w.dispstateField = { id: 'dispstate', type: 'text' };
    book(s);
    assert.strictEqual(s.w.addressBooks[42][2].addr.dispstate, 'Kent');
    assert.ok(!s.w.addressBooks[42][2].addr.hasOwnProperty('state'));
    assert.ok(/county in dispstate$/.test(logs(s.w, 'ADDRESS_ADDED')[0][2]));
    s = setup();
    s.w.stateField = null;
    book(s);
    assert.ok(s.w.tasks[0].values.message.indexOf('County NOT saved on the address (the address form has no text county field ' +
        '(state or dispstate)). Add it by hand.') > 0);
    assert.strictEqual(s.w.saves[0].values.shipaddresslist, s.w.addressBooks[42][2].id, 'the address still used');
    s = setup();
    s.w.addressSetThrows = 'state';
    book(s);
    assert.ok(/County NOT saved on the address \(state refused it: INVALID_FLD_VALUE: state\)/.test(s.w.tasks[0].values.message));
});

test('address: what the customer typed is escaped in the Task and on the re-rendered form', function () {
    var s = setup();
    var html = book(s, { addr1: '<b>1</b> & "Co"', zip: 'bad' });
    assert.ok(html.indexOf('id="addr1" name="addr1" value="&lt;b&gt;1&lt;/b&gt; &amp; &quot;Co&quot;"') > 0);
    s = setup();
    book(s, { addr1: '<b>1</b> & Co' });
    assert.ok(s.w.tasks[0].values.message.indexOf('New delivery address:\n&lt;b&gt;1&lt;/b&gt; &amp; Co\n') > 0);
    assert.strictEqual(s.w.addressBooks[42][2].addr.addr1, '<b>1</b> & Co', 'the record holds it as typed');
});

test('address: an address-book booking is byte-identical to 2.1.2 (page, writes, Task, logs)', function () {
    var snap = path.join(__dirname, 'snapshots', 'address-book-booking.json');
    var expected = JSON.parse(fs.readFileSync(snap, 'utf8'));
    // 2.2.1 (PR #8 amendment 1): the snapshot file is unchanged. The page, the writes and the Task are byte-identical;
    // the only difference is config's own logging of the two new record-only settings (empty here), applied below.
    // (The delivery form's traffic note is on the form, not on this confirmation page, so it is not in the capture.)
    expected.logs[0][2] += ', TIME_DEFAULT=none, UNLOAD_SURCHARGE=none';
    expected.logs.splice(11, 0, ['audit', 'CDB PARAMETER_DEFAULT', 'setting TIME_DEFAULT is empty: treated as none'],
        ['audit', 'CDB PARAMETER_DEFAULT', 'setting UNLOAD_SURCHARGE is empty: treated as none']);
    assert.strictEqual(expected.logs[10][2], 'setting UPD_OBJECTION_TYPES is empty: treated as none', 'after the 3.1 keys');
    // 3.4.0 (release 2.3): the same for the dashboard's nine design information keys, after those two.
    expected.logs[0][2] += ', DESIGNINFO_REGISTRY=none, DESIGNINFO_FOLDER=none, DESIGNINFO_MAX_FILES=default, FC_MAP=none, ' +
        'HEAT_MAP=none, VP_MAP=none, NEWBUILD_MARKET_IDS=none, NOTE_TYPE=none, DESIGNINFO_DRAWINGS_URL=none';
    expected.logs.splice.apply(expected.logs, [13, 0].concat(['DESIGNINFO_REGISTRY is empty: treated as none',
        'DESIGNINFO_FOLDER is empty: treated as none', 'DESIGNINFO_MAX_FILES is empty: using the default 6',
        'FC_MAP is empty: treated as none', 'HEAT_MAP is empty: treated as none', 'VP_MAP is empty: treated as none',
        'NEWBUILD_MARKET_IDS is empty: treated as none', 'NOTE_TYPE is empty: treated as none',
        'DESIGNINFO_DRAWINGS_URL is empty: treated as none'].map(function (t) {
        return ['audit', 'CDB PARAMETER_DEFAULT', 'setting ' + t];
    })));
    assert.deepStrictEqual(capture(), expected);
});

// ---------------------------------------------------------------- 3 polish

test('polish: the not-going-ahead button and its message', function () {
    var s = setup();
    assert.strictEqual(s.render.UPDATE_TEXT.CONFIRM, 'Confirm: we’ve decided not to go ahead');
    var check = s.data.validateUpdate({ mode: 'notgoing', confirm: '' }, { reasonIds: [] });
    assert.strictEqual(check.errors.confirm, 'Please press “Confirm: we’ve decided not to go ahead”.');
    assert.strictEqual(s.data.validateUpdate({ mode: 'notgoing', confirm: 'yes' }, { reasonIds: [] }).ok, true, 'still confirm=yes');
});

/** One quote card's digest, as the Map/Reduce would build it. */
function digestFor(opps) {
    var s = setup();
    var groups = s.data.groupProjects(opps, [], fx.CFG);
    s.data.arrangeSections(groups);
    return { s: s, html: s.render.digestEmail({ customerName: 'Acme', groups: groups, payBacs: '1', link: 'https://x/sl?t=T',
        am: { name: 'Pat Lee', phone: '01234 567890', email: 'pat@example.com' }, digestDays: 14 }) };
}

test('polish: the digest shows the QR number once, with and without a title', function () {
    var html = digestFor([fx.opp('7', '10', '', { title: '', tranId: 'QR7' })]).html;
    assert.strictEqual(html.split('QR7').length - 1, 1, 'once');
    assert.ok(html.indexOf('><b>QR7</b></font></p><p style="margin:2px 0 0 0;') > 0, 'the heading');
    assert.ok(html.indexOf('color="#5f5b66">Quote sent</font>') > 0, 'the sub-line without it');
    html = digestFor([fx.opp('7', '10', '', { title: 'Barn', tranId: 'QR7' })]).html;
    assert.ok(html.indexOf('>QR7 · Quote sent</font>') > 0, 'with a title, as today');
});

test('polish: quote cards get the labelled lines — both, each alone, none', function () {
    var STAGE = '<font face="Calibri, Arial, sans-serif" color="#5f5b66">Project stage: </font>' +
        '<font face="Calibri, Arial, sans-serif" color="#2b2a2e"><b>Roof, Doors, Windows</b></font>';
    var START = '<font face="Calibri, Arial, sans-serif" color="#5f5b66">Expected start: </font>' +
        '<font face="Calibri, Arial, sans-serif" color="#2b2a2e"><b>Mar 2027</b></font>';
    [[{ buildStageText: '7 - Roof, Doors, Windows', delDateKey: '2027-03-10' }, [STAGE, START]],
        [{ buildStageText: '7 - Roof, Doors, Windows', delDateKey: '' }, [STAGE]],
        [{ buildStageText: '', delDateKey: '2027-03-10' }, [START]],
        [{ buildStageText: '', delDateKey: '' }, []]].forEach(function (c) {
        var html = digestFor([fx.opp('7', '10', '', Object.assign({ title: 'Barn', tranId: 'QR7' }, c[0]))]).html;
        var card = html.slice(html.indexOf('><b>Barn</b>'), html.indexOf('class="track"'));
        assert.strictEqual((card.match(/Project stage: /g) || []).length, c[1].indexOf(STAGE) >= 0 ? 1 : 0, JSON.stringify(c[0]));
        assert.strictEqual((card.match(/Expected start: /g) || []).length, c[1].indexOf(START) >= 0 ? 1 : 0, JSON.stringify(c[0]));
        c[1].forEach(function (x) { assert.ok(card.indexOf(x) > 0, x); });
        assert.strictEqual(/<div|display:\s*flex/.test(card), false, 'email-safe');
    });
    // Only quote cards: a design card never shows them.
    var html = digestFor([fx.opp('8', '13', '4', { title: 'Loft', buildStageText: '7 - Roof', delDateKey: '2027-03-10' })]).html;
    assert.strictEqual(html.indexOf('Project stage: '), -1);
});

test('polish: the explainer, with and without open quotes', function () {
    var FIRST = 'Every couple of weeks we send you a summary of your projects with Nu-Heat: where each one is up to, and ' +
        'anything you can do next.';
    var html = digestFor([fx.opp('7', '10', '', { title: 'Barn' })]).html;
    assert.ok(html.indexOf(FIRST + ' If anything has changed on a quoted project, press <b>Give us an update</b> on your ' +
        'projects page.</font></p>') > 0);
    assert.ok(html.indexOf(FIRST) > html.indexOf('Hello Acme') && html.indexOf(FIRST) < html.indexOf('Your projects</font></h2>'),
        'under the band, before the cards');
    assert.ok(html.indexOf('Here’s where everything stands') > 0, 'the band as before');
    html = digestFor([fx.opp('8', '13', '4', { title: 'Loft' })]).html;
    assert.ok(html.indexOf(FIRST + '</font></p>') > 0, 'no open quote: the first sentence only');
    assert.ok(html.indexOf(FIRST) < html.indexOf('class="tiles"'), 'before the tiles');
    assert.strictEqual(html.indexOf('Give us an update'), -1);
});

test('polish: the digest is otherwise unchanged (the 2.1 snapshot plus the explainer row)', function () {
    var now = fs.readFileSync(path.join(__dirname, 'snapshots', 'digest-email.html'), 'utf8');
    var before = fs.readFileSync(path.join(__dirname, 'snapshots', 'digest-email-2.1.html'), 'utf8');
    var row = /<tr><td align="left" valign="top" style="padding:0 0 22px 0;"><p style="margin:0;[^\n]*Every couple of weeks[^\n]*<\/td><\/tr>\n/;
    assert.ok(row.test(now));
    assert.strictEqual(now.replace(row, ''), before);
});
