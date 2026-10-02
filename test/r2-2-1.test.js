'use strict';
/**
 * PR #8 amendment 1 (2.2.1): "Your project details" (the reference and the site address), the delivery form's
 * default time of day and traffic note, and the unloading surcharge. Set up as test/r2-2.test.js: the
 * Online-quote library stubbed (1.2.0), everything else against the in-memory NetSuite.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

var LIB_PATH = '/SuiteScripts/NuHeat/2026 Quote/nuheat_opp_update_lib';
var STAGES = [{ id: '', text: '' }, { id: '2', text: 'Foundations' }, { id: '4', text: 'Roof on' }];
var SURCHARGE_HINT = 'A surcharge of £45 + VAT applies for this unloading option.';
var TRAFFIC = 'We’ll always aim for your preferred time, but we can’t control the traffic on the day, so please treat it ' +
    'as a guide rather than a guaranteed slot.';

function libStub(w) {
    return {
        LIB_VERSION: '1.2.0',
        fieldOptions: function () { return STAGES.slice(); },
        writeOppUpdate: function (o) {
            var out = { written: {}, unchanged: [] };
            w.calls.push(['writeOppUpdate', o]);
            Object.keys(o.values).forEach(function (k) {
                out.written[k === 'custbody_build_stage' ? 'build_stage' : k] = { old: '', new: String(o.values[k]) };
                w.opps[o.oppId][k] = String(o.values[k]);
            });
            return out;
        },
        createObjections: function () { return { created: ['9001'], failed: [], errors: {} }; }
    };
}

/** Open quote 5 ("New build", site address on two lines) of customer 42; settings rows as given. */
function setup(settings, prepare) {
    var w = ns.world();
    var s;
    w.calls = [];
    w.opps[5] = { entity: '42', title: 'New build', tranid: 'QR5', entitystatus: '10', custbody_opportunity_sub_status: '',
        salesrep: '88', custbody_pe: '', custbody_value_proposition: '1', custbody_opp_site_adress: 'Plot 4\nVillage',
        custbody_build_stage: '2', custbody_build_stage_text: '2 - Foundations', custbody_opp_del_date: '2027-01-15' };
    w.customers[42].stage = 'CUSTOMER';
    w.settings = [{ id: '100', name: 'UPD_BUILD_STAGES', value: '4,2' }].concat((settings || []).map(function (r, i) {
        return { id: String(200 + i), name: r[0], value: r[1] };
    }));
    w.orders[100].custbodycustbody_sys_bal_incvat = '1200';
    w.orders[100].custbody_sys_bal_exvat = '1000';
    if (prepare) { prepare(w); }
    s = ns.stubs(w);
    s.modules = {};
    s.modules[LIB_PATH] = libStub(w);
    return { w: w, s: s, sl: amd.load('cdb_sl_dashboard', s), tok: amd.load('lib/cdb_lib_token', s).sign(42, 0),
        data: amd.load('lib/cdb_lib_data', s) };
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

function oppSubmits(w) {
    return w.submits.filter(function (o) { return o.type === 'opportunity'; });
}

function book(s, extra) {
    var d = amd.load('lib/cdb_lib_dates');
    var p = { t: s.tok, a: 'delivery', so: '100', date: d.firstAllowedDate(d.londonTodayKey(Date.now()), 3, {}), time: '5',
        address: '900', vehicle: '2', unload: '3', contactName: 'Sam Site', contactPhone: '07700 900000',
        contactEmail: 'sam@example.com', requests: 'Ring first', payment: 'BACS' };
    Object.keys(extra || {}).forEach(function (k) {
        if (extra[k] === undefined) { delete p[k]; } else { p[k] = extra[k]; }
    });
    return run(s.sl, 'POST', p);
}

function form(s) {
    return run(s.sl, 'GET', { t: s.tok, a: 'delivery', so: '100' });
}

/** The time radio for an ID, and whether it is checked. */
function timeRadio(html, id) {
    var m = new RegExp('<input class="sr" type="radio" name="time" value="' + id + '"( checked)? required').exec(html);
    return m ? (m[1] ? 'checked' : 'unchecked') : 'absent';
}

// ---------------------------------------------------------------- 1 your project details

test('details: one question, "Your project details", two inputs side by side, both prefilled, with hints', function () {
    var s = setup();
    var html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
    assert.ok(html.indexOf('<section class="card"><h2><span class="num">1</span>Your project details</h2><div class="g2">' +
        '<div><label class="lbl" for="f-projectName">Your reference</label>' +
        '<input class="inp" type="text" id="f-projectName" name="projectName" value="New build" maxlength="60">' +
        '<p class="hint" style="margin:6px 0 0">A name that makes this project easy for you to spot, e.g. ‘Barn conversion’.</p></div>' +
        '<div><label class="lbl" for="f-siteAddress">Site address</label>' +
        '<input class="inp" type="text" id="f-siteAddress" name="siteAddress" value="Plot 4, Village" maxlength="300">' +
        '<p class="hint" style="margin:6px 0 0">Where the work is happening. It’s optional, but it helps us plan your design ' +
        'and delivery.</p></div></div></section>') > 0, html);
    assert.strictEqual(html.indexOf('<textarea class="inp" id="f-siteAddress"'), -1, 'one line, not a textarea');
    // .g2 is two equal columns, one column at the phone breakpoint.
    assert.ok(/\.g2\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(html));
    assert.ok(/@media \(max-width:719px\)\{[^]*\.g2,\.g3\{grid-template-columns:minmax\(0,1fr\)\}/.test(html));
    assert.strictEqual(s.w.oppLoads, 1, 'the type is read from the loaded opportunity');
});

test('details: only the changed fields go, in ONE submitFields, no sourcing; the untouched prefill is no change', function () {
    var s = setup();
    update(s, { projectName: 'New build', siteAddress: 'Plot 4, Village', note: 'Hi' });
    assert.strictEqual(oppSubmits(s.w).length, 0, 'the prefill as it came: nothing written');

    s = setup();
    update(s, { projectName: 'New build', siteAddress: '  Plot 4,\tVillage Green ' });
    assert.deepStrictEqual(oppSubmits(s.w), [{ type: 'opportunity', id: '5',
        values: { custbody_opp_site_adress: 'Plot 4, Village Green' },
        options: { enableSourcing: false, ignoreMandatoryFields: true } }], 'the site address alone; trimmed, tab to space');

    s = setup();
    update(s, { projectName: 'Barn conversion', siteAddress: 'Plot 4, Village' });
    assert.deepStrictEqual(oppSubmits(s.w).map(function (o) { return o.values; }), [{ title: 'Barn conversion' }]);

    s = setup();
    update(s, { projectName: 'Barn conversion', siteAddress: 'Plot 5, Village', buildStage: '4' });
    assert.deepStrictEqual(oppSubmits(s.w).map(function (o) { return o.values; }),
        [{ title: 'Barn conversion', custbody_opp_site_adress: 'Plot 5, Village' }], 'both, in one write');
    assert.ok(!s.w.calls[0][1].values.hasOwnProperty('custbody_opp_site_adress'), 'never through the library');
});

test('details: blank never clears either field', function () {
    var s = setup();
    var html = update(s, { projectName: '  ', siteAddress: ' \t ' });
    assert.ok(html.indexOf('Nothing to update') > 0);
    assert.strictEqual(s.w.submits.length + s.w.tasks.length, 0);
    s = setup();
    update(s, { projectName: '', siteAddress: '', note: 'Hello' });
    assert.strictEqual(oppSubmits(s.w).length, 0);
    assert.strictEqual(s.w.opps[5].title, 'New build');
    assert.strictEqual(s.w.opps[5].custbody_opp_site_adress, 'Plot 4\nVillage');
    s = setup();
    update(s, { projectName: '', siteAddress: 'Plot 9, Town' });
    assert.deepStrictEqual(oppSubmits(s.w)[0].values, { custbody_opp_site_adress: 'Plot 9, Town' }, 'a blank title stays');
});

test('details: each length limit is enforced (60 and 300); over either writes nothing', function () {
    var x = function (n) { return new Array(n + 1).join('x'); };
    var s = setup();
    var html = update(s, { projectName: 'Barn', siteAddress: x(301), buildStage: '4' });
    assert.ok(html.indexOf('<p class="err" id="err-siteAddress" role="alert">Please keep this under 300 characters.</p>') > 0, html);
    assert.ok(html.indexOf('aria-describedby="err-siteAddress"') > 0);
    assert.strictEqual(s.w.calls.length + s.w.submits.length + s.w.tasks.length, 0, 'nothing written');
    s = setup();
    html = update(s, { projectName: x(61), siteAddress: 'Plot 9' });
    assert.ok(html.indexOf('<p class="err" id="err-projectName" role="alert">Please keep this under 60 characters.</p>') > 0);
    assert.strictEqual(s.w.submits.length, 0);
    s = setup();
    update(s, { projectName: x(60), siteAddress: x(300) });
    assert.deepStrictEqual(oppSubmits(s.w)[0].values, { title: x(60), custbody_opp_site_adress: x(300) }, 'the limits allowed');
});

test('details: the Task, CDB OPP_UPDATED and the confirmation show both changes', function () {
    var s = setup();
    var html = update(s, { projectName: 'Barn conversion', siteAddress: 'Plot 5, Village', buildStage: '4' });
    var msg = s.w.tasks[0].values.message;
    assert.ok(msg.indexOf('Saved on the opportunity (old → new):\n- Your reference: New build → Barn conversion\n' +
        '- Site address: Plot 4, Village → Plot 5, Village\n- Project stage: Foundations → Roof on') > 0, msg);
    assert.ok(logs(s.w, 'OPP_UPDATED')[0][2].indexOf('Your reference New build -> Barn conversion; Site address Plot 4, Village -> ' +
        'Plot 5, Village; Project stage Foundations -> Roof on') > 0, logs(s.w, 'OPP_UPDATED')[0][2]);
    assert.ok(/ \| details written: title, custbody_opp_site_adress$/.test(logs(s.w, 'OPP_UPDATED')[0][2]));
    assert.ok(html.indexOf('<li>Your reference: <strong>Barn conversion</strong></li>' +
        '<li>Site address: <strong>Plot 5, Village</strong></li>') > 0, html);
    // Escaped in the Task and on the page, stored as typed.
    s = setup();
    html = update(s, { siteAddress: '<b>1 & 2</b>' });
    assert.strictEqual(s.w.opps[5].custbody_opp_site_adress, '<b>1 & 2</b>');
    assert.ok(s.w.tasks[0].values.message.indexOf('- Site address: Plot 4, Village → &lt;b&gt;1 &amp; 2&lt;/b&gt;') > 0);
    assert.ok(html.indexOf('Site address: <strong>&lt;b&gt;1 &amp; 2&lt;/b&gt;</strong>') > 0);
});

test('details: a failed write says "Project details NOT saved" with both lines, apart from the stage', function () {
    var s = setup();
    s.w.submitThrows = function (o) { return o.type === 'opportunity'; };
    var html = update(s, { projectName: 'Barn conversion', siteAddress: 'Plot 5, Village', buildStage: '4' });
    var msg = s.w.tasks[0].values.message;
    assert.ok(msg.indexOf('Saved on the opportunity (old → new):\n- Project stage: Foundations → Roof on') > 0, msg);
    assert.ok(msg.indexOf('Project details NOT saved: USER_ERROR: submitFields refused. Please update them by hand (old → new):\n' +
        '- Your reference: New build → Barn conversion\n- Site address: Plot 4, Village → Plot 5, Village') > 0, msg);
    assert.strictEqual(logs(s.w, 'OPP_NAME_FAILED')[0][0], 'error');
    assert.ok(html.indexOf('passed your update on') > 0);
});

test('details: a site address field that is not text hides the input, logs SITE_ADDRESS_NOT_TEXT once, and is never written', function () {
    var s = setup([], function (w) { w.oppFieldTypes = { custbody_opp_site_adress: 'select' }; });
    var html = run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' });
    assert.strictEqual(html.indexOf('name="siteAddress"'), -1, 'not offered');
    assert.strictEqual(html.indexOf('<div class="g2"><div><label class="lbl" for="f-projectName">'), -1, 'the reference alone');
    assert.ok(html.indexOf('<span class="num">1</span>Your project details</h2><div><label class="lbl" for="f-projectName">' +
        'Your reference</label>') > 0, html);
    update(s, { projectName: 'Barn conversion', siteAddress: 'Plot 5' });
    assert.deepStrictEqual(oppSubmits(s.w).map(function (o) { return o.values; }), [{ title: 'Barn conversion' }], 'posted, ignored');
    assert.strictEqual(logs(s.w, 'SITE_ADDRESS_NOT_TEXT').length, 1, 'once per execution');
    assert.ok(/custbody_opp_site_adress is not offered on "Give us an update": its type is "select"/
        .test(logs(s.w, 'SITE_ADDRESS_NOT_TEXT')[0][2]));
    // Missing from the opportunity, or unreadable: the same.
    s = setup([], function (w) { w.missingOppFields = ['custbody_opp_site_adress']; });
    assert.strictEqual(run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' }).indexOf('name="siteAddress"'), -1);
    assert.ok(/it is not on the opportunity/.test(logs(s.w, 'SITE_ADDRESS_NOT_TEXT')[0][2]));
    s = setup([], function (w) { w.oppLoadThrows = true; });
    assert.strictEqual(run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' }).indexOf('name="siteAddress"'), -1);
    assert.ok(/its type could not be read/.test(logs(s.w, 'SITE_ADDRESS_NOT_TEXT')[0][2]));
    // A Text Area is offered like Free-Form Text.
    s = setup([], function (w) { w.oppFieldTypes = { custbody_opp_site_adress: 'textarea' }; });
    assert.ok(run(s.sl, 'GET', { t: s.tok, a: 'update', opp: '5' }).indexOf('name="siteAddress" value="Plot 4, Village"') > 0);
    assert.strictEqual(logs(s.w, 'SITE_ADDRESS_NOT_TEXT').length, 0);
    assert.deepStrictEqual(['text', 'TEXTAREA', 'select', 'richtext', '', null].map(s.data.isTextFieldType),
        [true, true, false, false, false, false]);
});

// ---------------------------------------------------------------- 2 time of day

test('time: with TIME_DEFAULT set and offered, it is pre-selected, and a post with no time books it', function () {
    var s = setup([['TIME_DEFAULT', '3']]);
    var html = form(s);
    assert.strictEqual(timeRadio(html, '3'), 'checked');
    assert.strictEqual(timeRadio(html, '2'), 'unchecked');
    assert.ok(html.indexOf('<span data-sum="time" data-empty="Not chosen yet">Anytime</span>') > 0, 'the summary agrees');
    html = book(s, { time: undefined });
    assert.ok(html.indexOf('Delivery requested') > 0, html);
    assert.strictEqual(s.w.saves[0].values.custbody_del_time_per, '3');
    assert.ok(html.indexOf(', Anytime, for') > 0, 'the confirmation names it');
    // A blank time is "no time posted" too; a posted time still wins.
    s = setup([['TIME_DEFAULT', '3']]);
    book(s, { time: ' ' });
    assert.strictEqual(s.w.saves[0].values.custbody_del_time_per, '3');
    s = setup([['TIME_DEFAULT', '3']]);
    book(s, { time: '2' });
    assert.strictEqual(s.w.saves[0].values.custbody_del_time_per, '2');
    // A posted time that is not offered is still an error, not the default.
    s = setup([['TIME_DEFAULT', '3']]);
    html = book(s, { time: '9' });
    assert.ok(html.indexOf('Please choose a delivery time.') > 0);
    assert.strictEqual(s.w.saves.length, 0);
    assert.strictEqual(logs(s.w, 'TIME_DEFAULT_INVALID').length, 0);
});

test('time: with TIME_DEFAULT empty, nothing is pre-selected and a missing time is an error (as today)', function () {
    var s = setup();
    var html = form(s);
    ['2', '5', '3'].forEach(function (id) { assert.strictEqual(timeRadio(html, id), 'unchecked', id); });
    html = book(s, { time: undefined });
    assert.ok(html.indexOf('Please choose a delivery time.') > 0);
    assert.strictEqual(s.w.saves.length + s.w.tasks.length, 0);
    assert.strictEqual(logs(s.w, 'TIME_DEFAULT_INVALID').length, 0);
});

test('time: a TIME_DEFAULT that is not offered behaves as today, logged once per request', function () {
    var s = setup([['TIME_DEFAULT', '7']]);
    var html = form(s);
    ['2', '5', '3'].forEach(function (id) { assert.strictEqual(timeRadio(html, id), 'unchecked', id); });
    assert.strictEqual(logs(s.w, 'TIME_DEFAULT_INVALID').length, 1);
    assert.ok(/Setting TIME_DEFAULT 7 is not one of the times offered \[2,5,3\]: no default time/
        .test(logs(s.w, 'TIME_DEFAULT_INVALID')[0][2]));
    s = setup([['TIME_DEFAULT', '7']]);
    html = book(s, { time: undefined });
    assert.ok(html.indexOf('Please choose a delivery time.') > 0);
    assert.strictEqual(s.w.saves.length, 0);
    assert.strictEqual(logs(s.w, 'TIME_DEFAULT_INVALID').length, 1);
});

test('time: the traffic note is under the time choices, as a hint, with or without a default', function () {
    [[], [['TIME_DEFAULT', '3']]].forEach(function (settings) {
        var html = form(setup(settings));
        assert.ok(html.indexOf('</div></fieldset><p class="hint" style="margin:0">' + TRAFFIC + '</p></section>') > 0, html);
        assert.ok(html.indexOf(TRAFFIC) > html.indexOf('<legend>Time of day</legend>'));
    });
});

// ---------------------------------------------------------------- 3 unloading surcharge

test('surcharge: the hint is under the surcharged card only, in the hint place, without script', function () {
    var s = setup([['UNLOAD_SURCHARGE', '{"2": "£45 + VAT"}']]);
    var html = form(s);
    var cards = html.split('<label class="optc"><input type="radio" name="unload"').slice(1);
    assert.strictEqual(cards.length, 3);
    assert.strictEqual(cards[0].indexOf('surcharge'), -1, 'Tail lift');
    assert.ok(cards[1].indexOf(' value="2" required data-label="Forklift"><span><span class="ot">Forklift</span>' +
        '<span class="oh">' + SURCHARGE_HINT + '</span></span></label>') === 0, cards[1]);
    assert.strictEqual(cards[2].indexOf('surcharge'), -1, 'By hand');
    assert.strictEqual(html.split(SURCHARGE_HINT).length - 1, 1, 'once');
    // Beside an option hint, under it.
    s = setup([['UNLOAD_SURCHARGE', '{"2": "£45 + VAT"}'], ['OPTION_HINTS', '{"unload": {"2": "A Moffett or piggyback"}}']]);
    assert.ok(form(s).indexOf('<span class="ot">Forklift</span><span class="oh">A Moffett or piggyback</span>' +
        '<span class="oh">' + SURCHARGE_HINT + '</span>') > 0);
});

test('surcharge: chosen -> the confirmation note and the Task line; another option -> neither', function () {
    var NOTE = 'Your Forklift unloading surcharge of £45 + VAT will be added to your balance. We’ll confirm the new total.';
    var LINE = 'SURCHARGE: the customer chose Forklift. Add the £45 + VAT unloading surcharge to the order.';
    var s = setup([['UNLOAD_SURCHARGE', '{"2": "£45 + VAT"}']]);
    var html = book(s, { unload: '2' });
    var msg = s.w.tasks[0].values.message;
    assert.ok(html.indexOf('<p class="hint" style="margin:8px 0 0">' + NOTE + '</p>') > 0, html);
    assert.ok(html.indexOf(NOTE) > html.indexOf('Amount to pay'), 'under the amount to pay');
    assert.ok(msg.indexOf('Amount to pay: £1,200.00 inc VAT (£1,000.00 ex VAT)\n\n' + LINE + '\n\nChanged on the sales order') > 0, msg);
    assert.strictEqual(s.w.saves.length, 1);
    assert.strictEqual(Object.keys(s.w.saves[0].values).filter(function (k) { return /item/.test(k); }).length, 0,
        'no item line: the rep adds it');
    // Card: on the main card, after the amount; Add to account (no amount): on the main card too.
    var t = setup([['UNLOAD_SURCHARGE', '{"2": "£45 + VAT"}']]);
    var page = book(t, { unload: '2', payment: 'CARD' });
    assert.ok(page.indexOf(NOTE) > page.indexOf('£1,200.00'), page);
    assert.ok(t.w.tasks[0].values.message.indexOf(LINE) > 0);
    page = amd.load('lib/cdb_lib_render').confirmation({ payment: 'ACCOUNT', tranId: 'SO100', backUrl: '#',
        surcharge: { optionName: 'Forklift', amount: '£45 + VAT' } });
    assert.ok(page.indexOf('<div class="card done">') < page.indexOf(NOTE) && page.indexOf(NOTE) < page.indexOf('What happens next'));
    // Another option: neither.
    s = setup([['UNLOAD_SURCHARGE', '{"2": "£45 + VAT"}']]);
    html = book(s, { unload: '3' });
    assert.strictEqual(html.indexOf('surcharge'), -1);
    assert.strictEqual(s.w.tasks[0].values.message.indexOf('SURCHARGE'), -1);
});

test('surcharge: an invalid UNLOAD_SURCHARGE means no surcharge anywhere, and is logged', function () {
    var s = setup([['UNLOAD_SURCHARGE', '{"2": "£45 + VAT"']]);
    var html = form(s);
    assert.strictEqual(html.indexOf('surcharge'), -1);
    assert.strictEqual(logs(s.w, 'UNLOAD_SURCHARGE_INVALID').length, 1);
    assert.ok(/Setting UNLOAD_SURCHARGE ignored, so no surcharge is shown: not JSON/.test(logs(s.w, 'UNLOAD_SURCHARGE_INVALID')[0][2]));
    s = setup([['UNLOAD_SURCHARGE', '["2"]']]);
    html = book(s, { unload: '2' });
    assert.strictEqual(html.indexOf('surcharge'), -1);
    assert.strictEqual(s.w.tasks[0].values.message.indexOf('SURCHARGE'), -1);
    assert.strictEqual(logs(s.w, 'UNLOAD_SURCHARGE_INVALID').length, 1);
    // Unusable entries are ignored, not invalid.
    var c = amd.load('lib/cdb_lib_config');
    assert.deepStrictEqual(c.parseUnloadSurcharge('{"2": "£45", "x": "£1", "3": "", "4": 5}'),
        { status: 'ok', amounts: { 2: '£45' }, detail: '' });
    assert.strictEqual(c.parseUnloadSurcharge('').status, 'empty');
});
