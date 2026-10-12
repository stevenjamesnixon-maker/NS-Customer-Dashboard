'use strict';
/**
 * Release 2.3c (dashboard 2.5.0, designinfo 1.2.0, data 2.4.0, render 2.5.0, config 3.5.0, send design information 1.1.0,
 * digest 2.2.0): the restructured stepper, the heat loss step, the EPC lookup and the MCS pictures — brief §B14, against
 * the COMMITTED v3 registry and content files (test/helpers/v3.js).
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var v3 = require('./helpers/v3');

var di = amd.load('lib/cdb_lib_designinfo', {});
var config = amd.load('lib/cdb_lib_config', {});
var REGISTRY = v3.read('design-info-registry.csv');
var PRESETS = di.parsePresets(v3.read('element-presets.csv'));
var AGES = di.parseAgeBands(v3.read('age-bands.csv'), PRESETS);
var EPCMAP = di.parseEpcMap(v3.read('epc-element-map.csv'), PRESETS);
var V2 = 'section,section_title,panel,qid,type,label,hint,options,field,required,when,why,step_intro,step_minutes,image,placeholder';
var V3 = V2 + ',reveal,short';

function settings(over) {
    var out = {};
    config.DI_OPTION_SETTINGS.forEach(function (k) { out[k] = v3.SETTINGS[k]; });
    Object.keys(over || {}).forEach(function (k) { out[k] = over[k]; });
    return out;
}

function parse(text, over) {
    return di.parseRegistry(text, config.designInfoAllowList(), config.DESIGNINFO_DENY, { settings: settings(over) });
}

function byQid(qs) {
    var m = {};
    qs.forEach(function (q) { m[q.qid] = q; });
    return m;
}

function facts(o) {
    return di.buildFacts(o, { FC_MAP: v3.SETTINGS.FC_MAP, HEAT_MAP: v3.SETTINGS.HEAT_MAP, VP_MAP: v3.SETTINGS.VP_MAP,
        DI_HEAT26_MAP: v3.SETTINGS.DI_HEAT26_MAP, NEWBUILD_MARKET_IDS: ['9'] });
}

// ---------------------------------------------------------------- registry v3

test('registry v3: the 12-, 16- and 18-column headers all parse; reveal and short read as empty when absent; a partial v3 ' +
    'header is invalid', function () {
    var v1 = parse('section,section_title,panel,qid,type,label,hint,options,field,required,when,why\n' +
        'plans,P,main,a,text,A,,,note,N,,\n');
    var v2 = parse(V2 + '\nplans,P,main,a,text,A,,,note,N,,,Intro,2,,\n');
    var v3r = parse(V3 + '\nplans,P,main,a,yesno,A,,,state,N,,,Intro,2,,,,"Plans"\nplans,P,main,b,text,B,,,note,N,,,,,,,a=yes,\n');
    assert.deepStrictEqual([v1.headerVersion, v2.headerVersion, v3r.headerVersion], [1, 2, 3]);
    assert.strictEqual(v1.questions[0].revealText, '');
    assert.strictEqual(v2.questions[0].stepShort, 'P', 'short falls back to section_title');
    assert.strictEqual(v3r.questions[1].stepShort, 'Plans', 'short from the section\'s first row');
    assert.deepStrictEqual(v3r.questions[1].reveal.alternatives, [[{ qid: 'a', keys: ['yes'] }]]);
    assert.strictEqual(parse(V2 + ',reveal\nplans,P,main,a,text,A,,,note,N,,,,,,,\n').status, 'invalid');
    assert.strictEqual(parse('section,section_title,panel,qid,type,label,hint,options,field,required,when,why,reveal,short\n' +
        'plans,P,main,a,text,A,,,note,N,,,,\n').status, 'invalid', 'v3 without the v2 columns');
});

test('registry v3: the committed file parses with 0 rejected, 93 questions; six steps (amendment 3), titles, shorts and minutes', function () {
    var r = parse(REGISTRY);
    var steps = di.sectionsOf(r.questions);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.headerVersion, 3);
    assert.deepStrictEqual(r.rejected, []);
    // Amendment 2: dhw_info (the hot water line) added. Amendment 3: site_ok, site_new, plans_sent_how and the three Heat loss
    // explainers (drawings_info, ins_info, ext_info) added.
    assert.strictEqual(r.questions.length, 93);
    assert.strictEqual(REGISTRY.split(/\r?\n/)[0], V3);
    assert.deepStrictEqual(steps.map(function (s) { return [s.id, s.title, s.short, s.minutes]; }), [
        // Amendment 3: Plans folds into Your project.
        ['project', 'Your project', 'Your project', 3],
        ['insulation', 'Understanding the heat loss of your property', 'Heat loss', 5],
        ['heating', 'Heating and controls', 'Heating', 2],
        ['heatpump', 'Heat pump information required for MCS', 'Heat pump', 4],
        ['other', 'Anything else for your Project Engineer?', 'Anything else', 1]]);
    // Every line has 18 cells; every non-empty text cell is quoted.
    REGISTRY.split('\n').slice(1).filter(function (l) { return l; }).forEach(function (line) {
        assert.strictEqual(di.parseCsv(line).rows[0].length, 18, line);
    });
    var q = byQid(r.questions);
    // The 2.3b rows the brief removed are gone (stored answers under them are ignored: unknownStateQids).
    ['build_stage', 'w3w', 'plans_current', 'ins_choice', 'ins_files', 'year', 'walls_new', 'walls_ex', 'floors_ex', 'hp_location',
        'hp_photo', 'hp_surround', 'nb_distance', 'nb_which', 'nb_between', 'nb_view', 'nb_others', 'hp_buffer', 'hp_cylinder',
        'ground_loop'].forEach(function (id) { assert.strictEqual(q[id], undefined, id); });
    assert.strictEqual(q.ptype.optionsFromSetting, 'DI_BUILD_TYPE_OPTIONS');
    assert.deepStrictEqual(q.ptype.optionKeys, ['detached', 'semi', 'end', 'mid', 'bungalow', 'flat']);
    assert.deepStrictEqual(q.market.optionKeys, ['new', 'reno']);
    assert.strictEqual(q.reflect.pictures, true);
    assert.strictEqual(q.el_walls.store, 'element');
    assert.deepStrictEqual([q.ext2_roof.element, q.ext2_roof.ext], ['roof', 'ext2']);
    assert.strictEqual(q.epc.store, 'epc');
    assert.strictEqual(q.ins_route_reno.field, 'custbody_pq_cylinder_location');
    assert.deepStrictEqual(q.ext2_what.reveal.alternatives, [[{ qid: 'has_ext', keys: ['yes'] }, { qid: 'ext_count', keys: ['2'] }]]);
    assert.strictEqual(q.el_floor.revealText, 'ins_route_reno=epc,describe,typical|ins_route_new=regs,describe');
    assert.strictEqual(q.dhw.required, false);
    assert.ok(/MCS 020/.test(q.reflect.hint));
    // custbody35 is not written (no barrier-type question).
    assert.strictEqual(r.questions.some(function (x) { return x.field === 'custbody35'; }), false);
});

test('registry v3: the content files parse with 0 rejected', function () {
    assert.deepStrictEqual([PRESETS.status, PRESETS.rejected], ['ok', []]);
    assert.deepStrictEqual([AGES.status, AGES.rejected], ['ok', []]);
    assert.deepStrictEqual([EPCMAP.status, EPCMAP.rejected], ['ok', []]);
    assert.strictEqual(PRESETS.byElement.walls.length, 11);
    assert.deepStrictEqual(AGES.bands['1991'].floor, { preset: '', u: '0.45', label: '' });
    assert.deepStrictEqual(AGES.bands.regs_ext.walls, { preset: '', u: '0.18', label: '' });
});

// ---------------------------------------------------------------- @setting and literal keys

test('@setting options: valid; empty, invalid JSON, not an array, a repeated key — the row rejected with the reason', function () {
    assert.strictEqual(parse(REGISTRY).questions.filter(function (q) { return q.qid === 'ptype'; }).length, 1);
    [['', /empty/], ['{not json', /not JSON/], ['{"a": 1}', /not a JSON array/],
        ['[{"id": "1", "key": "a", "label": "A"}, {"id": "2", "key": "a", "label": "B"}]', /repeats/],
        ['[{"id": "1", "key": "A B", "label": "A"}]', /needs an id, a key/]].forEach(function (c) {
        var r = parse(REGISTRY, { DI_BUILD_TYPE_OPTIONS: c[0] });
        var rej = r.rejected.filter(function (x) { return x.qid === 'ptype'; })[0];
        assert.ok(rej && c[1].test(rej.reason), c[0] + ': ' + JSON.stringify(rej));
        assert.strictEqual(r.status, 'ok', 'the rest renders');
    });
    var unknown = parse(V3 + '\nplans,P,main,a,choice,A,,"@setting:NOT_A_KEY",note,N,,,,,,,,\n');
    assert.ok(/not an options setting/.test(unknown.rejected[0].reason));
});

test('literal options: key=Label keys; without key= the key is o<index>; a repeated key rejects the row', function () {
    var r = parse(V3 + '\nplans,P,main,a,choice,A,,"x=Ex|Why|z=Zed",state,N,,,,,,,,\nplans,P,main,b,choice,B,,"a=1|a=2",note,N,,,,,,,,\n');
    assert.deepStrictEqual(r.questions[0].optionKeys, ['x', 'o1', 'z']);
    assert.deepStrictEqual(r.questions[0].options, ['Ex', 'Why', 'Zed']);
    assert.strictEqual(r.questions[0].store, 'state', 'state is allowed for a choice now');
    assert.ok(/repeated/.test(r.rejected[0].reason));
});

// ---------------------------------------------------------------- reveal

test('parseReveal: an unknown qid, a later qid, a bad key, a text question; | and ; combine', function () {
    var r = parse([V3,
        'plans,P,main,a,yesno,A,,,state,N,,,,,,,,',
        'plans,P,main,b,choice,B,,"x=X|y=Y",state,N,,,,,,,,',
        'plans,P,main,c,text,C,,,note,N,,,,,,,nope=yes,',
        'plans,P,main,d,text,D,,,note,N,,,,,,,e=yes,',
        'plans,P,main,e,yesno,E,,,state,N,,,,,,,,',
        'plans,P,main,f,text,F,,,note,N,,,,,,,b=z,',
        'plans,P,main,g,text,G,,,note,N,,,,,,,f=x,',
        'other,O,main,h,text,H,,,note,N,,,,,,,a=yes,',
        'plans,P,main,i,text,I,,,note,N,,,,,,,"a=yes;b=x,y|e=no",'].join('\n') + '\n');
    var why = {};
    r.rejected.forEach(function (x) { why[x.qid] = x.reason; });
    assert.ok(/not an earlier question/.test(why.c), 'unknown');
    assert.ok(/not an earlier question/.test(why.d), 'later');
    assert.ok(/"z" is not a key of b/.test(why.f), 'bad key');
    assert.ok(/not an earlier question/.test(why.g), 'f was rejected, so it is not there');
    // Amendment 3: an earlier question in ANOTHER section is allowed (Heat loss reveals on Your project's market).
    assert.strictEqual(why.h, undefined, 'another section, earlier: accepted');
    var i = byQid(r.questions).i;
    assert.deepStrictEqual(i.reveal.alternatives, [[{ qid: 'a', keys: ['yes'] }, { qid: 'b', keys: ['x', 'y'] }],
        [{ qid: 'e', keys: ['no'] }]]);
    var t = parse(V3 + '\nplans,P,main,a,text,A,,,note,N,,,,,,,,\nplans,P,main,b,text,B,,,note,N,,,,,,,a=yes,\n');
    assert.ok(/a text question/.test(t.rejected[0].reason));
});

test('revealMap: any alternative, all clauses; absent by `when` is TRUE; hidden by reveal is FALSE, and it cascades', function () {
    var r = parse([V3,
        'plans,P,main,a,yesno,A,,,state,N,,,,,,,,',
        'plans,P,main,b,yesno,B,,,state,N,service=hp,,,,,,,',
        'plans,P,main,c,yesno,C,,,state,N,,,,,,,a=yes,',
        'plans,P,main,d,text,D,,,note,N,,,,,,,c=yes,',
        'plans,P,main,e,text,E,,,note,N,,,,,,,b=yes,',
        'plans,P,main,f,text,F,,,note,N,,,,,,,a=no|c=yes,'].join('\n') + '\n');
    var answers;
    function map(service) {
        var shown = di.visibleQuestions(r.questions, { service: service, fc: ['solid'], heat: [], hp: [] });
        return di.revealMap(shown, function (q) { return di.keyOfValue(q, answers[q.qid] || ''); });
    }
    answers = { a: 'yes', c: 'yes' };
    assert.deepStrictEqual(map('hp'), { a: true, b: true, c: true, d: true, e: false, f: true });
    // b is absent (its when is false): e's clause on b is true.
    assert.strictEqual(map('ufh').e, true);
    assert.strictEqual(map('ufh').b, undefined);
    // a=no hides c; c hidden hides d even though c's stored answer is yes (the cascade); f's first alternative holds.
    answers = { a: 'no', c: 'yes' };
    assert.deepStrictEqual([map('hp').c, map('hp').d, map('hp').f], [false, false, true]);
    // keyOfValue: a literal label (with an EPC suffix), an @setting id, yes/no.
    var q = byQid(parse(REGISTRY).questions);
    assert.strictEqual(di.keyOfValue(q.ins_route_reno, 'Find my EPC · EPC 1111-2222-3333-4444-5555, lodged 01/02/2020'), 'epc');
    assert.strictEqual(di.keyOfValue(q.market, '8'), 'reno');
    assert.strictEqual(di.keyOfValue(q.market, '99'), '');
    assert.strictEqual(di.keyOfValue(q.has_ext, 'yes'), 'yes');
});

// ---------------------------------------------------------------- the heat facts (§B2)

test('heat facts: custbody_heat_source_type_26 arrays [4], [7], [8], [4,10], [3], [1], [] and the Sales MI fallback', function () {
    function f(ids, mi) {
        var x = facts({ heatSource26: ids, heatSource: mi || '' });
        return [x.heat, x.hp, x.heatFrom];
    }
    assert.deepStrictEqual(f(['4']), [['nuheat_hp', 'ashp'], ['ashp'], '26']);
    assert.deepStrictEqual(f(['7']), [['nuheat_hp', 'gshp_loop'], ['gshp_loop'], '26']);
    assert.deepStrictEqual(f(['8']), [['nuheat_hp', 'gshp_bore'], ['gshp_bore'], '26']);
    assert.deepStrictEqual(f(['4', '10']), [['boiler', 'nuheat_hp', 'ashp'], ['ashp'], '26']);
    assert.deepStrictEqual(f('4,10'), [['boiler', 'nuheat_hp', 'ashp'], ['ashp'], '26'], 'a search column\'s comma string');
    assert.deepStrictEqual(f(['3']), [['user_hp'], [], '26']);
    assert.deepStrictEqual(f(['1'], '4'), [['boiler'], [], 'mi'], 'unmapped: the Sales MI');
    assert.deepStrictEqual(f(['1']).slice(2), ['mi']);
    assert.deepStrictEqual(facts({ heatSource26: ['1'] }).unmapped26, ['1']);
    assert.deepStrictEqual(f([], '3'), [['nuheat_hp'], ['unknown'], 'mi'], 'the Sales MI\'s Nu-Heat heat pump: hp unknown');
    assert.deepStrictEqual(f([]), [['other'], [], 'mi']);
    // when: set membership.
    var x = facts({ heatSource26: ['4', '10'] });
    assert.strictEqual(di.whenMatches('heat=boiler,user_hp', x), true);
    assert.strictEqual(di.whenMatches('heat=nuheat_hp;hp=ashp,unknown', x), true);
    assert.strictEqual(di.whenMatches('hp=gshp_loop', x), false);
    assert.strictEqual(di.whenMatches('hp=unknown', facts({ heatSource: '3' })), true);
    // The warnings use the set; HP Design with no heat pump in Heat Source Type is a warning.
    assert.ok(facts({ valueProposition: '2', heatSource26: ['10'] }).warnings.indexOf('HP Design but no heat pump in Heat ' +
        'Source Type.') >= 0);
    assert.strictEqual(facts({ valueProposition: '2', fc: '7', heatSource26: ['4'] }).warnings.length, 0);
    assert.ok(facts({ valueProposition: '1', heatSource26: ['4'] }).warnings.indexOf('The heat source is a Nu-Heat heat pump, ' +
        'but the design service is not HP Design.') >= 0);
    assert.ok(facts({}).warnings.some(function (w) { return /Heat source not set/.test(w); }));
    assert.strictEqual(facts({ heatSource26: ['4'] }).warnings.some(function (w) { return /Heat source/.test(w); }), false);
    // DI_HEAT26_MAP empty: the Sales MI only.
    assert.deepStrictEqual(di.buildFacts({ heatSource26: ['4'], heatSource: '4' }, { HEAT_MAP: v3.SETTINGS.HEAT_MAP }).heat,
        ['boiler']);
});

// ---------------------------------------------------------------- stepsFor (§B3)

test('stepsFor: requested empty means every allowed step; a subset; a ruled-out step is never added; project and other ' +
    'always', function () {
    var qs = parse(REGISTRY).questions;
    var f = facts({ valueProposition: '5', fc: '7', heatSource26: ['10'] });
    function ids(req) { return di.stepsFor(qs, f, req).map(function (s) { return s.id; }); }
    // Amendment 3: six steps (Plans folded into Your project); an rq naming plans adds nothing.
    assert.deepStrictEqual(ids([]), ['project', 'insulation', 'heating', 'other']);
    assert.deepStrictEqual(ids(undefined), ids([]));
    assert.deepStrictEqual(ids(['plans']), ['project', 'other']);
    assert.deepStrictEqual(ids(['plans', 'heating']), ['project', 'heating', 'other']);
    assert.deepStrictEqual(ids(['heatpump', 'heating']), ['project', 'heating', 'other'], 'heatpump is ruled out: not added');
    assert.deepStrictEqual(ids(['project', 'other']), ['project', 'other']);
    assert.strictEqual(di.stepsMinutes(di.stepsFor(qs, f, [])), 3 + 5 + 2 + 1);
    assert.strictEqual(di.stepsMinutes([]), 0);
});

/**
 * The visible-step table (§B5): {ufh, ufh_plus, hp} x {solid, joisted, overfloor, hp} x heat sets — the step SHORT titles.
 * Amendment 3: six steps, no Plans. Heat loss for UFH Design + and HP Design; Heating whenever the floor needs pipe; Heat pump for a Nu-Heat heat pump.
 */
var STEP_TABLE = {
    'ufh solid boiler': 'Your project, Heating, Anything else',
    'ufh solid ashp': 'Your project, Heating, Heat pump, Anything else',
    'ufh hp boiler': 'Your project, Anything else',
    'ufh hp hpunknown': 'Your project, Heat pump, Anything else',
    'ufh_plus joisted boiler': 'Your project, Heat loss, Heating, Anything else',
    'ufh_plus joisted hybrid': 'Your project, Heat loss, Heating, Heat pump, Anything else',
    'ufh_plus overfloor userhp': 'Your project, Heat loss, Heating, Anything else',
    'ufh_plus hp ashp': 'Your project, Heat loss, Heat pump, Anything else',
    'hp solid ashp': 'Your project, Heat loss, Heating, Heat pump, Anything else',
    'hp solid boiler': 'Your project, Heat loss, Heating, Anything else',
    'hp joisted hpunknown': 'Your project, Heat loss, Heating, Heat pump, Anything else',
    'hp overfloor hybrid': 'Your project, Heat loss, Heating, Heat pump, Anything else',
    'hp hp ashp': 'Your project, Heat loss, Heat pump, Anything else',
    'hp hp boiler': 'Your project, Heat loss, Anything else',
    'hp hp userhp': 'Your project, Heat loss, Anything else'
};
var HEATS = { boiler: [['boiler'], []], ashp: [['nuheat_hp', 'ashp'], ['ashp']], hpunknown: [['nuheat_hp'], ['unknown']],
    hybrid: [['boiler', 'nuheat_hp', 'ashp'], ['ashp']], userhp: [['user_hp'], []] };

test('the visible-step table: services x floor constructions x heat sets (short titles)', function () {
    var qs = parse(REGISTRY).questions;
    Object.keys(STEP_TABLE).forEach(function (key) {
        var p = key.split(' ');
        var got = di.stepsFor(qs, { service: p[0], fc: [p[1]], heat: HEATS[p[2]][0], hp: HEATS[p[2]][1], newbuild: false }, [])
            .map(function (s) { return s.short; }).join(', ');
        assert.strictEqual(got, STEP_TABLE[key], key);
    });
    // Inside the heat pump step: the ASHP rows for an ASHP, the loop rows for a loop, all three sets when the type is unknown.
    function hpQids(heat, hp) {
        return di.visibleQuestions(qs, { service: 'hp', fc: ['solid'], heat: heat, hp: hp }).filter(function (q) {
            return q.section === 'heatpump';
        }).map(function (q) { return q.qid; }).join(' ');
    }
    assert.strictEqual(hpQids(['nuheat_hp', 'ashp'], ['ashp']), 'hp_loc_plan hp_loc_files hp_loc reflect barrier distance ' +
        'buffer_plan buffer_files buffer cyl_plan cyl_files cyl dhw_info dhw');
    assert.strictEqual(hpQids(['nuheat_hp', 'gshp_loop'], ['gshp_loop']), 'hp_loc_plan hp_loc_files hp_loc loop_plan loop_files ' +
        'loop_area buffer_plan buffer_files buffer cyl_plan cyl_files cyl dhw_info dhw');
    assert.ok(/^hp_type .*reflect.*loop_plan.*bore_plan/.test(hpQids(['nuheat_hp'], ['unknown'])));
});

// ---------------------------------------------------------------- element lines (§B8)

test('elementLine / parseElementLine: a round trip; all empty is \'\'; a source-only change is not a change; staff prose is ' +
    'null', function () {
    var line = di.elementLine({ label: 'Cavity, filled', u: '0.55', uSource: 'typical', notes: 'filled in 2010' });
    assert.strictEqual(line, 'Cavity, filled · U 0.55 (typical) · notes: filled in 2010');
    assert.deepStrictEqual(di.parseElementLine(line), { label: 'Cavity, filled', u: '0.55', uSource: 'typical',
        notes: 'filled in 2010' });
    assert.strictEqual(di.elementLine({}), '');
    assert.strictEqual(di.elementLine({ label: '', u: '', notes: '' }), '');
    assert.strictEqual(di.elementLine({ label: 'Not sure' }), 'Not sure');
    assert.strictEqual(di.elementLine({ u: 0.3, uSource: 'customer' }), 'U 0.3 (customer)');
    assert.strictEqual(di.sameElement('Cavity, filled · U 0.55 (typical)', 'Cavity, filled · U 0.55 (EPC)'), true,
        'only the source changed');
    assert.strictEqual(di.sameElement('Cavity, filled · U 0.55 (typical)', 'Cavity, filled · U 0.5 (customer)'), false);
    assert.strictEqual(di.parseElementLine('Cavity filled about 2010, render outside'), null, 'staff prose');
    assert.strictEqual(di.parseElementLine('Line one\nline two'), null);
    assert.deepStrictEqual(di.parseElementLine('Not sure', di.elementLabels(PRESETS, 'walls')),
        { label: 'Not sure', u: '', uSource: '', notes: '' });
});

test('elementTargets: a new build -> New; a renovation -> Existing; an extension "Different" -> New with the prefix; two ' +
    'joined; "Same" writes nothing', function () {
    assert.deepStrictEqual(di.elementTargets({ market: 'new' }, { el_walls: { element: 'walls', ext: '', line: 'A' } }),
        { custbody_new_walls_2026: 'A' });
    assert.deepStrictEqual(di.elementTargets({ market: 'reno' }, { el_walls: { element: 'walls', ext: '', line: 'A' },
        el_roof: { element: 'roof', ext: '', line: 'R' } }), { custbody_existing_walls_2026: 'A', custbody_existing_roofs_2026: 'R' });
    assert.deepStrictEqual(di.elementTargets({ market: 'reno' }, { ext2_walls: { element: 'walls', ext: 'ext2', line: 'Two' },
        ext1_walls: { element: 'walls', ext: 'ext1', line: 'One' }, el_walls: { element: 'walls', ext: '', line: 'House' } }),
        { custbody_new_walls_2026: 'Extension 1: One\nExtension 2: Two', custbody_existing_walls_2026: 'House' });
    // "Same as the main house": the extension's card is hidden, so it has no answer and nothing is written for it.
    assert.deepStrictEqual(di.elementTargets({ market: 'reno' }, { el_walls: { element: 'walls', ext: '', line: 'House' } }),
        { custbody_existing_walls_2026: 'House' });
    assert.deepStrictEqual(di.elementTargets({ market: 'reno' }, { ext1_walls: { element: 'walls', ext: 'ext1', line: '' } }), {});
    assert.deepStrictEqual(di.elementTargets({ market: '' }, { el_walls: { element: 'walls', ext: '', line: 'A' } }), {},
        'no market answer: nowhere to route');
});

test('pre-fill: typical per age band; regs_new; regs_ext; the EPC; never over the customer\'s own choice', function () {
    var ctx = { presets: PRESETS, element: 'walls', band: AGES.bands['1950'], regs: AGES.bands.regs_ext };
    function line(card, c) { return di.elementLine(di.composeElement(card, c || ctx)); }
    var age = di.fillPrefill({ key: '', u: '', notes: '' }, di.bandFill('age', AGES.bands['1950'], 'walls'));
    assert.strictEqual(age.key, 'cavity_unfilled_pre76');
    assert.strictEqual(line(age), 'Cavity, unfilled (before 1976) · U 1.6 (typical)');
    assert.strictEqual(di.sourceTag(age, AGES.bands['1950']), 'Typical for 1950 – 1975');
    // A band whose value is a U-value: the typical special with that U.
    var floor = di.fillPrefill({ key: '', u: '', notes: '' }, di.bandFill('age', AGES.bands['1991'], 'floor'));
    assert.strictEqual(line(floor, { presets: PRESETS, element: 'floor', band: AGES.bands['1991'] }),
        'Typical for 1991 – 2002 · U 0.45 (typical)');
    var regsNew = di.fillPrefill({}, di.bandFill('regs', AGES.bands.regs_new, 'walls'));
    assert.strictEqual(line(regsNew, { presets: PRESETS, element: 'walls', regs: AGES.bands.regs_new }),
        'Built to current Building Regulations · U 0.26 (regs)');
    assert.strictEqual(line(di.fillPrefill({}, di.bandFill('regs', AGES.bands.regs_ext, 'roof')),
        { presets: PRESETS, element: 'roof', regs: AGES.bands.regs_ext }), 'Built to current Building Regulations · U 0.15 (regs)');
    var epc = di.fillPrefill({}, { kind: 'epc', key: 'cavity_filled', u: '' });
    assert.strictEqual(line(epc), 'Cavity, filled · U 0.55 (EPC)');
    assert.strictEqual(di.sourceTag(epc), 'From your EPC');
    // The customer's own choice is never replaced; a card still pre-filled is.
    var mine = { key: 'stone', u: '', notes: '', src: 'you' };
    assert.deepStrictEqual(di.fillPrefill(mine, { kind: 'epc', key: 'cavity_filled', u: '' }).key, 'stone');
    assert.strictEqual(di.fillPrefill(age, { kind: 'epc', key: 'cavity_filled', u: '' }).key, 'cavity_filled');
    // A pre-filled card the customer then changed (the fingerprint no longer matches) is theirs.
    assert.strictEqual(di.cardSource({ key: 'stone', u: '', src: age.src }), 'you');
    assert.strictEqual(line({ key: 'cavity_filled', u: '0.4', src: epc.src }), 'Cavity, filled · U 0.4 (customer)');
    assert.strictEqual(di.sourceTag({ key: 'stone', src: 'you' }), 'You chose this');
});

// ---------------------------------------------------------------- EPC mapping (§B9)

test('EPC mapping: per element; several entries -> the first that maps (amendment 4), the notes all of them; the U-value; ' +
    'windows absent; the age band year', function () {
        assert.deepStrictEqual(di.epcElement('Cavity wall, filled cavity', EPCMAP, 'walls'),
            { key: 'cavity_filled', u: '', text: 'Cavity wall, filled cavity', notes: 'EPC: Cavity wall, filled cavity',
                missing: false, mixed: false, matched: true });
        assert.strictEqual(di.epcElement('Solid brick, as built, no insulation (assumed)', EPCMAP, 'walls').key, 'solid_brick');
        assert.strictEqual(di.epcElement('Fully double glazed', EPCMAP, 'windows').key, 'double_02');
        assert.strictEqual(di.epcElement('Pitched, 150 mm loft insulation', EPCMAP, 'roof').key, 'mm150', 'not "50 mm"');
        assert.strictEqual(di.epcElement('Pitched, 250 mm loft insulation', EPCMAP, 'roof').key, 'mm200');
        assert.strictEqual(di.epcElement('Suspended, no insulation (assumed)', EPCMAP, 'floor').key, 'susp_unins');
        var mixed = di.epcElement('Cavity wall, filled cavity; Timber frame, as built, no insulation (assumed)', EPCMAP, 'walls');
        // Amendment 4 §5: the first entry (the main building) sets the card, not Not sure.
        assert.deepStrictEqual([mixed.key, mixed.mixed], ['cavity_filled', true]);
        assert.ok(mixed.text.indexOf('Timber frame') > 0);
        var same = di.epcElement('Solid, no insulation (assumed); Solid, no insulation (assumed)', EPCMAP, 'floor');
        assert.strictEqual(same.key, 'solid_unins', 'agreeing entries');
        var u = di.epcElement('Average thermal transmittance 0.28 W/m²K', EPCMAP, 'walls');
        assert.deepStrictEqual([u.key, u.u, u.mixed, u.matched], ['unsure', '0.28', false, true]);
        assert.strictEqual(di.uFromEpcText('Average thermal transmittance 9 W/m2K'), '', 'out of range');
        assert.deepStrictEqual(di.epcElement(null, EPCMAP, 'windows'), { key: 'unsure', u: '', text: '',
            notes: 'Not on your EPC.', missing: true, mixed: false, matched: false });
        assert.strictEqual(di.epcElement('Roof room(s), insulated (assumed)', EPCMAP, 'roof').key, 'unsure', 'not mapped');
        assert.strictEqual(di.ageBandKey('England and Wales: 1950-1966'), '1950');
        assert.strictEqual(di.ageBandKey('England and Wales: 1967-1975'), '1950');
        assert.strictEqual(di.ageBandKey('England and Wales: before 1900'), 'pre1920');
        assert.strictEqual(di.ageBandKey('England and Wales: 1900-1929'), 'pre1920', 'the start year');
        assert.strictEqual(di.ageBandKey('England and Wales: 1983-1990'), '1976');
        assert.strictEqual(di.ageBandKey('England and Wales: 2007 onwards'), '2003');
        assert.strictEqual(di.ageBandKey('England and Wales: 2012 onwards'), '2012');
        assert.strictEqual(di.ageBandKey('INVALID!'), 'unsure');
        assert.strictEqual(di.ageBandKey(null), 'unsure');
    });

// ---------------------------------------------------------------- the state: rq, old states

test('state: rq is read, written, merged and kept by stateTextGuarded; a v2 state with removed qids reads without error',
    function () {
        var p = di.parseState(JSON.stringify({ v: 2, s: { plans: { at: '2026-10-01T10:00Z', st: 'done' } },
            a: { plans_current: 'yes', hp_surround: 'x', bigfiles: 'no' }, n: ['w3w', 'year'], f: [], req: '', sent: '', task: '',
            rq: ['plans', 'BAD KEY', 7] }));
        assert.strictEqual(p.status, 'ok');
        assert.deepStrictEqual(p.state.rq, ['plans'], 'only step ids');
        assert.strictEqual(p.state.sections.plans.status, 'done', 'progress kept');
        assert.deepStrictEqual(di.unknownStateQids(p.state, parse(REGISTRY).questions).sort(),
            ['hp_surround', 'plans_current', 'w3w', 'year']);
        assert.deepStrictEqual(JSON.parse(di.stateText(p.state)).rq, ['plans']);
        assert.strictEqual(JSON.parse(di.stateText(di.emptyState())).rq, undefined, 'none: left out');
        // The size guard drops files, notes, answers — never rq.
        p.state.answers = {};
        for (var i = 0; i < 200; i++) { p.state.answers['q' + i] = 'xxxxxxxxxxxxxxxxxxxxxxx'; }
        var g = di.stateTextGuarded(p.state);
        assert.strictEqual(g.trimmed, true);
        assert.deepStrictEqual(JSON.parse(g.text).rq, ['plans']);
        // A request without rq (2.3, 2.3b): every allowed step.
        assert.deepStrictEqual(di.parseState(JSON.stringify({ v: 2, s: {} })).state.rq, []);
    });

// ---------------------------------------------------------------- the flow (the dashboard Suitelet)

var INS = { step: 'insulation', nav: 'stay', q_ptype: '2', q_market: '8', q_age: '2', q_has_ext: 'no', q_drawings: '0',
    q_ins_route_reno: '2' };

function merge(a, b) {
    var o = {};
    Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { o[k] = b[k]; });
    return o;
}

/** The selected option and the src of an element card in a page. */
/** Amendment 4: an element card's notes box in a page (unescaped). */
function notesIn(html, qid) {
    var m = new RegExp('name="q_' + qid + '_notes" value="([^"]*)"').exec(html);
    return m ? m[1].replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&') : null;
}

/** Amendment 4 §7: the last Note (on a Send, the one with the full answers). */
function lastNote(t) {
    return t.w.notes[t.w.notes.length - 1].values.note;
}

function cardIn(html, qid) {
    var seg = html.slice(html.indexOf('id="q-' + qid + '"'));
    seg = seg.slice(0, seg.indexOf('</fieldset>'));
    return { key: (seg.match(/<option value="([^"]*)" selected/) || [])[1] || '', src: (seg.match(/_src" value="([^"]*)"/) || [])[1],
        tag: (seg.match(/eltag"[^>]*>([^<]*)/) || [])[1], u: (seg.match(/_u" value="([^"]*)"/) || [])[1] };
}

test('POST with reveal: a hidden question\'s answer is ignored (not validated, written or noted); required only when ' +
    'revealed; progress counts the revealed only', function () {
    var t = v3.setup();
    // market new: age, has_ext and the renovation route are hidden; crafted answers to them are ignored, even invalid ones.
    v3.post(t, { step: 'insulation', nav: 'stay', q_market: '9', q_age: '99', q_ins_route_reno: '1', q_has_ext: 'maybe',
        q_ext1_what: 'Kitchen', q_ins_route_new: '1', q_drawings: '1', q_ceilings: '2.4 m', q_windows: 'Standard' });
    assert.ok(/saved=1/.test(t.redirect), 'no validation error for the hidden answers: ' + t.redirect);
    var vals = v3.oppWrites(t.w)[0].values;
    assert.strictEqual(vals.custbody_mis_opp_market, undefined, 'market 8 is held and kept (DI_FILL_REPLACEABLE lists none)');
    assert.strictEqual(vals.custbody15, undefined, 'age hidden: not written');
    assert.strictEqual(vals.custbody_pq_cylinder_location, 'Built to current Building Regulations',
        'the new-build route (revealed) is written; the renovation route\'s "Find my EPC" (hidden) is not');
    assert.strictEqual(t.w.notes[0].values.note.indexOf('Kitchen'), -1, 'not noted');
    // market 8 is kept (the fill rule) but the customer's answer drives the page: new build.
    var st = v3.state(t.w);
    assert.strictEqual(st.answers.market, '9', 'the declined answer is kept for the page');
    assert.strictEqual(st.answers.has_ext, undefined);
    // Required only when revealed: the insulation step is 'todo' — the new-build route answered, the element cards not yet.
    assert.strictEqual(st.sections.insulation.status, 'todo');
    var ok = v3.setup({ opp: { custbody_mis_opp_market: '' } });
    v3.post(ok, { step: 'insulation', nav: 'stay', q_ptype: '1', q_market: '9', q_drawings: '0', q_ins_route_new: '0' });
    // ptype, market, drawings, the route answered; sap_files (revealed by sap) is still needed.
    assert.strictEqual(v3.state(ok.w).sections.insulation.status, 'todo');
    var page = v3.step(ok, 'review');
    assert.ok(page.indexOf('Your SAP calculation') > 0, 'revealed: on Review');
    assert.strictEqual(page.indexOf('When was the main house built?'), -1, 'hidden: not on Review');
});

test('the no-JS markup has every reveal panel with its heading; the script hides the false ones', function () {
    var t = v3.setup();
    var html = v3.step(t, 'insulation');
    var q = parse(REGISTRY).questions.filter(function (x) { return x.section === 'insulation' && x.revealText; });
    q.forEach(function (x) {
        assert.ok(html.indexOf('id="rp-' + x.qid + '"') > 0, x.qid + ': its panel renders');
    });
    // Amendment 3: the flat's floor is on Your project.
    assert.ok(v3.step(t, 'project').indexOf('<p class="rvif">If you chose “Flat or apartment” to “What type of property is ' +
        'it?”</p>') > 0);
    assert.ok(html.indexOf('If you chose “Yes” to “Does the project include an extension?” and “Two” to “How many ' +
        'extensions?”') > 0);
    assert.ok(html.indexOf('.js .rvif{display:none}') > 0, 'with script on, the headings go');
    assert.ok(html.indexOf('data-reveal') > 0 && html.indexOf('ps[i].hidden=!ok') > 0, 'the script');
    // Amendment 3: the market is on Your project; a step with no reveal and no element card carries no reveal script.
    assert.ok(/<input type="radio" name="q_market" value="8" data-key="reno" checked>/.test(v3.step(t, 'project')),
        'pre-selected from the field');
    assert.strictEqual(v3.step(t, 'other').indexOf('ps[i].hidden=!ok'), -1);
});

test('@setting options: a List field writes the option id; validation rejects an id not in the setting', function () {
    var t = v3.setup();
    v3.post(t, { step: 'insulation', nav: 'stay', q_ptype: '6' });
    assert.strictEqual(v3.oppWrites(t.w)[0].values.custbodyopp_build_type, '6');
    assert.ok(t.w.notes[0].values.note.indexOf('What type of property is it?: — → Flat or apartment') > 0, 'the label in the Note');
    var u = v3.setup();
    var html = v3.post(u, { step: 'insulation', nav: 'stay', q_ptype: '17' });
    assert.strictEqual(u.w.submits.length, 0, 'nothing written');
    assert.ok(html.indexOf('Please choose one of the options shown.') > 0);
    // A literal choice still posts its index and writes its label (text field). Amendment 3: the age shows only for the
    // Typical route (index 2).
    v3.post(u, { step: 'insulation', nav: 'stay', q_ins_route_reno: '2', q_age: '6' });
    assert.strictEqual(v3.oppWrites(u.w)[0].values.custbody15, '2012 or later');
});

test('the fill rule (DI_FILL_REPLACEABLE): an empty field is written; a replaceable value (House) is replaced; any other ' +
    'is kept, and the Note and the Task say "customer says"', function () {
    var empty = v3.setup();
    v3.post(empty, { step: 'insulation', nav: 'stay', q_ptype: '2' });
    assert.strictEqual(v3.oppWrites(empty.w)[0].values.custbodyopp_build_type, '2');
    var house = v3.setup({ opp: { custbodyopp_build_type: '17', custbodyopp_build_type_text: 'House' } });
    v3.post(house, { step: 'insulation', nav: 'stay', q_ptype: '2' });
    assert.strictEqual(v3.oppWrites(house.w)[0].values.custbodyopp_build_type, '2');
    var held = v3.setup({ opp: { custbodyopp_build_type: '1', custbodyopp_build_type_text: 'Detached house' } });
    v3.post(held, { step: 'insulation', nav: 'stay', q_ptype: '2' });
    assert.strictEqual(v3.oppWrites(held.w)[0].values.custbodyopp_build_type, undefined, 'kept');
    assert.strictEqual(v3.state(held.w).answers.ptype, '2', 'the customer\'s answer kept for the page');
    assert.ok(held.w.notes[0].values.note.indexOf('What type of property is it?: Detached house → customer says Semi-detached; ' +
        'the opportunity holds Detached house (NOT changed)') > 0, held.w.notes[0].values.note);
    // Amendment 3: the property type is on Your project.
    assert.ok(/value="2" data-key="semi" checked/.test(v3.step(held, 'project')), 'the page shows the customer\'s answer');
    v3.post(held, { step: 'review', send: '1' });
    // Amendment 4 §7: the fill rule's line is in the Note (and the PDF), not the Task.
    var msg = lastNote(held);
    assert.ok(msg.indexOf('Customer says Semi-detached (What type of property is it?); the opportunity holds Detached house. ' +
        'Not changed') > 0, msg);
    // Market: no replaceable value — kept once set.
    var mk = v3.setup();
    v3.post(mk, { step: 'insulation', nav: 'stay', q_market: '9' });
    assert.strictEqual(v3.oppWrites(mk.w)[0].values.custbody_mis_opp_market, undefined);
    var mkEmpty = v3.setup({ opp: { custbody_mis_opp_market: '' } });
    v3.post(mkEmpty, { step: 'insulation', nav: 'stay', q_market: '9' });
    assert.strictEqual(v3.oppWrites(mkEmpty.w)[0].values.custbody_mis_opp_market, '9');
});

test('element cards: the typical route pre-fills empty cards from the age band; the customer\'s own card is kept; staff ' +
    'prose is shown and kept until the customer changes it', function () {
    var t = v3.setup({ opp: { custbody_existing_roofs_2026: 'Loft boarded, insulation unknown (site visit)' } });
    v3.post(t, merge(INS, { q_el_walls: '', q_el_windows: 'triple', q_el_windows_notes: 'new 2020', q_el_roof: '', q_el_floor: '' }));
    var vals = v3.oppWrites(t.w)[0].values;
    assert.strictEqual(vals.custbody_existing_walls_2026, 'Cavity, unfilled (before 1976) · U 1.6 (typical)');
    assert.strictEqual(vals.custbody_existing_windows_2026, 'Triple glazed · U 1.2 (preset) · notes: new 2020');
    assert.strictEqual(vals.custbody_existing_floors_2026, 'Solid concrete, uninsulated · U 0.7 (typical)');
    assert.strictEqual(vals.custbody_existing_roofs_2026, undefined, 'staff prose: the customer did not change the roof');
    assert.ok(t.w.notes[0].values.note.indexOf('Walls (existing): — → Cavity, unfilled (before 1976) · U 1.6 (typical)') > 0);
    var html = v3.step(t, 'insulation');
    assert.ok(html.indexOf('We have: Loft boarded, insulation unknown (site visit)') > 0);
    assert.deepStrictEqual([cardIn(html, 'el_walls').key, cardIn(html, 'el_walls').tag], ['cavity_unfilled_pre76',
        'Typical for 1950 – 1975']);
    assert.deepStrictEqual([cardIn(html, 'el_windows').key, cardIn(html, 'el_windows').tag], ['triple', 'You chose this']);
    // The roof, still prose, takes the band's value on the page (it is not the customer's choice) but nothing is written
    // until they save it; changing it writes old prose -> the new line.
    assert.strictEqual(cardIn(html, 'el_roof').key, 'mm100');
    v3.post(t, { step: 'insulation', nav: 'stay', q_el_roof: 'mm270', q_el_roof_src: 'you' });
    var last = v3.oppWrites(t.w).slice(-1)[0].values;
    assert.strictEqual(last.custbody_existing_roofs_2026, '270 mm or more · U 0.16 (preset)');
    assert.ok(t.w.notes.slice(-1)[0].values.note.indexOf('Roof (existing): Loft boarded, insulation unknown (site visit) → 270 ' +
        'mm or more · U 0.16 (preset)') > 0);
    // A source change alone is not a change: posting the walls card as EPC-sourced writes nothing for it.
    var n = v3.oppWrites(t.w).length;
    v3.post(t, { step: 'insulation', nav: 'stay', q_el_walls: 'cavity_unfilled_pre76', q_el_walls_src: 'epc:cavity_unfilled_pre76:' });
    assert.strictEqual(v3.oppWrites(t.w).length, n, 'nothing written');
    // Validation: a U-value out of range, "I'll describe it" without notes, typical on a new build.
    var e = v3.post(t, { step: 'insulation', nav: 'stay', q_el_walls: 'stone', q_el_walls_u: '9' });
    assert.ok(e.indexOf('A U-value is a number between 0.05 and 6 W/m²K') > 0);
    e = v3.post(t, { step: 'insulation', nav: 'stay', q_el_walls: 'describe', q_el_walls_notes: '' });
    assert.ok(e.indexOf('Please describe it in the notes.') > 0);
});

test('element cards: a new build -> the New fields (regs_new); a renovation\'s extension "Different" -> the New fields, ' +
    '"Extension N: "; two joined; "Same" writes nothing', function () {
    var nb = v3.setup({ opp: { custbody_mis_opp_market: '' } });
    v3.post(nb, { step: 'insulation', nav: 'stay', q_market: '9', q_ins_route_new: '1', q_el_walls: '', q_el_windows: '',
        q_el_roof: '', q_el_floor: '' });
    var vals = v3.oppWrites(nb.w)[0].values;
    assert.strictEqual(vals.custbody_new_walls_2026, 'Built to current Building Regulations · U 0.26 (regs)');
    assert.strictEqual(vals.custbody_new_roofs_2026, 'Built to current Building Regulations · U 0.16 (regs)');
    assert.strictEqual(vals.custbody_existing_walls_2026, undefined);
    var t = v3.setup({ opp: { custbody_new_walls_2026: 'Staff: rendered blockwork' } });
    // Choices post their option's index: ext_count '0' is One, '1' is Two.
    v3.post(t, merge(INS, { q_has_ext: 'yes', q_ext_count: '0', q_ext1_age: '0', q_ext1_walls_same: '1', q_ext1_walls: '',
        q_ext1_roof_same: '0', q_ext2_age: '1', q_ext2_walls_same: '1', q_ext2_walls: 'modern_12' }));
    vals = v3.oppWrites(t.w)[0].values;
    // ext_count 1 hides extension 2; extension 1 is being built now: its "Different" walls default to regs_ext. The staff
    // line in the New field is kept.
    assert.strictEqual(vals.custbody_new_walls_2026, 'Staff: rendered blockwork\nExtension 1: Built to current Building ' +
        'Regulations · U 0.18 (regs)');
    assert.strictEqual(vals.custbody_new_roofs_2026, undefined, '"Same as the main house" writes nothing');
    assert.ok(t.w.notes[0].values.note.indexOf('Extension 1 roof: — → Same as the main house') > 0);
    v3.post(t, { step: 'insulation', nav: 'stay', q_ext_count: '1', q_ext2_what: 'Garage conversion', q_ext2_age: '1',
        q_ext2_walls_same: '1', q_ext2_walls: 'modern_12', q_ext2_walls_src: 'you' });
    vals = v3.oppWrites(t.w).slice(-1)[0].values;
    assert.strictEqual(vals.custbody_new_walls_2026, 'Staff: rendered blockwork\nExtension 1: Built to current Building ' +
        'Regulations · U 0.18 (regs)\nExtension 2: Modern (2012 or later) · U 0.28 (preset)');
});

// ---------------------------------------------------------------- the EPC lookup (§B9)

var CERT = { certificateNumber: '1111-2222-3333-4444-5555', lodgementDate: '2021-11-19', currentEnergyRating: 'D',
    totalFloorArea: 112, constructionAgeBand: 'England and Wales: 1950-1966', wallsDescription: 'Cavity wall, filled cavity',
    windowsDescription: null, roofDescription: 'Pitched, 270 mm loft insulation',
    floorDescription: 'Solid, no insulation (assumed); Suspended, no insulation (assumed)', rawKeys: ['floors', 'walls', 'window'] };

function epcWorld(opp) {
    var t = v3.setup({ opp: opp });
    t.epc.searchResult = { ok: true, rows: [{ certificateNumber: '9999-8888-7777-6666-5555', address: '1 High St',
        postcode: 'SN1 1AA', registrationDate: '2023-02-01' }, { certificateNumber: '1111-2222-3333-4444-5555',
        address: '1 High St <b>', postcode: 'SN1 1AA', registrationDate: '2021-11-19' }], message: '', statusCode: 200 };
    t.epc.certResult = { ok: true, data: CERT, statusCode: 200 };
    return t;
}

test('EPC: Find my EPC saves the step, then lists the addresses (newest first); Use this certificate shows its summary and ' +
    'pre-fills the age and the four house cards', function () {
    var t = epcWorld();
    var html = v3.post(t, { step: 'insulation', nav: 'epc', epc_postcode: 'SN1 1AA', q_ins_route_reno: '1' });
    assert.strictEqual(t.redirect, '', 'the step is re-rendered, not redirected');
    assert.deepStrictEqual(t.epc.calls[0], ['search', 'SN1 1AA', 'tok-SECRET-123']);
    assert.strictEqual(v3.oppWrites(t.w)[0].values.custbody_pq_cylinder_location, 'Find my EPC', 'saved first, as a stay save');
    assert.ok(html.indexOf('<option value="9999-8888-7777-6666-5555">1 High St, SN1 1AA · certificate from 1 Feb 2023</option>' +
        '<option value="1111-2222-3333-4444-5555">1 High St &lt;b&gt;, SN1 1AA · certificate from 19 Nov 2021</option>') > 0,
        'escaped, in the library\'s order');
    assert.ok(html.indexOf('name="nav" value="epc_use"') > 0);
    html = v3.post(t, { step: 'insulation', nav: 'epc_use', epc_cert: '1111-2222-3333-4444-5555', epc_postcode: 'SN1 1AA' });
    assert.deepStrictEqual(t.epc.calls[1], ['certificate', '1111-2222-3333-4444-5555', 'tok-SECRET-123']);
    assert.ok(html.indexOf('<span class="epcr epcr-d" aria-label="Energy rating D">D</span>') > 0);
    assert.ok(html.indexOf('<dt>Valid until</dt><dd>19/11/2031</dd>') > 0, 'lodgement + 10 years');
    assert.ok(html.indexOf('<dt>Floor area</dt><dd>112 m²</dd>') > 0 && html.indexOf('England and Wales: 1950-1966') > 0);
    assert.ok(html.indexOf('<input type="hidden" name="epc_number" value="1111-2222-3333-4444-5555"><input type="hidden" ' +
        'name="epc_date" value="2021-11-19">') > 0, 'they ride until the step is saved');
    assert.ok(/name="q_age" value="2" data-key="1950" checked/.test(html), 'the age band, pre-filled');
    assert.deepStrictEqual(cardIn(html, 'el_walls'), { key: 'cavity_filled', src: 'epc:cavity_filled:', tag: 'From your EPC', u: '' });
    assert.deepStrictEqual(cardIn(html, 'el_roof').key, 'mm270');
    var floor = cardIn(html, 'el_floor');
    // Amendment 4 §5: two entries that disagree — the first (the main building) sets the card; the notes hold both.
    assert.deepStrictEqual([floor.key, floor.tag], ['solid_unins', 'From your EPC'], 'the first entry');
    assert.strictEqual(notesIn(html, 'el_floor'), 'EPC: Solid, no insulation (assumed); Suspended, no insulation (assumed)');
    assert.strictEqual(html.indexOf('Your certificate says'), -1, 'the notes say it');
    assert.deepStrictEqual([cardIn(html, 'el_windows').key, cardIn(html, 'el_windows').tag], ['unsure',
        'Not on your EPC: please check']);
    assert.strictEqual(notesIn(html, 'el_windows'), 'Not on your EPC.');
    assert.deepStrictEqual(v3.logs(t.w, 'DESIGNINFO_EPC_RAW_KEYS').map(function (l) { return [l[0], l[2]]; }),
        [['debug', 'Opportunity 20, certificate 1111-2222-3333-4444-5555: floors, walls, window']]);
    // Nothing written by the certificate POST itself (nothing changed in the step).
    assert.strictEqual(v3.oppWrites(t.w).length, 1);
    // The next save writes the EPC pair and the route with the certificate; the rating is never stored.
    v3.post(t, { step: 'insulation', nav: 'next', epc_number: '1111-2222-3333-4444-5555', epc_date: '2021-11-19',
        q_ins_route_reno: '1', q_age: '2', q_el_walls: 'cavity_filled', q_el_walls_src: 'epc:cavity_filled:', q_el_roof: 'mm270',
        q_el_roof_src: 'epc:mm270:', q_el_floor: 'unsure', q_el_floor_src: 'epc:unsure:', q_el_windows: 'double_02',
        q_el_windows_src: 'you' });
    var vals = v3.oppWrites(t.w)[1].values;
    assert.strictEqual(vals.custbody_epc_number, '1111-2222-3333-4444-5555');
    assert.ok(vals.custbody_epc_date instanceof Date);
    assert.strictEqual(vals.custbody_pq_cylinder_location, 'Find my EPC · EPC 1111-2222-3333-4444-5555, lodged 19/11/2021');
    assert.strictEqual(vals.custbody_existing_walls_2026, 'Cavity, filled · U 0.55 (EPC)');
    assert.strictEqual(vals.custbody_existing_floors_2026, 'Not sure');
    assert.strictEqual(vals.custbody_existing_windows_2026, 'Double glazed (2002 onwards) · U 2.0 (preset)'.replace('2.0', '2'));
    assert.strictEqual(JSON.stringify(t.w.submits).indexOf('"D"'), -1, 'the rating is never written');
    assert.strictEqual(JSON.stringify(t.w.logs).indexOf('tok-SECRET-123'), -1, 'the token is never logged');
    // Written once: the same certificate again is no change; an empty post never clears it.
    var n = v3.oppWrites(t.w).length;
    v3.post(t, { step: 'insulation', nav: 'stay', epc_number: '1111-2222-3333-4444-5555', epc_date: '2021-11-19' });
    v3.post(t, { step: 'insulation', nav: 'stay', epc_number: '', epc_date: '' });
    assert.strictEqual(v3.oppWrites(t.w).length, n);
    // Review shows the certificate held.
    assert.ok(v3.step(t, 'review').indexOf('Certificate 1111-2222-3333-4444-5555, valid until 19/11/2031') > 0);
});

test('EPC failures: no rows (a Scottish postcode), ok:false, an exception, an invalid number — the notice, nothing written',
    function () {
        var t = epcWorld({ custbody_pq_cylinder_location: 'Find my EPC' });
        t.epc.searchResult = { ok: true, rows: [], message: 'No EPC certificates found for this postcode', statusCode: 404 };
        var html = v3.post(t, { step: 'insulation', nav: 'epc', epc_postcode: 'KW1 4YT' });
        assert.ok(html.indexOf('No certificate found for that postcode. Choose ‘Typical for the age of my property’ or ‘I’ll ' +
            'describe it’ instead.') > 0);
        assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_EPC_NONE')[0][0], 'debug');
        assert.ok(/status 404/.test(v3.logs(t.w, 'DESIGNINFO_EPC_NONE')[0][2]));
        t.epc.searchResult = { ok: false, rows: [], message: 'Unauthorised', statusCode: 401 };
        assert.ok(v3.post(t, { step: 'insulation', nav: 'epc', epc_postcode: 'SN1 1AA' }).indexOf('No certificate found') > 0);
        t.epc.searchThrows = true;
        assert.ok(v3.post(t, { step: 'insulation', nav: 'epc', epc_postcode: 'SN1 1AA' }).indexOf('No certificate found') > 0);
        t.epc.certResult = { ok: false, message: 'gone', statusCode: 410 };
        assert.ok(v3.post(t, { step: 'insulation', nav: 'epc_use', epc_cert: '1111-2222-3333-4444-5555' })
            .indexOf('No certificate found') > 0);
        var before = t.epc.calls.length;
        assert.ok(v3.post(t, { step: 'insulation', nav: 'epc_use', epc_cert: '1111' }).indexOf('No certificate found') > 0);
        assert.strictEqual(t.epc.calls.length, before, 'an invalid number is never sent');
        assert.strictEqual(t.w.submits.length, 0, 'nothing written by any of them');
    });

test('EPC unavailable: no token, the library missing or too old — the question says so, CDB DESIGNINFO_EPC_UNAVAILABLE ' +
    'once, and the rest of the step works', function () {
    [{ settings: { EPC_BEARER_TOKEN: null }, why: /setting EPC_BEARER_TOKEN is empty/ },
        { epcLib: false, why: /epc_lib: could not be loaded: MODULE_DOES_NOT_EXIST/ },
        { epcLib: v3.fakeEpcLib('0.9.0'), why: /LIB_VERSION "0.9.0", 1.0.0 or later needed/ }].forEach(function (c) {
        var t = v3.setup({ settings: c.settings, epcLib: c.epcLib, opp: { custbody_pq_cylinder_location: 'Find my EPC' } });
        var html = v3.step(t, 'insulation');
        assert.ok(html.indexOf('We can’t look up certificates right now. Choose ‘Typical for the age of my property’ or ‘I’ll ' +
            'describe it’ instead.') > 0);
        assert.strictEqual(html.indexOf('name="epc_postcode"'), -1);
        assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_EPC_UNAVAILABLE').length, 1);
        assert.ok(c.why.test(v3.logs(t.w, 'DESIGNINFO_EPC_UNAVAILABLE')[0][2]), v3.logs(t.w, 'DESIGNINFO_EPC_UNAVAILABLE')[0][2]);
        html = v3.post(t, { step: 'insulation', nav: 'epc', epc_postcode: 'SN1 1AA', q_ptype: '1' });
        assert.strictEqual(v3.oppWrites(t.w)[0].values.custbodyopp_build_type, '1', 'the step still saves');
        assert.strictEqual(JSON.stringify(t.w.logs).indexOf('tok-SECRET-123'), -1);
    });
});

// ---------------------------------------------------------------- pictures (§B7)

test('pictures: ONE file search for every image on the step; absolute URLs; alt is the label, escaped; Review shows the ' +
    'label', function () {
    var t = v3.setup({ settings: { DI_PIC_BARRIER: JSON.stringify([{ id: '31', key: 'b1', label: 'Full view <&> "x"', file: '511' },
        { id: '32', key: 'b2', label: 'Partly hidden', file: '512' }]) } });
    var html = v3.step(t, 'heatpump');
    var fileSearches = t.w.searches.filter(function (d) { return d.type === 'file'; });
    assert.strictEqual(fileSearches.length, 1);
    assert.deepStrictEqual(fileSearches[0].filters, [['internalid', 'anyof', ['501', '502', '503', '511', '512']]]);
    assert.deepStrictEqual(fileSearches[0].columns, ['url']);
    assert.ok(html.indexOf('<img src="https://1234567.app.netsuite.com/core/media/media.nl?id=501&amp;c=1234567&amp;h=a" ' +
        'alt="1 surface" loading="lazy">') > 0);
    assert.ok(html.indexOf('alt="Full view &lt;&amp;&gt; &quot;x&quot;"') > 0, 'escaped');
    assert.ok(html.indexOf('<span class="ot">Full view &lt;&amp;&gt; &quot;x&quot;</span>') > 0);
    assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_PICTURE_MISSING').length, 0);
    v3.post(t, { step: 'heatpump', nav: 'stay', q_reflect: '22', q_barrier: '32', q_distance: '8.5' });
    var vals = v3.oppWrites(t.w)[0].values;
    assert.deepStrictEqual([vals.custbody37, vals.custbody36, vals.custbody29], ['22', '32', '8.5']);
    var rv = v3.step(t, 'review');
    assert.ok(rv.indexOf('<dd>2 surfaces</dd>') > 0 && rv.indexOf('<dd>Partly hidden</dd>') > 0);
    assert.strictEqual(rv.indexOf('<img'), -1);
    // Validation: only an id the setting lists; the distance a number above 0.
    var e = v3.post(t, { step: 'heatpump', nav: 'stay', q_reflect: '99' });
    assert.ok(e.indexOf('Please choose one of the options shown.') > 0);
    e = v3.post(t, { step: 'heatpump', nav: 'stay', q_distance: '0' });
    assert.ok(e.indexOf('Please give the distance in metres as a number, for example 8.5.') > 0);
});

test('pictures: a file not returned, or a failed search — the card without its image, one PICTURE_MISSING line; the ' +
    'question still works', function () {
    var t = v3.setup();
    delete t.w.fileUrls[502];
    var html = v3.step(t, 'heatpump');
    assert.strictEqual(html.indexOf('id=502'), -1);
    assert.ok(html.indexOf('<span class="ot">2 surfaces</span>') > 0 && /value="22" data-key="r2">/.test(html));
    assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_PICTURE_MISSING').length, 1);
    assert.ok(/file\(s\) 502 not found/.test(v3.logs(t.w, 'DESIGNINFO_PICTURE_MISSING')[0][2]));
    var u = v3.setup();
    u.w.fileSearchThrows = true;
    html = v3.step(u, 'heatpump');
    assert.strictEqual(html.indexOf('<img'), -1);
    assert.ok(html.indexOf('name="q_reflect"') > 0);
    assert.strictEqual(v3.logs(u.w, 'DESIGNINFO_PICTURE_MISSING').length, 1);
});

// ---------------------------------------------------------------- one list everywhere (§B3), the request page (§B4)

var SEND_ROWS = [{ id: '401', name: 'WON_STATUSES', value: '13' }, { id: '402', name: 'NEEDINFO_SUBSTATUS', value: '1' },
    { id: '406', name: 'DESIGN_SUBSTATUS', value: '1,4,5,13' }, { id: '403', name: 'PE_VALUEPROPS', value: '2,3' },
    { id: '404', name: 'FALLBACK_EMPLOYEE', value: '500' }];

/** The request page (cdb_sl_send_designinfo) on t's world: GET, or POST with params. */
function sendPage(t, method, params) {
    var out = { form: null };
    t.w.scriptId = 'customscript_cdb_sl_send_designinfo';
    if (!t.sendRows) {
        t.w.settings = t.w.settings.concat(SEND_ROWS);
        t.sendRows = true;
    }
    var p = { custpage_opp: '20' };
    Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    amd.load('cdb_sl_send_designinfo', t.s).onRequest({
        request: { method: method, parameters: method === 'POST' ? p : { opp: '20' } },
        response: { writePage: function (f) { out.form = f; }, setHeader: function () {}, write: function () {} }
    });
    t.w.scriptId = 'customscript_cdb_sl_dashboard';
    return out.form;
}

/** Amendment 2: the step tick boxes, from the one "Steps to ask for" block: [name, (title,) 'T'|'F']. */
function ticks(form, withTitle) {
    var html = field(form, 'custpage_steps').defaultValue;
    var out = [];
    var re = /<input type="checkbox" name="(custpage_step_[a-z0-9_]+)" value="T"( checked)?> ([^<]*)<\/label>/g;
    var m;
    while ((m = re.exec(html))) {
        out.push(withTitle ? [m[1], m[3], m[2] ? 'T' : 'F'] : [m[1], m[2] ? 'T' : 'F']);
    }
    return out;
}

function field(form, id) {
    return form.fields.filter(function (f) { return f.id === id; })[0];
}

function stateWith(rq, extra) {
    var s = { v: 2, s: {}, a: {}, f: [], req: '2026-10-01T09:00Z', sent: '', task: '', rq: rq };
    Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
    return JSON.stringify(s);
}

test('stepsFor: the SAME list on the stepper, Review, the request page, the request email and the card', function () {
    // Amendment 3: six steps — the request page's ticks are Heat loss, Heating and Heat pump.
    var rq = ['project', 'heating', 'other'];
    var t = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith(rq) } });
    var titles = ['Your project', 'Heating and controls', 'Anything else for your Project Engineer?'];
    // Amendment 2: the step bar shows the short labels; the email lists the long titles.
    var shorts = ['Your project', 'Heating', 'Anything else'];
    // The stepper's step bar (then Review).
    var bar = (v3.step(t, 'heating').match(/<span class="stitle">[^<]*<\/span>/g) || []).map(function (x) {
        return x.replace(/<[^>]+>/g, '');
    });
    assert.deepStrictEqual(bar, shorts.concat(['Review and send']), 'the stepper');
    assert.strictEqual(v3.step(t, 'insulation').indexOf('<h1 id="h-step">Understanding'), -1, 'not requested: not a step');
    var rv = (v3.step(t, 'review').match(/<h2 id="rv-[^"]+">[^<]*/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); });
    assert.deepStrictEqual(rv, titles, 'Review');
    // The request page: "will be asked about", and the ticks pre-ticked from rq.
    var form = sendPage(t, 'GET');
    assert.ok(form.fields[0].defaultValue.indexOf('<td style="padding:4px 0">' + titles.join(', ') + '</td>') > 0, 'the request page');
    assert.deepStrictEqual(ticks(form, true), [['custpage_step_insulation', 'Understanding the heat loss of your property', 'F'],
        ['custpage_step_heating', 'Heating and controls', 'T'], ['custpage_step_heatpump', 'Heat pump information required for MCS',
            'F']]);
    // The email, sent with those ticks.
    sendPage(t, 'POST', { custpage_step_heating: 'T' });
    var body = t.w.emails[0].body;
    titles.forEach(function (s, i) {
        assert.ok(body.indexOf('<b>' + (i + 1) + '</b>') > 0 && body.indexOf('<b>' + s + '</b>') > 0, 'the email: ' + s);
    });
    assert.strictEqual(body.indexOf('<b>Understanding the heat loss of your property</b>'), -1);
    assert.strictEqual(body.indexOf('<b>4</b>'), -1, 'three steps');
    // The card: "about N minutes" is the requested steps' minutes (3 + 2 + 1).
    var dash = v3.run(t, 'GET', { t: t.tok });
    assert.ok(dash.indexOf('It takes about 6 minutes, and you can do it in stages.') > 0);
    // In progress: only the requested steps count (a save of a step not requested makes no progress).
    t.w.opps[20].custbody_cdb_designinfo_state = stateWith(rq, { s: { insulation: { at: '2026-10-02T10:00Z', st: 'done' } } });
    dash = v3.run(t, 'GET', { t: t.tok });
    assert.ok(dash.indexOf('We need some information about your property') > 0, 'still "needs information"');
    t.w.opps[20].custbody_cdb_designinfo_state = stateWith(rq, { s: { heating: { at: '2026-10-02T10:00Z', st: 'done' } } });
    dash = v3.run(t, 'GET', { t: t.tok });
    // Amendment 3: Your project now has required questions (the property type, the market, plans changed), so it can be
    // "still to do".
    assert.ok(dash.indexOf('Thanks, we have: Heating and controls. Still to do: Your project.') > 0, dash.slice(dash.indexOf('Thanks'), dash.indexOf('Thanks') + 120));
});

test('the request page: a crafted tick for a ruled-out step is dropped; rq is stored with project and other, merged into ' +
    'the state and kept by the size guard; the next GET pre-ticks from it', function () {
    // A boiler only (Heat Source Type 10): no heat pump step.
    var t = v3.setup({ opp: { custbody_heat_source_type_26: ['10'], custbody_cdb_designinfo_state: stateWith([], {
        a: { has_ext: 'no' }, s: { plans: { at: '2026-10-01T10:00Z', st: 'done' } } }) } });
    var form = sendPage(t, 'GET');
    // Amendment 3: the ticks are Heat loss, Heating and Heat pump (no Plans).
    assert.deepStrictEqual(ticks(form), [['custpage_step_insulation', 'T'], ['custpage_step_heating', 'T']],
        'no earlier request: every step ticked; the heat pump step is not offered');
    sendPage(t, 'POST', { custpage_step_insulation: 'T', custpage_step_heatpump: 'T', custpage_step_bogus: 'T' });
    var st = v3.state(t.w);
    assert.deepStrictEqual(st.rq, ['project', 'insulation', 'other'], 'heatpump (ruled out) and bogus dropped');
    assert.deepStrictEqual(st.answers, { has_ext: 'no' }, 'merged');
    assert.strictEqual(st.sections.plans.status, 'done');
    assert.ok(v3.logs(t.w, 'DESIGNINFO_REQUESTED')[0][2].indexOf('asking about: Your project, Understanding the heat loss of ' +
        'your property, Anything else for your Project Engineer? (rq project,insulation,other)') > 0);
    form = sendPage(t, 'GET');
    assert.deepStrictEqual(ticks(form), [['custpage_step_insulation', 'T'], ['custpage_step_heating', 'F']], 'pre-ticked from rq');
    // Nothing ticked: project and other only (allowed), never "everything".
    sendPage(t, 'POST', {});
    assert.deepStrictEqual(v3.state(t.w).rq, ['project', 'other']);
    var bar = v3.step(t, 'project');
    assert.strictEqual(bar.indexOf('<span class="stitle">Plans</span>'), -1);
    // A 2.3 / 2.3b request (no rq): every allowed step on the page.
    var old = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith(undefined) } });
    assert.ok(v3.step(old, 'project').indexOf('<span class="stitle">Heat pump</span>') > 0);
});

test('fix the facts: shown when the heat source and the FC are empty or unmapped; "Update and recheck" writes only those ' +
    'fields, checked against their options, and redraws with the facts recalculated; Send stays separate', function () {
    var t = v3.setup({ opp: { custbody_heat_source_type_26: [], custbody_mi_heat_source: '', custbody_mi_opp_fc: '99' } });
    var form = sendPage(t, 'GET');
    assert.deepStrictEqual(['custpage_fix_heat26', 'custpage_fix_heat', 'custpage_fix_fc'].map(function (id) {
        return field(form, id) ? field(form, id).type : null;
    }), ['MULTISELECT', 'SELECT', 'SELECT']);
    assert.deepStrictEqual(field(form, 'custpage_fix_heat26').options, [{ value: '4', text: 'ASHP' }, { value: '7', text: 'GSHP loop' },
        { value: '10', text: 'Boiler' }], 'the field\'s own options');
    assert.ok(field(form, 'custpage_fix_go').defaultValue.indexOf('name="custpage_recheck" value="Update and recheck"') > 0);
    assert.strictEqual(form.submit, 'Send the email', 'Send is the form\'s own submit');
    // A value that is not one of the options: nothing written.
    form = sendPage(t, 'POST', { custpage_recheck: 'Update and recheck', custpage_fix_fc: '666' });
    assert.strictEqual(t.w.submits.length, 0);
    assert.ok(form.fields[0].defaultValue.indexOf('Nothing was changed: a value was not one of the field') > 0);
    // The real thing: the multi-select (\u0005-joined, as NetSuite posts it) and the FC; the empty Sales MI heat source left.
    t.w.units = 0;
    form = sendPage(t, 'POST', { custpage_recheck: 'Update and recheck', custpage_fix_heat26: '4\u000510', custpage_fix_heat: '',
        custpage_fix_fc: '12', custpage_step_heating: 'T' });
    t.recheckUnits = t.w.units;
    assert.strictEqual(t.w.submits.length, 1);
    assert.deepStrictEqual(t.w.submits[0].values, { custbody_heat_source_type_26: ['4', '10'], custbody_mi_opp_fc: '12' });
    assert.strictEqual(t.w.emails.length, 0, 'no email');
    assert.strictEqual(t.w.opps[20].custbody_cdb_designinfo_state, '', 'the state untouched');
    assert.ok(form.fields[0].defaultValue.indexOf('Updated. The facts below are recalculated.') > 0);
    assert.strictEqual(field(form, 'custpage_fix_fc'), undefined, 'recalculated: nothing left to fix');
    assert.ok(form.fields[0].defaultValue.indexOf('Your project, Understanding the heat loss of your property, Heating and controls, Heat pump information required for MCS') > 0, 'the heat pump step now');
    assert.ok(v3.logs(t.w, 'DESIGNINFO_FACTS_UPDATED').length === 1);
    // The customer page's deny-list is unchanged: the three facts fields can never be written from it.
    ['custbody_heat_source_type_26', 'custbody_mi_heat_source', 'custbody_mi_opp_fc'].forEach(function (f) {
        assert.ok(config.DESIGNINFO_DENY.indexOf(f) >= 0, f);
        assert.ok(config.FACTS_FIX_FIELDS.indexOf(f) >= 0, f);
    });
    var data = amd.load('lib/cdb_lib_data', t.s);
    assert.throws(function () { data.writeFacts('20', { custbody15: '1' }); }, /CDB_BAD_FACTS_WRITE/);
    assert.throws(function () { data.writeDesignInfo('20', { custbody_heat_source_type_26: ['4'] }); }, /CDB_BAD_DESIGNINFO_WRITE/);
    // Mapped facts: no form.
    var ok = v3.setup();
    assert.strictEqual(field(sendPage(ok, 'GET'), 'custpage_fix_fc'), undefined);
    assert.strictEqual(field(sendPage(ok, 'GET'), 'custpage_fix_heat26'), undefined);
});

// ---------------------------------------------------------------- the Task, old states

test('the Task: the extension line, the EPC used, the heat warnings; revealed answers only', function () {
    var t = v3.setup({ opp: { custbody_value_proposition: '2', custbody_heat_source_type_26: ['10'], custbody_epc_number:
        '1111-2222-3333-4444-5555', custbody_epc_date: '2021-11-19' } });
    v3.post(t, merge(INS, { q_has_ext: 'yes', q_ext_count: '0', q_ext1_what: 'Kitchen extension', q_ext1_age: '0',
        q_ext1_marked: 'yes', q_ext1_where: 'Should be ignored: hidden', q_ext1_walls_same: '0' }));
    assert.strictEqual(t.w.notes[0].values.note.indexOf('Should be ignored'), -1);
    v3.post(t, { step: 'review', send: '1' });
    // Amendment 4 §7: these lines moved from the Task to the Send's Note (and the PDF).
    var msg = lastNote(t);
    assert.strictEqual(t.w.tasks[0].values.message.indexOf('Extension 1: Kitchen extension'), -1);
    // Amendment 1: "what is it" is kept in the state, so the line always has it.
    assert.ok(msg.indexOf('Extension 1: Kitchen extension, Being built now, marked on plans') > 0, msg);
    assert.ok(msg.indexOf('EPC used: certificate 1111-2222-3333-4444-5555, lodged 19/11/2021, valid until 19/11/2031.') > 0);
    assert.ok(msg.indexOf('- Check: HP Design but no heat pump in Heat Source Type.') > 0);
    assert.ok(msg.indexOf('- Check: The design service is HP Design, but the heat source is not a Nu-Heat heat pump.') > 0);
    assert.strictEqual(msg.indexOf('Where is it, and which rooms'), -1, 'hidden: not in the snapshot');
    assert.ok(msg.indexOf('Extension 1 walls: Same as the main house') > 0);
});

test('old state: a 2.3b state with removed qids and the plans step reads without error; its progress is kept; logged once', function () {
    var t = v3.setup({ opp: { custbody_cdb_designinfo_state: JSON.stringify({ v: 2, s: { plans: { at: '2026-10-01T10:00Z',
        st: 'done' }, project: { at: '2026-10-01T10:00Z', st: 'opt' } }, a: { plans_current: 'yes', bigfiles: 'no' },
        n: ['w3w', 'year', 'walls_ex'], f: [{ q: 'plans_files', id: '901', n: 'QR20_plans.pdf', at: '2026-10-01T10:00Z' }],
        req: '2026-09-30T10:00Z', sent: '', task: '' }) } });
    // Amendment 3: the plans step is gone — its saved progress is ignored and logged with the qids.
    var html = v3.step(t, 'project');
    assert.ok(html.indexOf('<h1 id="h-step">Your project</h1>') > 0);
    assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN').length, 1);
    assert.ok(/plans_current, w3w, year, walls_ex, plans \(step\)/.test(v3.logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN')[0][2]),
        v3.logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN')[0][2]);
    var dash = v3.run(t, 'GET', { t: t.tok });
    assert.ok(dash.indexOf('In progress') > 0 && dash.indexOf('Thanks, we have: Your project. Still to ' +
        'do: Understanding the heat loss of your property, Heating and controls, Heat pump information required for MCS.') > 0,
        'progress kept');
});

// ---------------------------------------------------------------- governance (modelled)

test('governance, modelled with NetSuite\'s documented unit costs (test/helpers/netsuite.js UNITS)', function (tc) {
    var m = {};
    var t = epcWorld();
    // Each request is a new script execution: fresh modules, so nothing is cached from the request before.
    function measure(name, fn) {
        t.sl = amd.load('cdb_sl_dashboard', t.s);
        t.w.units = 0;
        fn();
        m[name] = t.w.units;
    }
    measure('step 3 GET', function () { v3.step(t, 'insulation'); });
    measure('step 3 save (element cards)', function () {
        v3.post(t, merge(INS, { q_el_walls: '', q_el_windows: 'triple', q_el_roof: '', q_el_floor: '' }));
    });
    measure('EPC search POST', function () { v3.post(t, { step: 'insulation', nav: 'epc', epc_postcode: 'SN1 1AA' }); });
    measure('EPC certificate POST', function () {
        v3.post(t, { step: 'insulation', nav: 'epc_use', epc_cert: '1111-2222-3333-4444-5555' });
    });
    var p = v3.setup();
    t = p;
    measure('step 5 GET (pictures)', function () { v3.step(p, 'heatpump'); });
    var f = v3.setup({ opp: { custbody_heat_source_type_26: [], custbody_mi_heat_source: '', custbody_mi_opp_fc: '99' } });
    t = f;
    measure('request page GET (facts form)', function () { sendPage(f, 'GET'); });
    measure('request page Update and recheck', function () {
        sendPage(f, 'POST', { custpage_recheck: 'Update and recheck', custpage_fix_fc: '12', custpage_fix_heat26: '4' });
    });
    measure('request page Send', function () { sendPage(f, 'POST', { custpage_step_plans: 'T' }); });
    Object.keys(m).forEach(function (k) { tc.diagnostic(k + ': ' + m[k] + ' units'); });
    // A Suitelet has 1,000 units: every one of these is far inside it.
    Object.keys(m).forEach(function (k) { assert.ok(m[k] > 0 && m[k] < 200, k + ': ' + m[k]); });
});

test('element cards: a save of another step never fills or writes a card (the route is typical, the cards empty)', function () {
    var t = v3.setup({ opp: { custbody_pq_cylinder_location: 'Typical for the age of my property', custbody15: '1950 – 1975' } });
    t.w.units = 0;
    v3.post(t, { step: 'plans', nav: 'next', q_unheated: 'Garage' });
    var vals = v3.oppWrites(t.w)[0].values;
    assert.deepStrictEqual(Object.keys(vals).sort(), ['custbody_cdb_designinfo_state', 'custbody_unheated_areas']);
    assert.strictEqual(t.w.unitLog.filter(function (k) { return k === 'fileLoad'; }).length, 1, 'the registry only: no ' +
        'presets or age bands for a step without cards');
});

// ---------------------------------------------------------------- 2.3c amendment 1

test('A1. `when` negation: key!=v1,v2 holds when the facts hold none of them; the cylinder is asked once for a hybrid',
    function () {
        var w = di.parseWhen('heat!=nuheat_hp,user_hp;service=hp');
        assert.deepStrictEqual(w.clauses, [{ key: 'heat', values: ['nuheat_hp', 'user_hp'], not: true },
            { key: 'service', values: ['hp'], not: false }]);
        assert.strictEqual(di.whenMatches(w, { heat: ['boiler'], service: 'hp' }), true);
        assert.strictEqual(di.whenMatches(w, { heat: ['boiler', 'user_hp'], service: 'hp' }), false);
        assert.strictEqual(di.whenMatches('fc!=hp', { fc: ['solid', 'hp'] }), false);
        assert.strictEqual(di.parseWhen('heat!=gas').ok, false, 'values are still checked');
        var qs = parse(REGISTRY).questions;
        function shown(heat, hp) {
            return di.visibleQuestions(qs, { service: 'hp', fc: ['solid'], heat: heat, hp: hp }).map(function (q) { return q.qid; });
        }
        var hybrid = shown(['boiler', 'nuheat_hp'], ['unknown']);
        assert.ok(hybrid.indexOf('cyl') >= 0 && hybrid.indexOf('cyl_plan') >= 0, '{nuheat_hp, boiler}: the heat pump step asks');
        assert.strictEqual(hybrid.indexOf('cylinder'), -1, '{nuheat_hp, boiler}: not the heating step');
        var boiler = shown(['boiler'], []);
        assert.ok(boiler.indexOf('cylinder') >= 0, '{boiler}: the heating step asks');
        assert.strictEqual(boiler.indexOf('cyl'), -1);
    });

test('A1. the request email\'s time: the asked steps\' minutes summed, as the card; none: no time', function () {
    var t = v3.setup();
    sendPage(t, 'POST', { custpage_step_plans: 'T' });
    assert.ok(t.w.emails[0].body.indexOf('Your plans and a few details are all we need to begin. About 4 minutes.') > 0,
        'project 1 + plans 2 + other 1');
    var render = amd.load('lib/cdb_lib_render', {});
    var html = render.designInfoRequestEmail({ customerName: 'A', opp: {}, sender: {}, askList: [], minutes: 0 });
    assert.ok(html.indexOf('Your plans and a few details are all we need to begin.<') > 0 ||
        /all we need to begin\.<\/font>/.test(html), 'no time');
    assert.strictEqual(html.indexOf('minute'), -1);
    assert.ok(render.designInfoRequestEmail({ customerName: 'A', opp: {}, sender: {}, askList: [], minutes: 1 })
        .indexOf('About 1 minute.') > 0);
});

test('A1. ext<N>_what is kept in the state (clipped at 200), not only in the Note', function () {
    var q = byQid(parse(REGISTRY).questions);
    assert.strictEqual(q.ext1_what.store, 'state');
    assert.strictEqual(q.ext2_what.store, 'state');
    var t = v3.setup();
    var long = new Array(30).join('Kitchen ');
    v3.post(t, merge(INS, { q_has_ext: 'yes', q_ext_count: '0', q_ext1_what: long }));
    var kept = v3.state(t.w).answers.ext1_what;
    assert.strictEqual(kept.length, 200);
    assert.strictEqual(kept.slice(-1), '…');
    var n = t.w.notes.length;
    v3.post(t, { step: 'insulation', nav: 'stay', q_ext1_what: long });
    assert.strictEqual(t.w.notes.length, n, 'the same long answer again is no change');
    assert.ok(v3.step(t, 'insulation').indexOf('value="' + kept.replace(/&/g, '&amp;') + '"') > 0, 'shown again');
});

test('A1. another home above or below: presets of U 0 ("U 0.00"), mapped from the EPC; the exact U box keeps 0.05',
    function () {
        assert.deepStrictEqual(di.presetOf(PRESETS, 'roof', 'dwelling_above'), { key: 'dwelling_above',
            label: 'Another home above (no heat loss through it)', u: '0' });
        assert.strictEqual(di.presetOf(PRESETS, 'floor', 'dwelling_below').u, '0');
        ['Pitched, 100 mm loft insulation; (another dwelling above)', '(other premises above)'].forEach(function (x, i) {
            // Amendment 4 §5: the first entry that maps.
            assert.strictEqual(di.epcElement(x, EPCMAP, 'roof').key, i ? 'dwelling_above' : 'mm100', x);
        });
        assert.strictEqual(di.epcElement('(another dwelling above)', EPCMAP, 'roof').key, 'dwelling_above');
        assert.strictEqual(di.epcElement('(another dwelling below)', EPCMAP, 'floor').key, 'dwelling_below');
        assert.strictEqual(di.epcElement('(other premises below)', EPCMAP, 'floor').key, 'dwelling_below');
        var line = di.elementLine(di.composeElement({ key: 'dwelling_below', u: '', src: 'you' },
            { presets: PRESETS, element: 'floor' }));
        assert.strictEqual(line, 'Another home below (no heat loss through it) · U 0.00 (preset)');
        assert.deepStrictEqual(di.parseElementLine(line).u, '0');
        assert.strictEqual(di.sameElement(line, line.replace('0.00', '0')), true);
        assert.strictEqual(di.parsePresets('element,key,label,u\nwalls,x,X,-1\nwalls,y,Y,0\n').rejected.length, 1);
        var t = v3.setup();
        assert.ok(v3.step(t, 'insulation').indexOf('Another home below (no heat loss through it) — about U 0.00</option>') > 0);
        var e = v3.post(t, merge(INS, { q_el_floor: 'solid_unins', q_el_floor_u: '0' }));
        assert.ok(e.indexOf('A U-value is a number between 0.05 and 6') > 0, 'the exact U box: 0.05 minimum');
        v3.post(t, merge(INS, { q_el_floor: 'dwelling_below', q_el_floor_src: 'you' }));
        assert.strictEqual(v3.oppWrites(t.w)[0].values.custbody_existing_floors_2026,
            'Another home below (no heat loss through it) · U 0.00 (preset)');
    });

// ---------------------------------------------------------------- 2.3c amendment 2: the page script

var vm = require('vm');

function scriptsOf(html) {
    var out = [];
    var re = /<script>([\s\S]*?)<\/script>/g;
    var m;
    while ((m = re.exec(html))) {
        out.push(m[1]);
    }
    return out;
}

test('A2. every inline script parses (vm.Script), on every step and Review, for HP and UFH, an extension and a new build',
    function () {
        var worlds = [
            ['HP Design, ASHP, renovation', {}],
            ['UFH Design, boiler', { custbody_value_proposition: '1', custbody_heat_source_type_26: ['10'] }],
            ['an extension', { custbody_cdb_designinfo_state: JSON.stringify({ v: 2, s: {}, a: { has_ext: 'yes', ext_count: 'Two',
                ext1_walls_same: 'Different' }, f: [], req: '', sent: '', task: '' }), custbody15: '1950 – 1975',
                custbody_pq_cylinder_location: 'Typical for the age of my property' }],
            ['a new build', { custbody_mis_opp_market: '9', custbody_pq_cylinder_location: 'Built to current Building Regulations' }]
        ];
        var parsed = 0;
        worlds.forEach(function (wv) {
            var t = v3.setup({ opp: wv[1] });
            // Amendment 5: and the thank-you page (Review when nothing was sent; see the A5 tests for a sent one).
            ['project', 'insulation', 'heating', 'heatpump', 'other', 'review', 'thanks'].forEach(function (id) {
                var html = v3.step(t, id);
                scriptsOf(html).forEach(function (body) {
                    assert.doesNotThrow(function () { new vm.Script(body); }, wv[0] + ', ' + id);
                    parsed += 1;
                });
            });
            scriptsOf(v3.run(t, 'GET', { t: t.tok })).forEach(function (body) { new vm.Script(body); parsed += 1; });
            // Amendment 5: after a Send, the thank-you page carries no inline script at all.
            v3.post(t, { step: 'review', send: '1' });
            assert.strictEqual(scriptsOf(v3.step(t, 'thanks')).length, 0, wv[0] + ', thanks');
        });
        assert.ok(parsed > 20, parsed + ' scripts parsed');
    });

/**
 * A tiny DOM for the reveal script: the form, its radios (name, value, data-key, checked) and its reveal panels (id,
 * data-reveal, hidden), read from the rendered HTML. Amendment 3: and the sections (className, their direct-child questions
 * and panels, each with its className), so cards() runs. Selectors the script uses that it does not model match nothing.
 */
function tinyDom(html) {
    function unesc(x) {
        return x.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
    function attrs(tag) {
        var a = {};
        var re = /([a-z-]+)(?:="([^"]*)")?/g;
        var m;
        tag = tag.replace(/^<[a-z]+/, '');
        while ((m = re.exec(tag))) {
            a[m[1]] = m[2] === undefined ? '' : unesc(m[2]);
        }
        return a;
    }
    function el(a) {
        return { attrs: a, hidden: false, checked: a.hasOwnProperty('checked'), value: a.value || '', name: a.name || '',
            className: a['class'] || '', getAttribute: function (n) { return a.hasOwnProperty(n) ? a[n] : null; } };
    }
    var listeners = [];
    var form = { addEventListener: function (type, fn) { if (type === 'change') { listeners.push(fn); } } };
    var inputs = (html.match(/<input [^>]*>/g) || []).map(function (tag) { return el(attrs(tag)); });
    var panels = (html.match(/<div class="(?:first )?rvp"[^>]*>/g) || []).map(function (tag) { return el(attrs(tag)); });
    inputs.concat(panels).forEach(function (x) { x.parentNode = form; });
    // The sections, and their direct-child divs (a panel is the same object as in panels).
    var sections = (html.match(/<section [^>]*>[\s\S]*?<\/section>/g) || []).map(function (sec) {
        var head = /^<section [^>]*>/.exec(sec)[0];
        var out = { className: attrs(head)['class'] || '', children: [] };
        var re = /<div [^>]*>|<\/div>/g;
        var depth = 0;
        var m;
        while ((m = re.exec(sec))) {
            if (m[0] === '</div>') {
                depth -= 1;
            } else {
                if (depth === 0) {
                    var a = attrs(m[0]);
                    out.children.push(panels.filter(function (p) { return a.id && p.attrs.id === a.id; })[0] || el(a));
                }
                depth += 1;
            }
        }
        return out;
    });
    form.querySelectorAll = function (sel) {
        var m = /^input\[name='([^']+)'\]$/.exec(sel);
        if (sel === '[data-reveal]') {
            return panels;
        }
        if (sel === 'section') {
            return sections;
        }
        if (m) {
            return inputs.filter(function (x) { return x.name === m[1]; });
        }
        return [];
    };
    var doc = {
        getElementById: function (id) {
            if (id === 'diform') {
                return form;
            }
            return panels.filter(function (p) { return p.attrs.id === id; })[0] || null;
        },
        documentElement: { className: '' },
        querySelectorAll: function () { return []; },
        querySelector: function () { return null; },
        createElement: function () { return {}; }
    };
    return { document: doc, window: { JSON: JSON }, JSON: JSON, form: form, inputs: inputs, sections: sections,
        section: function (id) {
            return sections.filter(function (sc) {
                return sc.children.some(function (c) { return c.attrs.id === id; });
            })[0];
        }, panel: function (qid) {
        return panels.filter(function (p) { return p.attrs.id === 'rp-' + qid; })[0];
    }, choose: function (name, value) {
        inputs.forEach(function (x) { if (x.name === name) { x.checked = x.value === value; } });
        listeners.forEach(function (fn) { fn({ target: inputs.filter(function (x) { return x.name === name && x.checked; })[0] }); });
    } };
}

/** Amendment 3: run every inline script of a page against a tinyDom of it. */
function runPage(html) {
    var dom = tinyDom(html);
    scriptsOf(html).forEach(function (body) {
        vm.runInNewContext(body, { document: dom.document, window: dom.window, JSON: JSON });
    });
    return dom;
}

test('A2. the reveal script runs: rp-flat_floor hidden until ptype=flat; market and extension panels follow the answers',
    function () {
        // Amendment 3: the property type and the market are on Your project; a reveal on them from Heat loss is decided by the
        // server (a fixed clause), the rest by the script.
        var t = v3.setup();
        var dom = runPage(v3.step(t, 'project'));
        assert.strictEqual(dom.panel('flat_floor').hidden, true, 'no property type: hidden');
        dom.choose('q_ptype', '2');
        assert.strictEqual(dom.panel('flat_floor').hidden, true, 'semi-detached: still hidden');
        dom.choose('q_ptype', '6');
        assert.strictEqual(dom.panel('flat_floor').hidden, false, 'flat: shown');
        dom = runPage(v3.step(t, 'insulation'));
        assert.strictEqual(dom.panel('ins_route_reno').hidden, false, 'Renovation is stored: the renovation route');
        assert.strictEqual(dom.panel('ins_route_new').hidden, true);
        assert.strictEqual(dom.panel('age').hidden, true, 'amendment 3: the age only for the Typical route');
        assert.strictEqual(dom.panel('has_ext').hidden, false, 'Renovation: the extension question');
        assert.strictEqual(dom.panel('ext_count').hidden, true, 'no extension answer: hidden');
        dom.choose('q_ins_route_reno', '2');
        assert.strictEqual(dom.panel('age').hidden, false, 'Typical: the age shows');
        dom.choose('q_ins_route_reno', '1');
        assert.strictEqual(dom.panel('age').hidden, true, 'EPC: no age');
        dom.choose('q_has_ext', 'yes');
        assert.strictEqual(dom.panel('ext_count').hidden, false);
        assert.strictEqual(dom.panel('ext1_what').hidden, false);
        assert.strictEqual(dom.panel('ext2_what').hidden, true, 'one extension until Two');
        dom.choose('q_ext_count', '1');
        assert.strictEqual(dom.panel('ext2_what').hidden, false);
        dom.choose('q_has_ext', 'no');
        assert.strictEqual(dom.panel('ext1_what').hidden, true, 'the cascade');
        assert.strictEqual(dom.panel('ext2_what').hidden, true);
        // A new build: the server sends the market clause false.
        var nb = runPage(v3.step(v3.setup({ opp: { custbody_mis_opp_market: '9' } }), 'insulation'));
        assert.strictEqual(nb.panel('ins_route_new').hidden, false);
        assert.strictEqual(nb.panel('ins_route_reno').hidden, true);
        assert.strictEqual(nb.panel('has_ext').hidden, true, 'new build: no extension question');
        assert.strictEqual(nb.panel('ext_info').hidden, true);
    });

test('A2. the step bar and Review\'s prompts use the short labels; the element cards; the route tiles; hot water',
    function () {
        var t = v3.setup({ opp: { custbody_pq_cylinder_location: 'Typical for the age of my property', custbody15: '1991 – 2002' } });
        var html = v3.step(t, 'insulation');
        assert.deepStrictEqual((html.match(/<span class="stitle">[^<]*/g) || []).map(function (x) {
            return x.replace('<span class="stitle">', '');
        }),
            ['Your project', 'Heat loss', 'Heating', 'Heat pump', 'Anything else', 'Review and send']);
        assert.ok(html.indexOf('<h1 id="h-step">Understanding the heat loss of your property</h1>') > 0, 'the long title stays');
        // The element cards: a grid, the title, the tag as a chip under it, "Which is closest?".
        assert.ok(html.indexOf('<section class="card elgrid">') > 0);
        assert.ok(/<legend class="eltitle">Walls<span class="req">Needed<\/span><\/legend><span class="chip chip-optional eltag" aria-live="polite">Typical for 1991 – 2002<\/span>/
            .test(html));
        assert.ok(html.indexOf('<label class="lbl" for="di-el_windows">Which is closest?</label>') > 0);
        assert.strictEqual(html.indexOf('What is it made of?'), -1);
        // The dropdown: Not sure and I'll describe it; no Typical for the age; no Regs on a house card; a card pre-filled
        // with a typical U shows that one entry.
        var walls = html.slice(html.indexOf('id="di-el_walls"'), html.indexOf('</select>', html.indexOf('id="di-el_walls"')));
        assert.ok(walls.indexOf('value="unsure"') > 0 && walls.indexOf('value="describe"') > 0);
        assert.strictEqual(walls.indexOf('value="typical"'), -1);
        assert.strictEqual(walls.indexOf('value="regs"'), -1);
        var floor = html.slice(html.indexOf('id="di-el_floor"'), html.indexOf('</select>', html.indexOf('id="di-el_floor"')));
        assert.ok(floor.indexOf('<option value="typical" selected>Typical for 1991 – 2002 — about U 0.45</option>') > 0, floor);
        // The route tiles: 2 x 2, in the design order.
        assert.ok(html.indexOf('[data-role=route] .opts{grid-template-columns:1fr 1fr}') > 0);
        var route = html.slice(html.indexOf('name="q_ins_route_reno"') - 200);
        assert.deepStrictEqual((route.slice(0, route.indexOf('</fieldset>')).match(/<span class="ot">[^<]*/g) || []).map(function (x) {
            return x.slice(17);
        }), ['Upload my SAP calculation', 'Find my EPC', 'Typical for the age of my property', 'I&#39;ll describe it']);
        // An extension's "Different" card offers Regs.
        var ext = html.slice(html.indexOf('id="di-ext1_walls"'), html.indexOf('</select>', html.indexOf('id="di-ext1_walls"')));
        assert.ok(ext.indexOf('value="regs"') > 0);
        // Hot water: the line, then the optional question; not answered, it is not on Review.
        var hp = v3.step(t, 'heatpump');
        assert.ok(hp.indexOf('We size your hot water from the number of bedrooms we hold for your home') > 0);
        assert.ok(hp.indexOf('<textarea class="inp" id="di-dhw" name="q_dhw"') > 0, 'a question, not read-only');
        var rv = v3.step(t, 'review');
        assert.strictEqual(rv.indexOf('Any specific hot water needs?'), -1, 'optional, not answered: left out');
        // Amendment 3: Your project has required questions now (the property type, the market, plans changed), so it can
        // be "Go to Your project".
        assert.ok(rv.indexOf('Nearly there.') > 0);
        assert.ok(/Go to (Your project|Heat loss|Heating|Heat pump)</.test(rv), 'the short label in "Go to"');
    });

test('A2. the request page: the steps in one block, in step order, Your project and Anything else as fixed lines', function () {
    var t = v3.setup();
    var form = sendPage(t, 'GET');
    var html = field(form, 'custpage_steps').defaultValue;
    assert.strictEqual(form.fields.filter(function (f) { return f.type === 'CHECKBOX'; }).length, 0);
    assert.ok(html.indexOf('<p style="font-weight:600;margin:0 0 6px">Steps to ask for</p>') > 0);
    assert.deepStrictEqual((html.match(/> [^<]*<\/label>/g) || []).map(function (x) { return x.slice(2, -8); }),
        ['Your project (always included)', 'Understanding the heat loss of your property',
            'Heating and controls', 'Heat pump information required for MCS',
            'Anything else for your Project Engineer? (always included)']);
    assert.strictEqual((html.match(/checked disabled/g) || []).length, 2);
});

// ---------------------------------------------------------------- 2.3c amendment 3

var STEPS6 = ['project', 'insulation', 'heating', 'heatpump', 'other'];

/** The positions of ids in html, in the order given (-1 for a missing one). */
function positions(html, ids) {
    return ids.map(function (id) { return html.indexOf(id); });
}

function ascending(list) {
    return list.every(function (x, i) { return x > 0 && (i === 0 || x > list[i - 1]); });
}

test('A3. six steps: Plans folds into Your project in the order of §1; the property type and the market for everyone',
    function () {
        var t = v3.setup();
        var bar = (v3.step(t, 'project').match(/name="goto" value="[a-z]+"/g) || []).map(function (x) { return x.split('"')[3]; });
        assert.deepStrictEqual(bar, STEPS6.concat(['review']));
        var html = v3.step(t, 'project');
        var order = positions(html, ['id="h-facts"', 'id="q-site_ok"', 'id="rp-site_new"', 'id="q-goods_date"',
            'id="q-design_contact"', 'id="q-ptype"', 'id="rp-flat_floor"', 'id="q-market"', 'id="q-plans_changed"',
            'id="rp-plans_sent_how"', 'id="rp-plans_files"', 'id="rp-bigfiles"']);
        assert.ok(ascending(order), JSON.stringify(order));
        // The property type and the market are asked of everyone: UFH Design with a boiler too.
        var ufh = v3.step(v3.setup({ opp: { custbody_value_proposition: '1', custbody_heat_source_type_26: ['10'] } }), 'project');
        assert.ok(ufh.indexOf('name="q_ptype"') > 0 && ufh.indexOf('name="q_market"') > 0);
        // The plans step is not a step: a link to it opens Your project.
        assert.ok(v3.step(t, 'plans').indexOf('<input type="hidden" name="step" value="project">') > 0);
    });

test('A3. an rq or a state naming plans loads without error and is logged once (DESIGNINFO_STATE_QID_UNKNOWN)', function () {
    var t = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith(['project', 'plans', 'heating', 'other']) } });
    var html = v3.step(t, 'project');
    assert.deepStrictEqual((html.match(/<span class="stitle">[^<]*/g) || []).map(function (x) { return x.slice(21); }),
        ['Your project', 'Heating', 'Anything else', 'Review and send']);
    var l = v3.logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN');
    assert.strictEqual(l.length, 1);
    assert.ok(l[0][2].indexOf('plans (step)') > 0, l[0][2]);
    // The request page drops it too.
    assert.deepStrictEqual(ticks(sendPage(t, 'GET')), [['custpage_step_insulation', 'F'], ['custpage_step_heating', 'T'],
        ['custpage_step_heatpump', 'F']]);
});

test('A3. the first visit (no step=) opens Your project; once sent, Review', function () {
    var t = v3.setup();
    assert.ok(v3.run(t, 'GET', { t: t.tok, a: 'designinfo', opp: '20' }).indexOf('<input type="hidden" name="step" ' +
        'value="project">') > 0);
    var sent = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith([], { sent: '2026-10-01T10:00Z' }) } });
    assert.ok(v3.run(sent, 'GET', { t: sent.tok, a: 'designinfo', opp: '20' }).indexOf('<h1>Review and send</h1>') > 0);
});

test('A3. the card: You\'re having in plain words (four variants), the address on its own lines, no design call row; the ' +
    'email\'s {system}', function () {
        var cases = [
            // Amendment 4 §1: "{system}" always ends in " system".
            [{}, 'Underfloor heating and a heat pump', 'underfloor heating and heat pump system'],
            [{ custbody_value_proposition: '1', custbody_heat_source_type_26: ['10'] }, 'Underfloor heating',
                'underfloor heating system'],
            [{ custbody_mi_opp_fc: '6' }, 'A heat pump', 'heat pump system'],
            [{ custbody_mi_opp_fc: '6', custbody_value_proposition: '1', custbody_heat_source_type_26: ['10'] }, '', 'heating system']
        ];
        cases.forEach(function (c) {
            var t = v3.setup({ opp: c[0] });
            var html = v3.step(t, 'project');
            if (c[1]) {
                assert.ok(html.indexOf('<dt>You’re having</dt><dd>' + c[1] + '</dd>') > 0, c[1]);
            } else {
                assert.strictEqual(html.indexOf('<dt>You’re having</dt>'), -1, 'neither: omitted');
            }
            assert.ok(html.indexOf('<dt>Site address</dt><dd>Plot 4<br>Village</dd>') > 0);
            assert.strictEqual(html.indexOf('Design call'), -1);
            sendPage(t, 'POST', {});
            // The PE's intro ("your main contact for your …") or the account manager's ("Project Engineer for your …,").
            assert.ok(t.w.emails[0].body.indexOf('for your ' + c[2] + (c[0].custbody_value_proposition === '1' ? ',' : ' all')) > 0,
                c[2]);
        });
    });

test('A3. "Is this the right address?" — No reveals the address; it goes to the Task and the Note as words and is never ' +
    'written to the address', function () {
        var t = v3.setup();
        var dom = runPage(v3.step(t, 'project'));
        assert.strictEqual(dom.panel('site_new').hidden, true);
        dom.choose('q_site_ok', 'no');
        assert.strictEqual(dom.panel('site_new').hidden, false);
        v3.post(t, { step: 'project', nav: 'stay', q_site_ok: 'no', q_site_new: 'Plot 5, Other Lane, Village, AB1 2CD' });
        assert.strictEqual(v3.state(t.w).answers.site_new, 'Plot 5, Other Lane, Village, AB1 2CD', 'kept in the state');
        assert.ok(t.w.notes[0].values.note.indexOf('Customer says the site address is: Plot 5, Other Lane, Village, AB1 2CD') >= 0,
            t.w.notes[0].values.note);
        v3.post(t, { step: 'review', send: '1' });
        // Amendment 4 §7: the address line is in the Note (and the PDF), not the Task.
        assert.ok(lastNote(t).indexOf('Customer says the site address is: Plot 5, Other Lane, Village, AB1 2CD.') >= 0);
        assert.strictEqual(t.w.tasks[0].values.message.indexOf('site address'), -1);
        t.w.submits.forEach(function (o) {
            assert.strictEqual(o.values.custbody_opp_site_adress, undefined, 'the address field is never written');
        });
        assert.strictEqual(t.w.opps[20].custbody_opp_site_adress, 'Plot 4\nVillage');
        // Yes: no line.
        var y = v3.setup();
        v3.post(y, { step: 'project', nav: 'stay', q_site_ok: 'yes', q_site_new: 'ignored: hidden' });
        v3.post(y, { step: 'review', send: '1' });
        assert.strictEqual(y.w.tasks[0].values.message.indexOf('Customer says the site address'), -1);
    });

test('A3. plans changed: three choices; upload reveals the files and big files, sent reveals "When and how"; an old yes is ' +
    'upload and an old no is No', function () {
        var t = v3.setup();
        var html = v3.step(t, 'project');
        var seg = html.slice(html.indexOf('id="q-plans_changed"'), html.indexOf('</fieldset>', html.indexOf('id="q-plans_changed"')));
        assert.deepStrictEqual((seg.match(/data-key="[a-z]+"/g) || []), ['data-key="no"', 'data-key="sent"', 'data-key="yes"']);
        assert.ok(seg.indexOf('No, you have the latest plans') > 0 && seg.indexOf('Yes, and I&#39;ve already sent them to Nu-Heat') > 0 &&
            seg.indexOf('Yes, I&#39;ll upload them here') > 0);
        assert.ok(html.indexOf('Some of my files are bigger than 10 MB.') > 0);
        assert.ok(html.indexOf('Tick this and Pem will send you a secure link to upload them. You don&#39;t need to attach them ' +
            'here.') > 0);
        var dom = runPage(html);
        ['plans_files', 'bigfiles', 'plans_sent_how'].forEach(function (q) { assert.strictEqual(dom.panel(q).hidden, true, q); });
        dom.choose('q_plans_changed', '2');
        assert.deepStrictEqual([dom.panel('plans_files').hidden, dom.panel('bigfiles').hidden, dom.panel('plans_sent_how').hidden],
            [false, false, true], 'upload');
        dom.choose('q_plans_changed', '1');
        assert.deepStrictEqual([dom.panel('plans_files').hidden, dom.panel('bigfiles').hidden, dom.panel('plans_sent_how').hidden],
            [true, true, false], 'sent');
        dom.choose('q_plans_changed', '0');
        assert.deepStrictEqual([dom.panel('plans_files').hidden, dom.panel('plans_sent_how').hidden], [true, true], 'no');
        // "When and how" is kept in the state.
        v3.post(t, { step: 'project', nav: 'stay', q_plans_changed: '1', q_plans_sent_how: 'Emailed Pem on 3 October' });
        // (A literal choice in the state keeps its label; keyOfValue() reads it back.)
        assert.deepStrictEqual([v3.state(t.w).answers.plans_changed, v3.state(t.w).answers.plans_sent_how],
            ['Yes, and I\'ve already sent them to Nu-Heat', 'Emailed Pem on 3 October']);
        assert.ok(/name="q_plans_changed" value="1" data-key="sent" checked/.test(v3.step(t, 'project')));
        // An old yes / no (the 2.3c yes/no question).
        [['yes', 'yes'], ['no', 'no']].forEach(function (c) {
            var o = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith([], { a: { plans_changed: c[0] } }) } });
            var p = v3.step(o, 'project');
            assert.ok(new RegExp('name="q_plans_changed" value="\\d" data-key="' + c[1] + '" checked').test(p), c[0]);
        });
    });

test('A3. the call: ticked, the Task\'s and the Note\'s first line and the state; unticked, none; the time box shows without ' +
    'script', function () {
        var t = v3.setup();
        var rv = v3.step(t, 'review');
        assert.ok(rv.indexOf('<input type="checkbox" id="di-call" name="call" value="yes"><label class="chk" for="di-call">I’d like a ' +
            'call to talk through my design</label>') > 0);
        assert.ok(rv.indexOf('<label class="lbl" for="di-callwhen">Best time and number to call (optional)</label>') > 0);
        assert.ok(rv.indexOf('name="call_when" maxlength="100"') > 0);
        // Without script the box always shows: only the .js rule hides it.
        assert.ok(rv.indexOf('.js #di-call:not(:checked) ~ .callwhen{display:none}') > 0);
        assert.strictEqual(/[^s] #di-call:not\(:checked\) ~ \.callwhen/.test(rv.replace('.js #di-call', '')), false);
        assert.ok(rv.indexOf('You can send now and finish the rest later.') > 0);
        v3.post(t, { step: 'review', send: '1', call: 'yes', call_when: 'Weekday mornings, 07700 900123' });
        var msg = t.w.tasks[0].values.message;
        // Amendment 4 §7: the Task's first line, in its words.
        assert.strictEqual(msg.split('\n')[0], 'CALL REQUESTED: best time Weekday mornings, 07700 900123', msg);
        var note = t.w.notes[t.w.notes.length - 1].values.note;
        assert.strictEqual(note.split('\n')[0], 'Customer would like a call: Weekday mornings, 07700 900123', note);
        var st = v3.state(t.w);
        assert.deepStrictEqual([st.call, st.callWhen], ['yes', 'Weekday mornings, 07700 900123']);
        assert.deepStrictEqual(JSON.parse(t.w.opps[20].custbody_cdb_designinfo_state).c, { y: 1, t: 'Weekday mornings, 07700 900123' });
        assert.ok(v3.step(t, 'review').indexOf('name="call" value="yes" checked') > 0, 'ticked again on Review');
        // Ticked, no time.
        var b = v3.setup();
        v3.post(b, { step: 'review', send: '1', call: 'yes' });
        assert.strictEqual(b.w.tasks[0].values.message.split('\n')[0], 'CALL REQUESTED');
        // Unticked: no line, nothing in the state.
        var u = v3.setup();
        v3.post(u, { step: 'review', send: '1', call_when: 'ignored' });
        assert.strictEqual(u.w.tasks[0].values.message.indexOf('CALL REQUESTED'), -1);
        assert.strictEqual(u.w.notes[u.w.notes.length - 1].values.note.indexOf('would like a call'), -1);
        assert.strictEqual(JSON.parse(u.w.opps[20].custbody_cdb_designinfo_state).c, undefined);
    });

test('A3. no "design call" anywhere: every step, Review, the dashboard card and the request email', function () {
    var d = amd.load('lib/cdb_lib_dates');
    var t = v3.setup({ opp: { custbody_next_contact: d.addDays(d.londonTodayKey(Date.now()), 3) } });
    STEPS6.concat(['review']).forEach(function (id) {
        var html = v3.step(t, id);
        assert.strictEqual(/design call|on your call|before our call/i.test(html), false, id);
    });
    assert.strictEqual(/design call/i.test(v3.run(t, 'GET', { t: t.tok })), false, 'the dashboard card');
    sendPage(t, 'POST', {});
    var body = t.w.emails[0].body;
    assert.strictEqual(/design call|Before we speak|read it all before|Anything you can.t answer/i.test(body), false);
    v3.post(t, { step: 'review', send: '1' });
    // Amendment 5: the Send redirects to the thank-you page.
    var sent = v3.step(t, 'thanks');
    assert.strictEqual(/design call/i.test(sent), false, 'the thank-you page');
    assert.ok(sent.indexOf('Pem will look through everything you’ve sent.') > 0);
});

test('A3. Heat loss: drawings, then the insulation (age only for Typical) and the house cards, then the extensions; the info ' +
    'rows; the element card\'s select and U on one row', function () {
        var t = v3.setup();
        var html = v3.step(t, 'insulation');
        assert.ok(ascending(positions(html, ['id="q-drawings_info"', 'id="q-drawings"', 'id="rp-ceilings"', 'id="rp-windows"',
            'id="q-ins_info"', 'id="rp-ins_route_reno"', 'id="rp-ins_route_new"', 'id="rp-age"', 'id="rp-sap_files"', 'id="rp-epc"',
            'id="rp-el_walls"', 'id="rp-el_windows"', 'id="rp-el_roof"', 'id="rp-el_floor"', 'id="rp-ext_info"', 'id="rp-has_ext"',
            'id="rp-ext_count"', 'id="rp-ext1_what"', 'id="rp-ext2_what"'])));
        assert.ok(html.indexOf('Sections and elevations show your ceiling heights and window sizes.') > 0);
        assert.ok(html.indexOf('How well your walls, windows, roof and floor hold heat sets how much heat each room needs.') > 0);
        assert.ok(html.indexOf('If part of the home is an extension, tell us about it here.') > 0);
        assert.strictEqual(parse(REGISTRY).questions.filter(function (q) { return q.qid === 'age'; })[0].revealText,
            'ins_route_reno=typical');
        // The card: the select and the exact U on one row (stacked below 600px), the notes below.
        var card = html.slice(html.indexOf('id="q-el_walls"'), html.indexOf('</fieldset>', html.indexOf('id="q-el_walls"')));
        assert.ok(/<div class="elrow"><div class="elsel">[\s\S]*<select[\s\S]*<\/div><div class="elu">[\s\S]*name="q_el_walls_u"/
            .test(card), card);
        assert.ok(card.indexOf('name="q_el_walls_notes"') > card.indexOf('name="q_el_walls_u"'));
        assert.ok(html.indexOf('.elrow{') > 0 && /@media \(max-width:600px\)\{[^}]*\.elrow/.test(html.replace(/\n/g, '')));
    });

test('A3. Heating: manifolds, where we shouldn\'t heat (on every heat set), screed / joists, coverings; Yes/No as tiles',
    function () {
        var qs = parse(REGISTRY).questions;
        var order = qs.filter(function (q) { return q.section === 'heating'; }).map(function (q) { return q.qid; });
        assert.deepStrictEqual(order.slice(0, 10), ['manifolds', 'unheated', 'layouts_files', 'through_walls', 'screed_gate',
            'screed', 'joist_gate', 'joists', 'joist_files', 'coverings']);
        Object.keys(HEATS).forEach(function (h) {
            ['solid', 'joisted', 'overfloor'].forEach(function (fc) {
                var ids = di.visibleQuestions(qs, { service: 'ufh', fc: [fc], heat: HEATS[h][0], hp: HEATS[h][1] })
                    .map(function (q) { return q.qid; });
                ['unheated', 'layouts_files', 'through_walls'].forEach(function (q) {
                    assert.ok(ids.indexOf(q) >= 0, h + ' ' + fc + ': ' + q);
                });
            });
        });
        var html = v3.step(v3.setup(), 'heating');
        assert.ok(ascending(positions(html, ['id="q-manifolds"', 'id="q-unheated"', 'id="q-layouts_files"', 'id="q-through_walls"',
            'id="q-coverings"'])));
        assert.ok(/<div class="opts opts2"><label class="optc"><input type="radio" name="q_through_walls" value="yes" data-key="yes"/
            .test(html), 'Yes/No as two tiles with radio circles');
        assert.ok(html.indexOf('.opts2{grid-template-columns:1fr 1fr}') > 0);
    });

test('A3. empty cards: a card whose questions are all hidden is hidden by the server (with script) and shown again by the ' +
    'script; the first visible question carries .first', function () {
        var t = v3.setup();
        var html = v3.step(t, 'insulation');
        // has_ext unanswered: both extension cards hidden; the house cards too (no route yet).
        var dom = runPage(html);
        assert.ok(/\brvhide\b/.test(dom.section('rp-ext1_what').className));
        assert.ok(/\brvhide\b/.test(dom.section('rp-ext2_what').className));
        assert.ok(/\brvhide\b/.test(dom.section('rp-el_walls').className));
        assert.ok(html.indexOf('.js .card.rvhide{display:none}') > 0, 'only with script on: without it every card shows');
        assert.ok(html.indexOf('html:not(.js) .card > :first-child') > 0);
        dom.choose('q_has_ext', 'yes');
        assert.strictEqual(/\brvhide\b/.test(dom.section('rp-ext1_what').className), false, 'yes: the first extension card shows');
        assert.ok(/\brvhide\b/.test(dom.section('rp-ext2_what').className), 'one extension');
        assert.ok(/\bfirst\b/.test(dom.panel('ext1_what').className), '.first on the first visible question');
        dom.choose('q_ext_count', '1');
        assert.strictEqual(/\brvhide\b/.test(dom.section('rp-ext2_what').className), false, 'two: the second card shows');
        dom.choose('q_ins_route_reno', '3');
        assert.strictEqual(/\brvhide\b/.test(dom.section('rp-el_walls').className), false, 'describe: the house cards show');
        dom.choose('q_has_ext', 'no');
        assert.ok(/\brvhide\b/.test(dom.section('rp-ext1_what').className), 'no: hidden again');
        // Server side: a card with a visible question is not hidden; the step's first card question is .first.
        var shown = v3.step(v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith([], { a: { has_ext: 'yes' } }) } }),
            'insulation');
        assert.ok(shown.indexOf('<section class="card"><div class="first rvp" id="rp-ext1_what"') > 0);
    });

test('A3. heat pump: the plan choices read "Yes, I\'ll upload it" and "I\'ll describe its location" / "I\'ll describe it"; keys ' +
    'unchanged', function () {
        var html = v3.step(v3.setup(), 'heatpump');
        function choices(qid) {
            var seg = html.slice(html.indexOf('id="q-' + qid + '"'), html.indexOf('</fieldset>', html.indexOf('id="q-' + qid + '"')));
            return [(seg.match(/data-key="[a-z]+"/g) || []).join(' '), (seg.match(/<span class="ot">[^<]*/g) || []).map(function (x) {
                return x.slice(17);
            })];
        }
        assert.deepStrictEqual(choices('hp_loc_plan'), ['data-key="plans" data-key="yes" data-key="no"',
            ['Already provided on floor plans', 'Yes, I&#39;ll upload it', 'I&#39;ll describe its location']]);
        assert.deepStrictEqual(choices('buffer_plan'), ['data-key="plans" data-key="yes" data-key="no"',
            ['Already provided on floor plans', 'Yes, I&#39;ll upload it', 'I&#39;ll describe it']]);
        assert.deepStrictEqual(choices('cyl_plan')[1], ['Already provided on floor plans', 'Yes, I&#39;ll upload it',
            'I&#39;ll describe it']);
    });

test('A3. the pictures: a fixed box, contain, centred; the cards aligned top, the same height', function () {
    var html = v3.step(v3.setup(), 'heatpump');
    assert.ok(/\.pic img\{[^}]*height:170px[^}]*object-fit:contain/.test(html), 'a 170px box');
    assert.ok(/@media \(max-width:600px\)\{[^}]*\.pic img\{height:140px/.test(html.replace(/\n/g, '')), '140px below 600px');
    assert.ok(/\.pics\{[^}]*align-items:stretch/.test(html) || /\.pics\{[^}]*align-items:start/.test(html));
});

test('A3. the request email: the intro (with and without a phone), three steps without timeframes, no "days"', function () {
    var t = v3.setup();
    sendPage(t, 'POST', {});
    var b = t.w.emails[0].body;
    assert.ok(/Hi [^,<]+,/.test(b), 'Hi {first name},');
    assert.ok(b.indexOf('I’m Pem, your Project Engineer. I’ll be your main contact for your underfloor heating and heat pump ' +
        'system all the way through design and delivery.') > 0);
    assert.ok(/It takes about \d+ minutes, and you can save it and come back at any time\./.test(b));
    assert.ok(b.indexOf('just give me a call on 0101 or reply to this email') > 0);
    ['You complete the design survey', 'Tell us about your property and heating system.', 'We design your system',
        'Our designers design your system and optimise it for installation and performance.', 'We deliver it',
        'Your system is delivered to site.'].forEach(function (x) { assert.ok(b.indexOf(x) > 0, x); });
    assert.strictEqual(/\bdays?\b/i.test(b), false, 'no timeframes');
    // No phone on the employee record (phone, then mobilephone): "just reply to this email".
    var n = v3.setup();
    n.w.employees[77].phone = '';
    n.w.employees[77].mobilephone = '';
    sendPage(n, 'POST', {});
    var nb = n.w.emails[0].body;
    assert.ok(nb.indexOf('If you’d like to talk anything through, just reply to this email') > 0);
    assert.strictEqual(nb.indexOf('give me a call'), -1);
    // The mobile when there is no direct line.
    var m = v3.setup();
    m.w.employees[77].phone = '';
    m.w.employees[77].mobilephone = '07700 900456';
    sendPage(m, 'POST', {});
    assert.ok(m.w.emails[0].body.indexOf('just give me a call on 07700 900456') > 0);
});

// ---------------------------------------------------------------- 2.3c amendment 4

/** An uploaded part, as request.files gives one (saving it records it in w.savedFiles). */
function upload(t, name, size) {
    var f = { name: name, size: size === undefined ? 1000 : size };
    f.save = function () {
        if (t.w.fileSaveThrows) { throw new Error('INSUFFICIENT_PERMISSION: folder'); }
        t.w.savedFiles.push({ name: f.name, folder: f.folder, isOnline: f.isOnline });
        return 900 + t.w.savedFiles.length;
    };
    return f;
}

/** A small registry for the Task's blocks: an optional contact, plans changed (state) with its upload, Anything else. */
var MINI = [V3,
    'project,"Your project",main,contact,text,"Who should we talk to?",,,state,N,,,"Intro",1,,,,"Your project"',
    'project,"Your project",plans,plans_changed,choice,"Have your plans changed?",,"no=No|sent=Sent|yes=Yes, I\'ll upload them",' +
    'state,Y,,,,,,,,',
    'project,"Your project",plans,plans_files,files,"Your new plans",,,note,N,,,,,,,plans_changed=yes,',
    'other,"Anything else",main,other,long,"Anything else?",,,note,N,,,,1,,,,"Anything else"'].join('\n') + '\n';

test('A4 §1. the email: "{system}" ends in "system" on all four forms; the You\'re having row in the card\'s plain words',
    function () {
        [[{}, 'underfloor heating and heat pump system', 'Underfloor heating and a heat pump'],
            [{ custbody_heat_source_type_26: ['10'], custbody_mi_heat_source: '4' }, 'underfloor heating system',
                'Underfloor heating'],
            [{ custbody_mi_opp_fc: '6' }, 'heat pump system', 'A heat pump'],
            [{ custbody_mi_opp_fc: '6', custbody_heat_source_type_26: ['10'], custbody_mi_heat_source: '4' }, 'heating system', '']
        ].forEach(function (c) {
            var t = v3.setup({ opp: c[0] });
            sendPage(t, 'POST', {});
            var b = t.w.emails[0].body;
            assert.ok(b.indexOf('your main contact for your ' + c[1] + ' all the way through design and delivery.') > 0, c[1]);
            if (c[2]) {
                assert.ok(b.indexOf('<b>' + c[2] + '</b>') > 0, c[2]);
            } else {
                assert.strictEqual(b.indexOf('>You’re having</font>'), -1, 'neither: the row is left out');
            }
            assert.strictEqual(b.indexOf('In floor, solid + joisted'), -1, 'never the opportunity\'s own wording');
        });
    });

test('A4 §4. drawings: three choices, the standard heights with their sub-line; standard writes both fields from the setting; ' +
    'an old "no" still reveals the boxes', function () {
        var t = v3.setup({ settings: { DI_STANDARD_HEIGHTS: '{"ceiling": "2.5", "window": "1.2", "door": "2.0"}' } });
        var html = v3.step(t, 'insulation');
        var seg = html.slice(html.indexOf('id="q-drawings"'), html.indexOf('</fieldset>', html.indexOf('id="q-drawings"')));
        assert.deepStrictEqual(seg.match(/data-key="[a-z]+"/g), ['data-key="yes"', 'data-key="no"', 'data-key="standard"']);
        assert.ok(seg.indexOf('<span class="ot">No, please use standard heights</span><span class="os">Ceilings 2.5 m, windows ' +
            '1.2 m high, external doors 2.0 m high</span>') > 0);
        var dom = runPage(html);
        dom.choose('q_drawings', '1');
        assert.deepStrictEqual([dom.panel('ceilings').hidden, dom.panel('windows').hidden], [false, false], 'no: the boxes');
        dom.choose('q_drawings', '2');
        assert.deepStrictEqual([dom.panel('ceilings').hidden, dom.panel('windows').hidden], [true, true], 'standard: none');
        v3.post(t, { step: 'insulation', nav: 'stay', q_drawings: '2' });
        var vals = v3.oppWrites(t.w)[0].values;
        assert.strictEqual(vals.custbody_sections_ceiling_heights_2026, 'Standard assumed: 2.5 m ceilings throughout (no section ' +
            'drawings).');
        assert.strictEqual(vals.custbody_elevations_window_sizes_2026, 'Standard assumed: windows 1.2 m high, external doors 2.0 m ' +
            'high (no elevation drawings). Widths from the floor plans.');
        assert.ok(t.w.notes[0].values.note.indexOf('Ceiling heights, room by room: — → Standard assumed: 2.5 m') > 0);
        // No setting: the code default.
        var d = v3.setup();
        v3.post(d, { step: 'insulation', nav: 'stay', q_drawings: '2' });
        assert.strictEqual(v3.oppWrites(d.w)[0].values.custbody_sections_ceiling_heights_2026, 'Standard assumed: 2.4 m ceilings ' +
            'throughout (no section drawings).');
        assert.ok(v3.oppWrites(d.w)[0].values.custbody_elevations_window_sizes_2026.indexOf('windows 1.1 m high, external doors ' +
            '2.1 m high') > 0);
        // A bad setting: the default, logged once.
        var b = v3.setup({ settings: { DI_STANDARD_HEIGHTS: '{"ceiling": "tall"}' } });
        assert.ok(v3.step(b, 'insulation').indexOf('Ceilings 2.4 m, windows 1.1 m high') > 0);
        assert.strictEqual(v3.logs(b.w, 'DESIGNINFO_STANDARD_HEIGHTS_INVALID').length, 1);
        // An old yes/no answer ("no", from the 2.3c yes/no question) still reads as No and reveals the boxes.
        var o = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith([], { a: { drawings: 'no' } }) } });
        var oh = v3.step(o, 'insulation');
        assert.ok(/name="q_drawings" value="1" data-key="no" checked/.test(oh));
        var od = runPage(oh);
        assert.strictEqual(od.panel('ceilings').hidden, false);
    });

/** A certificate shaped like the GOV.UK API's body (epc_lib certificate().raw), and epc_lib's mapping of it. */
var RAW_CERT = {
    certificate_number: '1111-2222-3333-4444-5555', registration_date: '2021-11-19', current_energy_efficiency_band: 'D',
    walls: [{ description: 'Cavity wall, as built, insulated (assumed)', energy_efficiency_rating: 4 },
        { description: 'Cavity wall, as built, insulated (assumed)', energy_efficiency_rating: 4 },
        { description: 'Timber frame, as built, no insulation (assumed)', energy_efficiency_rating: 1 }],
    roofs: [{ description: 'Roof room(s), insulated (assumed)', energy_efficiency_rating: 3 }],
    floors: [{ description: 'SOLID,  no insulation (ASSUMED)', energy_efficiency_rating: 0 }],
    window: { description: 'Fully double glazed', energy_efficiency_rating: 3 },
    sap_building_parts: [{ construction_age_band: 'England and Wales: 1950-1966' }]
};
var MAPPED_CERT = { certificateNumber: '1111-2222-3333-4444-5555', lodgementDate: '2021-11-19', currentEnergyRating: 'D',
    constructionAgeBand: 'England and Wales: 1950-1966', wallsDescription: 'Cavity wall, as built, insulated (assumed); ' +
        'Cavity wall, as built, insulated (assumed); Timber frame, as built, no insulation (assumed)',
    roofDescription: 'Roof room(s), insulated (assumed)', floorDescription: 'SOLID,  no insulation (ASSUMED)',
    windowsDescription: 'Fully double glazed', rawKeys: ['floors', 'roofs', 'walls', 'window'] };

test('A4 §5. EPC entries: the real field names (arrays, the single window object), the flat hyphen / underscore / camel keys, ' +
    '"|" and ";" joins, ratings', function () {
        assert.deepStrictEqual(di.epcEntries(RAW_CERT, null, 'walls'), [
            { text: 'Cavity wall, as built, insulated (assumed)', rating: 'Good' },
            { text: 'Timber frame, as built, no insulation (assumed)', rating: 'Very poor' }], 'a repeat kept once');
        assert.deepStrictEqual(di.epcEntries(RAW_CERT, null, 'windows'), [{ text: 'Fully double glazed', rating: 'Average' }]);
        assert.deepStrictEqual(di.epcEntries(RAW_CERT, null, 'floor'), [{ text: 'SOLID,  no insulation (ASSUMED)', rating: '' }],
            'a 0 rating is none');
        // The older shape: "walls-description", sometimes joined with "|" across the main building and an extension.
        var flat = { 'walls-description': 'Cavity wall, filled cavity|Solid brick, as built, no insulation (assumed)',
            'walls-energy-eff': 'Good|Very Poor', 'roof-description': 'Pitched, 270 mm loft insulation', 'roof-energy-eff': 'Good',
            windows_description: 'Single glazed', floorDescription: 'Suspended, no insulation (assumed)' };
        assert.deepStrictEqual(di.epcEntries(flat, null, 'walls'), [{ text: 'Cavity wall, filled cavity', rating: 'Good' },
            { text: 'Solid brick, as built, no insulation (assumed)', rating: 'Very poor' }]);
        assert.deepStrictEqual(di.epcEntries(flat, null, 'roof'), [{ text: 'Pitched, 270 mm loft insulation', rating: 'Good' }]);
        assert.deepStrictEqual(di.epcEntries(flat, null, 'windows'), [{ text: 'Single glazed', rating: '' }]);
        assert.deepStrictEqual(di.epcEntries(flat, null, 'floor'), [{ text: 'Suspended, no insulation (assumed)', rating: '' }]);
        // Neither: epc_lib's mapped text ("; "-joined).
        assert.deepStrictEqual(di.epcEntries(null, MAPPED_CERT, 'walls').map(function (x) { return x.text; }),
            ['Cavity wall, as built, insulated (assumed)', 'Timber frame, as built, no insulation (assumed)']);
        assert.deepStrictEqual(di.epcEntries({}, {}, 'walls'), []);
    });

test('A4 §5. EPC cards: several descriptions -> the first\'s preset, the notes all of them with ratings; unmapped -> Not sure ' +
    'with the notes; case and punctuation ignored; no windows -> "Not on your EPC."', function () {
        var walls = di.epcElement(di.epcEntries(RAW_CERT, null, 'walls'), EPCMAP, 'walls');
        assert.deepStrictEqual([walls.key, walls.mixed, walls.matched], ['modern_91_02', true, true]);
        assert.strictEqual(walls.notes, 'EPC: Cavity wall, as built, insulated (assumed) (Good); Timber frame, as built, no ' +
            'insulation (assumed) (Very poor)');
        var roof = di.epcElement(di.epcEntries(RAW_CERT, null, 'roof'), EPCMAP, 'roof');
        assert.deepStrictEqual([roof.key, roof.matched, roof.notes], ['unsure', false, 'EPC: Roof room(s), insulated ' +
            '(assumed) (Average)']);
        assert.strictEqual(di.epcElement(di.epcEntries(RAW_CERT, null, 'floor'), EPCMAP, 'floor').key, 'solid_unins',
            'SOLID,  no insulation: case, punctuation and spaces ignored');
        assert.strictEqual(di.epcElement('cavity wall FILLED cavity!!', EPCMAP, 'walls').key, 'cavity_filled');
        assert.strictEqual(di.epcElement('Pitched, 150 mm loft insulation', EPCMAP, 'roof').key, 'mm150', 'whole words');
        // The second entry maps when the first does not.
        assert.strictEqual(di.epcElement('System built, as built; Cavity wall, filled cavity', EPCMAP, 'walls').key,
            'cavity_filled');
        assert.strictEqual(di.epcElement(di.epcEntries({}, {}, 'windows'), EPCMAP, 'windows').notes, 'Not on your EPC.');
        assert.strictEqual(di.epcNorm('Cavity-wall,  FILLED (cavity)'), ' cavity wall filled cavity ');
        var long = di.epcElement([{ text: Array(400).join('x'), rating: '' }], EPCMAP, 'walls');
        assert.strictEqual(long.notes.length, 300, 'clipped at 300');
    });

test('A4 §5. the EPC lookup with a real-shaped certificate: the cards, the notes (editable, saved as notes), the From your EPC ' +
    'tag; an unmatched element in the Task', function () {
        var t = v3.setup();
        t.epc.certResult = { ok: true, raw: RAW_CERT, data: MAPPED_CERT, statusCode: 200 };
        var html = v3.post(t, { step: 'insulation', nav: 'epc_use', epc_cert: '1111-2222-3333-4444-5555', q_ins_route_reno: '1' });
        var walls = cardIn(html, 'el_walls');
        assert.deepStrictEqual([walls.key, walls.tag], ['modern_91_02', 'From your EPC']);
        assert.strictEqual(notesIn(html, 'el_walls'), 'EPC: Cavity wall, as built, insulated (assumed) (Good); Timber frame, as ' +
            'built, no insulation (assumed) (Very poor)');
        assert.deepStrictEqual([cardIn(html, 'el_roof').key, cardIn(html, 'el_roof').tag], ['unsure', 'From your EPC']);
        assert.strictEqual(notesIn(html, 'el_roof'), 'EPC: Roof room(s), insulated (assumed) (Average)');
        assert.strictEqual(cardIn(html, 'el_windows').key, 'double_02');
        assert.strictEqual(notesIn(html, 'el_windows'), 'EPC: Fully double glazed (Average)');
        assert.strictEqual(cardIn(html, 'el_floor').key, 'solid_unins');
        // Saved as the page posts it: the notes as they stand (the customer may edit them), written like any note.
        v3.post(t, { step: 'insulation', nav: 'stay', epc_number: '1111-2222-3333-4444-5555', epc_date: '2021-11-19',
            q_ins_route_reno: '1', q_el_walls: 'modern_91_02', q_el_walls_src: 'epc:modern_91_02:',
            q_el_walls_notes: notesIn(html, 'el_walls'), q_el_roof: 'unsure', q_el_roof_src: 'epc:unsure:',
            q_el_roof_notes: notesIn(html, 'el_roof'), q_el_windows: 'double_02', q_el_windows_src: 'epc:double_02:',
            q_el_windows_notes: 'EPC: Fully double glazed (Average). New doors in 2020', q_el_floor: 'solid_unins',
            q_el_floor_src: 'epc:solid_unins:' });
        var vals = v3.oppWrites(t.w).slice(-1)[0].values;
        assert.ok(vals.custbody_existing_walls_2026.indexOf('notes: EPC: Cavity wall, as built, insulated (assumed) (Good); ' +
            'Timber frame') > 0, vals.custbody_existing_walls_2026);
        assert.ok(vals.custbody_existing_roofs_2026.indexOf('Not sure · notes: EPC: Roof room(s), insulated (assumed) (Average)') ===
            0, vals.custbody_existing_roofs_2026);
        assert.ok(vals.custbody_existing_windows_2026.indexOf('notes: EPC: Fully double glazed (Average). New doors in 2020') > 0);
        assert.deepStrictEqual(v3.state(t.w).epcUnmatched, ['roof']);
        v3.post(t, { step: 'review', send: '1' });
        assert.ok(t.w.tasks[0].values.message.indexOf('\n- EPC roof not matched: see the Note\n') > 0, t.w.tasks[0].values.message);
        assert.ok(lastNote(t).indexOf('Not sure · notes: EPC: Roof room(s), insulated (assumed) (Average)') > 0);
        // The customer then chooses a preset for the roof: no longer unmatched.
        v3.post(t, { step: 'insulation', nav: 'stay', q_ins_route_reno: '1', q_el_roof: 'mm270', q_el_roof_src: 'epc:unsure:',
            q_el_roof_notes: notesIn(html, 'el_roof') });
        assert.deepStrictEqual(v3.state(t.w).epcUnmatched, []);
    });

test('A4 §6. extension cards: a 2 x 2 grid after the extension\'s other questions; Same / Different inside each card; the ' +
    'reveal works', function () {
        var t = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith([], { a: { has_ext: 'yes' } }) } });
        var html = v3.step(t, 'insulation');
        var a = html.indexOf('id="rp-ext1_sap_files"');
        var grid = html.indexOf('<section class="card elgrid extgrid">');
        assert.ok(a > 0 && grid > a, 'the other questions (with the drawings upload) above the grid');
        assert.ok(html.indexOf('id="rp-ext1_where"') < grid && html.indexOf('id="rp-ext1_what"') < grid);
        var g = html.slice(grid, html.indexOf('</section>', grid));
        ['walls', 'windows', 'roof', 'floor'].forEach(function (el) {
            var card = g.indexOf('id="rp-ext1_' + el + '_same"');
            assert.ok(card >= 0, el);
            // In the card: the Same / Different tiles, then the element's select, U-value and notes in its reveal panel.
            var seg = g.slice(card, g.indexOf('id="rp-ext1_' + el + '_same"') + 4000);
            assert.ok(/^id="rp-ext1_[a-z]+_same"[^>]*><p class="rvif">[^<]*<\/p><div class="extcard"><div class="dq" id="q-ext1_[a-z]+_same">/
                .test(seg), seg.slice(0, 300));
            assert.ok(seg.indexOf('id="rp-ext1_' + el + '"') > 0 && seg.indexOf('class="dq el elbody" id="q-ext1_' + el + '"') > 0);
            assert.ok(seg.indexOf('name="q_ext1_' + el + '_u"') > 0 && seg.indexOf('name="q_ext1_' + el + '_notes"') > 0);
        });
        assert.ok(html.indexOf('.extcard .opts{grid-template-columns:1fr 1fr;gap:8px}') > 0, 'two small tiles');
        assert.ok(html.indexOf('@media (max-width:700px){.elgrid{grid-template-columns:minmax(0,1fr)}}') > 0, 'one column on a phone');
        var dom = runPage(html);
        assert.strictEqual(dom.panel('ext1_walls_same').hidden, false);
        assert.strictEqual(dom.panel('ext1_walls').hidden, true, 'not until Different');
        dom.choose('q_ext1_walls_same', '1');
        assert.strictEqual(dom.panel('ext1_walls').hidden, false, 'Different: the select, U-value and notes');
        dom.choose('q_ext1_walls_same', '0');
        assert.strictEqual(dom.panel('ext1_walls').hidden, true);
        dom.choose('q_has_ext', 'no');
        assert.ok(/\brvhide\b/.test(dom.section('rp-ext1_walls_same').className), 'no extension: the grid card goes');
        // Every inline script still parses.
        scriptsOf(html).forEach(function (body) { new vm.Script(body); });
    });

test('A4 §7. the Task: the call first; the Sent line; empty blocks left out; the plans block only on new uploads; Needs a ' +
    'look; a re-send says what changed; the full answers in the Note', function () {
        var d = amd.load('lib/cdb_lib_dates');
        var today = d.londonTodayKey(Date.now());
        var day = di.dayMonth(today, true);
        var t = v3.setup({ registry: MINI });
        v3.post(t, { step: 'project', nav: 'stay', q_plans_changed: '0' });
        v3.post(t, { step: 'review', send: '1' });
        var m = t.w.tasks[0].values.message;
        assert.strictEqual(m, 'Sent ' + day + '. Complete: Your project, Anything else. Still to do: none.\n\nFull answers: ' +
            'Note "Design information ' + day + '" and PDF "Design information QR20 ' + today + '.pdf".', 'nothing else');
        assert.strictEqual(t.w.tasks[0].values.title, 'Design information received: QR20 Acme Ltd');
        assert.ok(lastNote(t).indexOf('FULL ANSWERS') > 0 && lastNote(t).indexOf('- Have your plans changed?: No') > 0);
        // A re-send with new plans uploaded, a failed upload and a call: the call first, then the blocks in order.
        v3.post(t, { step: 'project', nav: 'stay', q_plans_changed: '2', q_contact: 'Dave' },
            { f_plans_files_1: upload(t, 'ground.pdf') });
        var bad = upload(t, 'kitchen.pdf');
        bad.save = function () { throw new Error('INSUFFICIENT_PERMISSION: folder'); };
        v3.post(t, { step: 'review', send: '1', call: 'yes', call_when: 'Tues pm, 07700 900123' },
            { f_plans_files_2: bad });
        m = t.w.tasks[1].values.message;
        assert.strictEqual(m, 'CALL REQUESTED: best time Tues pm, 07700 900123\n\nUpdated ' + day + '. Changed since last ' +
            'send: Your project. Complete: Your project, Anything else. Still to do: none.\n\nUpdated / uploaded plans\nNew plans ' +
            'submitted: see the Files section.\n\nNeeds a look\n- Upload failed: kitchen.pdf. Ask the customer to resend.\n\n' +
            'Full answers: Note "Design information ' + day + '" and PDF "Design information QR20 ' + today + '.pdf".');
        assert.ok(lastNote(t).indexOf('- Who should we talk to?: Dave') > 0, 'the detail in the Note');
        // A third Send: no new plans since the last one — no plans block, nothing changed.
        v3.post(t, { step: 'review', send: '1' });
        m = t.w.tasks[2].values.message;
        assert.strictEqual(m.indexOf('Updated / uploaded plans'), -1);
        assert.ok(m.indexOf('Changed since last send: none.') > 0);
        // Plans "sent" (not uploaded): no plans block either.
        var s = v3.setup({ registry: MINI });
        v3.post(s, { step: 'review', send: '1', q_plans_changed: '1' });
        assert.strictEqual(s.w.tasks[0].values.message.indexOf('Updated / uploaded plans'), -1);
        // A required answer still blank: by its label.
        var b = v3.setup({ registry: MINI });
        v3.post(b, { step: 'review', send: '1' });
        assert.ok(b.w.tasks[0].values.message.indexOf('\nNeeds a look\n- Needed but left blank: Have your plans changed?\n') > 0);
    });

test('A4 §8. the PDF: created in the upload folder and attached on every Send (the old ones stay); escaped; a failure still ' +
    'sends; its usage in CDB USAGE', function () {
        var d = amd.load('lib/cdb_lib_dates');
        var today = d.londonTodayKey(Date.now());
        var t = v3.setup({ registry: MINI });
        v3.post(t, { step: 'review', send: '1', q_contact: '<script>alert("x")</script> & Sons', q_plans_changed: '0' });
        var pdf = t.w.savedFiles.filter(function (f) { return f.pdf; });
        assert.strictEqual(pdf.length, 1);
        assert.deepStrictEqual([pdf[0].name, pdf[0].folder, pdf[0].isOnline], ['Design information QR20 ' + today + '.pdf', 555,
            false]);
        assert.ok(t.w.attaches.some(function (a) { return a.record.type === 'file' && a.to.id === 20; }), 'attached');
        var xml = t.w.pdfs[0];
        assert.ok(/^<\?xml version="1.0"\?>\n<!DOCTYPE pdf PUBLIC "-\/\/big.faceless.org\/\/report" "report-1.1.dtd">\n<pdf>/.test(xml));
        assert.ok(xml.indexOf('<h2>Your project (done)</h2>') > 0 && xml.indexOf('<td class="l">Have your plans changed?</td>' +
            '<td>No</td>') > 0, 'laid out like Review');
        assert.ok(xml.indexOf('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Sons') > 0);
        assert.strictEqual(xml.indexOf('<script>'), -1);
        assert.strictEqual(xml.indexOf('<img'), -1, 'no pictures');
        assert.ok(v3.logs(t.w, 'USAGE')[0][2].indexOf('; the PDF 40 units (v') > 0, v3.logs(t.w, 'USAGE')[0][2]);
        assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_PDF').length, 1);
        // Each Send makes a new PDF; the old one stays.
        v3.post(t, { step: 'review', send: '1' });
        assert.strictEqual(t.w.savedFiles.filter(function (f) { return f.pdf; }).length, 2);
        // A failure: the Send still succeeds, logged, and the Task says so.
        var f = v3.setup({ registry: MINI });
        f.w.pdfThrows = true;
        v3.post(f, { step: 'review', send: '1', q_plans_changed: '0' });
        assert.strictEqual(f.w.tasks.length, 1);
        // Amendment 5: the Send went through, so the thank-you page.
        assert.ok(/&step=thanks$/.test(f.redirect), f.redirect);
        assert.strictEqual(v3.logs(f.w, 'DESIGNINFO_PDF_FAILED')[0][0], 'error');
        assert.ok(/Full answers: Note "Design information [^"]+"\. PDF not created; see the Note\.$/.test(f.w.tasks[0].values.message),
            f.w.tasks[0].values.message);
        assert.ok(v3.state(f.w).sent, 'sent');
        // No folder: no PDF, the same message.
        var n = v3.setup({ registry: MINI, settings: { DESIGNINFO_FOLDER: null } });
        v3.post(n, { step: 'review', send: '1' });
        assert.ok(/PDF not created; see the Note\.$/.test(n.w.tasks[0].values.message));
        // A save that is not a Send makes no PDF.
        var s = v3.setup({ registry: MINI });
        v3.post(s, { step: 'project', nav: 'stay', q_contact: 'Dave' });
        assert.strictEqual((s.w.pdfs || []).length, 0);
    });

test('A4 §8. the PDF XML: every value escaped, control characters dropped, line breaks kept', function () {
    var render = amd.load('lib/cdb_lib_render', {});
    var x = render.designInfoPdfXml({ heading: 'A & B', lines: ['<b>'], call: 'Call "me"', sections: [{ title: 'S\'s', status: 'todo',
        rows: [{ label: 'L<', value: 'one\ntwo\u0007' }] }, { title: 'Empty', rows: [] }], facts: ['x > y'], footer: 'f' });
    assert.ok(x.indexOf('<h1>A &amp; B</h1>') > 0 && x.indexOf('<p class="m">&lt;b&gt;</p>') > 0);
    assert.ok(x.indexOf('<p class="call">Call &quot;me&quot;</p>') > 0);
    assert.ok(x.indexOf('<h2>S&#39;s (to do)</h2>') > 0);
    assert.ok(x.indexOf('<td class="l">L&lt;</td><td>one<br/>two</td>') > 0);
    assert.ok(x.indexOf('<h2>Empty</h2><p class="m">Nothing added.</p>') > 0);
    assert.ok(x.indexOf('<p>x &gt; y</p>') > 0);
});

test('A4 §9. text already on the opportunity: shown read-only, the answer appended as "Customer (d MMM): …"; a second save ' +
    'replaces only the customer\'s line; the staff text is kept; a field holding only the form\'s text is replaced', function () {
        var d = amd.load('lib/cdb_lib_dates');
        var dm = di.dayMonth(d.londonTodayKey(Date.now()));
        var staff = 'PE note: vaulted ceiling in the lounge, 3.2 m at the ridge.';
        var t = v3.setup({ opp: { custbody_sections_ceiling_heights_2026: staff } });
        var html = v3.step(t, 'insulation');
        assert.ok(html.indexOf('<p class="hint have" style="margin:0">What we have so far: ' + staff.replace(/,/g, ',') + '</p>') > 0);
        assert.ok(/<textarea class="inp" id="di-ceilings" name="q_ceilings"[^>]*><\/textarea>/.test(html), 'the box is empty');
        v3.post(t, { step: 'insulation', nav: 'stay', q_drawings: '1', q_ceilings: 'All 2.4 m' });
        var field = t.w.opps[20].custbody_sections_ceiling_heights_2026;
        assert.strictEqual(field, staff + '\nCustomer (' + dm + '): All 2.4 m');
        // The page: the staff text above, the customer's own answer in the box.
        html = v3.step(t, 'insulation');
        assert.ok(html.indexOf('What we have so far: ' + staff + '</p>') > 0);
        assert.ok(html.indexOf('>All 2.4 m</textarea>') > 0);
        // A second save replaces only the customer's line.
        t.w.opps[20].custbody_sections_ceiling_heights_2026 = field + '\nSales: check the loft hatch.';
        v3.post(t, { step: 'insulation', nav: 'stay', q_ceilings: 'All 2.5 m' });
        assert.strictEqual(t.w.opps[20].custbody_sections_ceiling_heights_2026, staff + '\nSales: check the loft hatch.\n' +
            'Customer (' + dm + '): All 2.5 m');
        // The same answer again: no change, nothing written.
        var n = v3.oppWrites(t.w).length;
        v3.post(t, { step: 'insulation', nav: 'stay', q_ceilings: 'All 2.5 m' });
        assert.strictEqual(v3.oppWrites(t.w).length, n);
        // Staff text a long way over: clipped at 300 with "…".
        var long = v3.setup({ opp: { custbody_sections_ceiling_heights_2026: Array(500).join('s') } });
        assert.ok(v3.step(long, 'insulation').indexOf('What we have so far: ' + Array(300).join('s') + '…</p>') > 0);
        // A field holding only what this form wrote: pre-filled, and replaced on save.
        var own = v3.setup();
        v3.post(own, { step: 'insulation', nav: 'stay', q_drawings: '1', q_windows: 'Bifolds 2.1 m' });
        assert.strictEqual(own.w.opps[20].custbody_elevations_window_sizes_2026, 'Bifolds 2.1 m');
        var oh = v3.step(own, 'insulation');
        assert.ok(oh.indexOf('>Bifolds 2.1 m</textarea>') > 0);
        assert.ok(!/What we have so far: Bifolds/.test(oh));
        v3.post(own, { step: 'insulation', nav: 'stay', q_windows: 'Bifolds 2.2 m' });
        assert.strictEqual(own.w.opps[20].custbody_elevations_window_sizes_2026, 'Bifolds 2.2 m');
        // Choice, list and date fields keep their behaviour (pre-selected, replaced): the market, from the field.
        assert.ok(/name="q_market" value="8" data-key="reno" checked/.test(v3.step(own, 'project')));
    });

// ---------------------------------------------------------------- 2.3c amendment 5: the thank-you page

/** Amendment 5: a GET of the URL a POST redirected to. */
function followUrl(t) {
    var q = {};
    // A GET clears t.redirect: keep the last one, so the page can be opened again (a refresh).
    t.lastRedirect = t.redirect || t.lastRedirect;
    t.lastRedirect.split('?')[1].split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return v3.run(t, 'GET', q);
}

/** The thank-you page's conditional lines (<p class="thx">), as text. */
function thanksLines(html) {
    return (html.match(/<p class="thx">[\s\S]*?<\/p>/g) || []).map(function (x) {
        return x.replace(/<[^>]+>/g, '').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    });
}

test('A5. a Send that went through redirects to step=thanks; refreshing it sends nothing, writes nothing and makes no second Task',
    function () {
        var t = v3.setup({ registry: MINI });
        v3.post(t, { step: 'review', send: '1', q_plans_changed: '0' });
        assert.ok(/\?t=[^&]+&a=designinfo&opp=20&step=thanks$/.test(t.redirect), 'the same token parameters: ' + t.redirect);
        assert.strictEqual(t.w.tasks.length, 1);
        var counts = [t.w.tasks.length, t.w.notes.length, t.w.submits.length, t.w.savedFiles.length, (t.w.pdfs || []).length];
        var html = followUrl(t);
        followUrl(t);
        assert.deepStrictEqual([t.w.tasks.length, t.w.notes.length, t.w.submits.length, t.w.savedFiles.length,
            (t.w.pdfs || []).length], counts, 'the page writes nothing');
        assert.ok(html.indexOf('<h1 id="h-thanks">Thank you, Acme Ltd. We’ve got your design information.</h1>') > 0);
        assert.ok(html.indexOf('<title>Thank you · Tell us about your property | Nu-Heat</title>') > 0);
        assert.strictEqual(html.indexOf('class="sbar"'), -1, 'no step bar');
        assert.strictEqual(html.indexOf('<form'), -1, 'no form');
        assert.strictEqual(scriptsOf(html).length, 0, 'no inline script');
        // A link without step= after a Send still opens Review (amendment 3).
        assert.ok(v3.run(t, 'GET', { t: t.tok, a: 'designinfo', opp: '20' }).indexOf('<h1>Review and send</h1>') > 0);
    });

test('A5. the thank-you page: with none of the conditional lines, the heading, the paragraph, What happens next, the buttons ' +
    'and the questions line', function () {
        var t = v3.setup({ registry: MINI });
        v3.post(t, { step: 'review', send: '1', q_plans_changed: '0' });
        var html = followUrl(t);
        assert.deepStrictEqual(thanksLines(html), []);
        assert.ok(html.indexOf('<p class="lead" style="margin:0">Pem will look through everything you’ve sent. As long as ' +
            'nothing’s missing, our expert system designers will then get to work on your design.</p></section>') > 0);
        // What happens next: the email's three steps, the first ticked.
        assert.deepStrictEqual((html.match(/<li[^>]*><span class="ncirc" aria-hidden="true">[^<]*<\/span><span><strong>[^<]*/g) ||
            []).map(function (x) { return x.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'); }),
        ['|✓|You complete the design survey', '|2|We design your system', '|3|We deliver it']);
        assert.ok(html.indexOf('<li class="done">') > 0 && html.indexOf('(done)</span>') > 0);
        assert.ok(html.indexOf('<div class="navrow"><a class="cta" href="https://acct.extforms.netsuite.com/sl?t=' + t.tok +
            '">Back to your project</a><a class="out" href="https://acct.extforms.netsuite.com/sl?t=' + t.tok + '&amp;' +
            'a=designinfo&amp;opp=20&amp;step=review">See what you sent</a></div>') > 0);
        assert.ok(html.indexOf('<p class="stuck">Questions? Email Pem at <a href="mailto:pe@x">pe@x</a>.</p>') > 0);
        // See what you sent: Review, editable while the design has not started.
        assert.ok(v3.step(t, 'review').indexOf('name="send" value="1"') > 0);
    });

test('A5. the thank-you page\'s conditional lines, each only when it applies: a call, steps still to do, a failed upload ' +
    '(one line per file), big files', function () {
        // A call.
        var c = v3.setup({ registry: MINI });
        v3.post(c, { step: 'review', send: '1', q_plans_changed: '0', call: 'yes', call_when: 'Tues pm' });
        assert.deepStrictEqual(thanksLines(followUrl(c)), ['You asked for a call. Pem will be in touch to arrange it.']);
        // Steps still to do: their short names.
        var d = v3.setup();
        v3.post(d, { step: 'review', send: '1' });
        assert.deepStrictEqual(thanksLines(followUrl(d)), ['There are a few things still to tell us: Your project, Heat loss, ' +
            'Heating, Heat pump. You can add them any time from the link in your email, and Pem will pick them up.']);
        // Failed uploads, one line each, escaped; and big files (the tick shown and answered).
        var f = v3.setup({ registry: MINI.replace('Anything else"', 'Anything else"') + 'project,"Your project",plans,bigfiles,' +
            'yesno,"Some of my files are bigger than 10 MB.",,,state,N,,,,,,,plans_changed=yes,\n' });
        var bad = upload(f, 'kitchen <b>&.pdf');
        var bad2 = upload(f, 'lounge.pdf');
        bad.save = bad2.save = function () { throw new Error('INSUFFICIENT_PERMISSION: folder'); };
        v3.post(f, { step: 'review', send: '1', q_plans_changed: '2', q_bigfiles: 'yes' },
            { f_plans_files_1: bad, f_plans_files_2: bad2 });
        var html = followUrl(f);
        assert.deepStrictEqual(thanksLines(html), ['One of your files didn’t upload: kitchen <b>&.pdf. Please email it to ' +
            'Pem at pe@x.', 'One of your files didn’t upload: lounge.pdf. Please email it to Pem at pe@x.',
        'Pem will send you a secure link for your larger files.']);
        assert.ok(html.indexOf('kitchen &lt;b&gt;&amp;.pdf') > 0 && html.indexOf('kitchen <b>') < 0, 'escaped');
        assert.ok(html.indexOf('Please email it to Pem at <a href="mailto:pe@x">pe@x</a>.') > 0);
        // A later Send with no failure: no upload line (the list is the last Send's).
        v3.post(f, { step: 'review', send: '1' });
        assert.strictEqual(thanksLines(followUrl(f)).filter(function (l) { return /didn’t upload/.test(l); }).length, 0);
        // Big files ticked but hidden (plans not "upload"): no line.
        var h = v3.setup({ registry: MINI + 'project,"Your project",plans,bigfiles,yesno,"Big?",,,state,N,,,,,,,plans_changed=yes,\n',
            opp: { custbody_cdb_designinfo_state: stateWith([], { a: { bigfiles: 'yes' } }) } });
        v3.post(h, { step: 'review', send: '1', q_plans_changed: '0' });
        assert.deepStrictEqual(thanksLines(followUrl(h)), []);
    });

test('A5. a Send that fails validation stays on the form with the errors (no redirect, nothing written); a failed Task stays ' +
    'on Review', function () {
        var t = v3.setup();
        var html = v3.post(t, { step: 'review', send: '1', q_ptype: '17' });
        assert.strictEqual(t.redirect, '', 'no redirect');
        assert.ok(html.indexOf('Please choose one of the options shown.') > 0, 'the error, on the step that has it');
        assert.strictEqual(t.w.tasks.length, 0);
        assert.strictEqual(t.w.submits.length, 0);
        var f = v3.setup();
        f.w.taskThrows = true;
        html = v3.post(f, { step: 'review', send: '1' });
        assert.strictEqual(f.redirect, '');
        assert.ok(html.indexOf('<h1>Review and send</h1>') > 0 && html.indexOf('Please press Send again') > 0);
    });

test('A5. step=thanks without a Send, or in view mode, shows Review', function () {
    var t = v3.setup();
    var html = v3.step(t, 'thanks');
    assert.ok(html.indexOf('<h1>Review and send</h1>') > 0);
    assert.strictEqual(html.indexOf('h-thanks'), -1);
    assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_THANKS_REFUSED').length, 1);
    var v = v3.setup({ opp: { custbody_opportunity_sub_status: '4', custbody_cdb_designinfo_state: stateWith([],
        { sent: '2026-10-01T10:00Z' }) } });
    html = v3.step(v, 'thanks');
    assert.strictEqual(html.indexOf('h-thanks'), -1, 'view mode: Review');
    assert.strictEqual(v.w.submits.length + v.w.tasks.length + v.w.notes.length, 0);
});

test('A5. phone width: the buttons stack full width below 600 px; the long email wraps', function () {
    var t = v3.setup({ registry: MINI });
    v3.post(t, { step: 'review', send: '1', q_plans_changed: '0' });
    var html = followUrl(t).replace(/\n/g, '');
    assert.ok(/@media \(max-width:600px\)\{(?:[^{}]*\{[^{}]*\})*?\.navrow\{flex-direction:column;align-items:stretch\}\.navrow \.cta,\.navrow \.out[^{]*\{width:100%\}/
        .test(html));
    assert.ok(html.indexOf('.stuck a{overflow-wrap:anywhere}') > 0);
    assert.ok(html.indexOf('<meta name="viewport" content="width=device-width, initial-scale=1">') > 0);
});

var playwright = null;
try { playwright = require('playwright'); } catch (e) { playwright = null; }

test('A5. phone width (390 px, Chromium): no sideways scroll; the buttons are full width', { skip: playwright ? false :
    'Playwright is not installed (the CSS is checked above)' }, async function () {
    var t = v3.setup({ registry: MINI });
    t.w.employees[77].email = 'a.very.long.address.for.the.project.engineer@nu-heat.example.co.uk';
    v3.post(t, { step: 'review', send: '1', q_plans_changed: '0', call: 'yes' });
    var html = followUrl(t);
    var browser = await playwright.chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} :
        { executablePath: '/opt/pw-browsers/chromium' });
    try {
        var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.route('**/*', function (r) { return r.abort(); });
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        var r = await page.evaluate(function () {
            var row = document.querySelector('.navrow');
            return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
                row: row.getBoundingClientRect().width, buttons: Array.prototype.map.call(row.querySelectorAll('a'), function (a) {
                    return a.getBoundingClientRect().width;
                }) };
        });
        assert.ok(r.scroll <= r.client, 'no sideways scroll: ' + JSON.stringify(r));
        assert.strictEqual(r.buttons.length, 2);
        r.buttons.forEach(function (w) { assert.ok(Math.abs(w - r.row) < 1, 'full width: ' + JSON.stringify(r)); });
    } finally {
        await browser.close();
    }
});
