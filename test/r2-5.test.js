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

test('registry v3: the committed file parses with 0 rejected, 86 questions; titles, shorts and minutes as §B5', function () {
    var r = parse(REGISTRY);
    var steps = di.sectionsOf(r.questions);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.headerVersion, 3);
    assert.deepStrictEqual(r.rejected, []);
    assert.strictEqual(r.questions.length, 86);
    assert.strictEqual(REGISTRY.split(/\r?\n/)[0], V3);
    assert.deepStrictEqual(steps.map(function (s) { return [s.id, s.title, s.short, s.minutes]; }), [
        ['project', 'Your project', 'Your project', 1],
        ['plans', 'Your plans and layout', 'Plans and layout', 2],
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
    assert.ok(/not an earlier question in this section/.test(why.c), 'unknown');
    assert.ok(/not an earlier question/.test(why.d), 'later');
    assert.ok(/"z" is not a key of b/.test(why.f), 'bad key');
    assert.ok(/not an earlier question/.test(why.g), 'f was rejected, so it is not there');
    assert.ok(/not an earlier question in this section/.test(why.h), 'another section');
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
    assert.deepStrictEqual(ids([]), ['project', 'plans', 'insulation', 'heating', 'other']);
    assert.deepStrictEqual(ids(undefined), ids([]));
    assert.deepStrictEqual(ids(['plans']), ['project', 'plans', 'other']);
    assert.deepStrictEqual(ids(['heatpump', 'heating']), ['project', 'heating', 'other'], 'heatpump is ruled out: not added');
    assert.deepStrictEqual(ids(['project', 'other']), ['project', 'other']);
    assert.strictEqual(di.stepsMinutes(di.stepsFor(qs, f, [])), 1 + 2 + 5 + 2 + 1);
    assert.strictEqual(di.stepsMinutes([]), 0);
});

/**
 * The visible-step table (§B5): {ufh, ufh_plus, hp} x {solid, joisted, overfloor, hp} x heat sets — the step SHORT titles.
 * Heat loss for UFH Design + and HP Design; Heating whenever the floor needs pipe; Heat pump for a Nu-Heat heat pump.
 */
var STEP_TABLE = {
    'ufh solid boiler': 'Your project, Plans and layout, Heating, Anything else',
    'ufh solid ashp': 'Your project, Plans and layout, Heating, Heat pump, Anything else',
    'ufh hp boiler': 'Your project, Plans and layout, Anything else',
    'ufh hp hpunknown': 'Your project, Plans and layout, Heat pump, Anything else',
    'ufh_plus joisted boiler': 'Your project, Plans and layout, Heat loss, Heating, Anything else',
    'ufh_plus joisted hybrid': 'Your project, Plans and layout, Heat loss, Heating, Heat pump, Anything else',
    'ufh_plus overfloor userhp': 'Your project, Plans and layout, Heat loss, Heating, Anything else',
    'ufh_plus hp ashp': 'Your project, Plans and layout, Heat loss, Heat pump, Anything else',
    'hp solid ashp': 'Your project, Plans and layout, Heat loss, Heating, Heat pump, Anything else',
    'hp solid boiler': 'Your project, Plans and layout, Heat loss, Heating, Anything else',
    'hp joisted hpunknown': 'Your project, Plans and layout, Heat loss, Heating, Heat pump, Anything else',
    'hp overfloor hybrid': 'Your project, Plans and layout, Heat loss, Heating, Heat pump, Anything else',
    'hp hp ashp': 'Your project, Plans and layout, Heat loss, Heat pump, Anything else',
    'hp hp boiler': 'Your project, Plans and layout, Heat loss, Anything else',
    'hp hp userhp': 'Your project, Plans and layout, Heat loss, Anything else'
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
        'buffer_plan buffer_files buffer cyl_plan cyl_files cyl dhw');
    assert.strictEqual(hpQids(['nuheat_hp', 'gshp_loop'], ['gshp_loop']), 'hp_loc_plan hp_loc_files hp_loc loop_plan loop_files ' +
        'loop_area buffer_plan buffer_files buffer cyl_plan cyl_files cyl dhw');
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

test('EPC mapping: per element; disagreeing entries -> unsure with the text; the U-value; windows absent; the age band year',
    function () {
        assert.deepStrictEqual(di.epcElement('Cavity wall, filled cavity', EPCMAP, 'walls'),
            { key: 'cavity_filled', u: '', text: 'Cavity wall, filled cavity', missing: false, mixed: false });
        assert.strictEqual(di.epcElement('Solid brick, as built, no insulation (assumed)', EPCMAP, 'walls').key, 'solid_brick');
        assert.strictEqual(di.epcElement('Fully double glazed', EPCMAP, 'windows').key, 'double_02');
        assert.strictEqual(di.epcElement('Pitched, 150 mm loft insulation', EPCMAP, 'roof').key, 'mm150', 'not "50 mm"');
        assert.strictEqual(di.epcElement('Pitched, 250 mm loft insulation', EPCMAP, 'roof').key, 'mm200');
        assert.strictEqual(di.epcElement('Suspended, no insulation (assumed)', EPCMAP, 'floor').key, 'susp_unins');
        var mixed = di.epcElement('Cavity wall, filled cavity; Timber frame, as built, no insulation (assumed)', EPCMAP, 'walls');
        assert.deepStrictEqual([mixed.key, mixed.mixed], ['unsure', true]);
        assert.ok(mixed.text.indexOf('Timber frame') > 0);
        var same = di.epcElement('Solid, no insulation (assumed); Solid, no insulation (assumed)', EPCMAP, 'floor');
        assert.strictEqual(same.key, 'solid_unins', 'agreeing entries');
        var u = di.epcElement('Average thermal transmittance 0.28 W/m²K', EPCMAP, 'walls');
        assert.deepStrictEqual([u.key, u.u, u.mixed], ['unsure', '0.28', false]);
        assert.strictEqual(di.uFromEpcText('Average thermal transmittance 9 W/m2K'), '', 'out of range');
        assert.deepStrictEqual(di.epcElement(null, EPCMAP, 'windows'), { key: 'unsure', u: '', text: '', missing: true,
            mixed: false });
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

var INS = { step: 'insulation', nav: 'stay', q_ptype: '2', q_market: '8', q_age: '2', q_has_ext: 'no', q_drawings: 'yes',
    q_ins_route_reno: '3' };

function merge(a, b) {
    var o = {};
    Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { o[k] = b[k]; });
    return o;
}

/** The selected option and the src of an element card in a page. */
function cardIn(html, qid) {
    var seg = html.slice(html.indexOf('id="q-' + qid + '"'));
    seg = seg.slice(0, seg.indexOf('</fieldset>'));
    return { key: (seg.match(/<option value="([^"]*)" selected/) || [])[1] || '', src: (seg.match(/_src" value="([^"]*)"/) || [])[1],
        tag: (seg.match(/class="eltag"[^>]*>([^<]*)/) || [])[1], u: (seg.match(/_u" value="([^"]*)"/) || [])[1] };
}

test('POST with reveal: a hidden question\'s answer is ignored (not validated, written or noted); required only when ' +
    'revealed; progress counts the revealed only', function () {
    var t = v3.setup();
    // market new: age, has_ext and the renovation route are hidden; crafted answers to them are ignored, even invalid ones.
    v3.post(t, { step: 'insulation', nav: 'stay', q_market: '9', q_age: '99', q_ins_route_reno: '1', q_has_ext: 'maybe',
        q_ext1_what: 'Kitchen', q_ins_route_new: '1', q_drawings: 'no', q_ceilings: '2.4 m', q_windows: 'Standard' });
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
    v3.post(ok, { step: 'insulation', nav: 'stay', q_ptype: '1', q_market: '9', q_drawings: 'yes', q_ins_route_new: '0' });
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
    assert.ok(html.indexOf('<p class="rvif">If you chose “Flat or apartment” to “What type of property is it?”</p>') > 0);
    assert.ok(html.indexOf('If you chose “Yes” to “Does the project include an extension?” and “Two” to “How many ' +
        'extensions?”') > 0);
    assert.ok(html.indexOf('.js .rvif{display:none}') > 0, 'with script on, the headings go');
    assert.ok(html.indexOf('data-reveal') > 0 && html.indexOf('ps[i].hidden=!ok') > 0, 'the script');
    assert.ok(/<input type="radio" name="q_market" value="8" data-key="reno" checked>/.test(html), 'pre-selected from the field');
    // A step with no reveal and no element card carries no reveal script.
    assert.strictEqual(v3.step(t, 'project').indexOf('ps[i].hidden=!ok'), -1);
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
    // A literal choice still posts its index and writes its label (text field).
    v3.post(u, { step: 'insulation', nav: 'stay', q_age: '6' });
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
    assert.ok(/value="2" data-key="semi" checked/.test(v3.step(held, 'insulation')), 'the page shows the customer\'s answer');
    v3.post(held, { step: 'review', send: '1' });
    var msg = held.w.tasks[0].values.message;
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
    assert.deepStrictEqual([floor.key, floor.tag], ['unsure', 'From your EPC'], 'two entries that disagree');
    assert.ok(html.indexOf('Your certificate says: Solid, no insulation (assumed); Suspended, no insulation (assumed)') > 0);
    assert.deepStrictEqual([cardIn(html, 'el_windows').key, cardIn(html, 'el_windows').tag], ['unsure',
        'Not on your EPC: please check']);
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

function field(form, id) {
    return form.fields.filter(function (f) { return f.id === id; })[0];
}

function stateWith(rq, extra) {
    var s = { v: 2, s: {}, a: {}, f: [], req: '2026-10-01T09:00Z', sent: '', task: '', rq: rq };
    Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
    return JSON.stringify(s);
}

test('stepsFor: the SAME list on the stepper, Review, the request page, the request email and the card', function () {
    var rq = ['project', 'plans', 'heating', 'other'];
    var t = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith(rq) } });
    var titles = ['Your project', 'Your plans and layout', 'Heating and controls', 'Anything else for your Project Engineer?'];
    var shorts = ['Your project', 'Plans and layout', 'Heating', 'Anything else'];
    // The stepper's step bar (then Review).
    var bar = (v3.step(t, 'plans').match(/<span class="stitle">[^<]*<\/span>/g) || []).map(function (x) {
        return x.replace(/<[^>]+>/g, '');
    });
    assert.deepStrictEqual(bar, titles.concat(['Review and send']), 'the stepper');
    assert.strictEqual(v3.step(t, 'insulation').indexOf('<h1 id="h-step">Understanding'), -1, 'not requested: not a step');
    var rv = (v3.step(t, 'review').match(/<h2 id="rv-[^"]+">[^<]*/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); });
    assert.deepStrictEqual(rv, titles, 'Review');
    // The request page: "will be asked about", and the ticks pre-ticked from rq.
    var form = sendPage(t, 'GET');
    assert.ok(form.fields[0].defaultValue.indexOf('<td style="padding:4px 0">' + titles.join(', ') + '</td>') > 0, 'the request page');
    assert.deepStrictEqual(form.fields.filter(function (f) { return f.type === 'CHECKBOX'; }).map(function (f) {
        return [f.id, f.label, f.defaultValue];
    }), [['custpage_step_plans', 'Your plans and layout', 'T'], ['custpage_step_insulation',
        'Understanding the heat loss of your property', 'F'], ['custpage_step_heating', 'Heating and controls', 'T'],
        ['custpage_step_heatpump', 'Heat pump information required for MCS', 'F']]);
    // The email, sent with those ticks.
    sendPage(t, 'POST', { custpage_step_plans: 'T', custpage_step_heating: 'T' });
    var body = t.w.emails[0].body;
    shorts.forEach(function (s, i) {
        assert.ok(body.indexOf('<b>' + (i + 1) + '</b>') > 0 && body.indexOf('<b>' + s + '</b>') > 0, 'the email: ' + s);
    });
    assert.strictEqual(body.indexOf('<b>Heat loss</b>'), -1);
    assert.strictEqual(body.indexOf('<b>5</b>'), -1, 'four steps');
    // The card: "about N minutes" is the requested steps' minutes (1 + 2 + 2 + 1).
    var dash = v3.run(t, 'GET', { t: t.tok });
    assert.ok(dash.indexOf('It takes about 6 minutes, and you can do it in stages.') > 0);
    // In progress: only the requested steps count (a save of a step not requested makes no progress).
    t.w.opps[20].custbody_cdb_designinfo_state = stateWith(rq, { s: { insulation: { at: '2026-10-02T10:00Z', st: 'done' } } });
    dash = v3.run(t, 'GET', { t: t.tok });
    assert.ok(dash.indexOf('We need some information about your property') > 0, 'still "needs information"');
    t.w.opps[20].custbody_cdb_designinfo_state = stateWith(rq, { s: { plans: { at: '2026-10-02T10:00Z', st: 'done' } } });
    dash = v3.run(t, 'GET', { t: t.tok });
    // Your project has no required question (optional): it is never "still to do".
    assert.ok(dash.indexOf('Thanks, we have: Your plans and layout. Still to do: Heating and controls.') > 0);
});

test('the request page: a crafted tick for a ruled-out step is dropped; rq is stored with project and other, merged into ' +
    'the state and kept by the size guard; the next GET pre-ticks from it', function () {
    // A boiler only (Heat Source Type 10): no heat pump step.
    var t = v3.setup({ opp: { custbody_heat_source_type_26: ['10'], custbody_cdb_designinfo_state: stateWith([], {
        a: { has_ext: 'no' }, s: { plans: { at: '2026-10-01T10:00Z', st: 'done' } } }) } });
    var form = sendPage(t, 'GET');
    assert.deepStrictEqual(form.fields.filter(function (f) { return f.type === 'CHECKBOX'; }).map(function (f) {
        return [f.id, f.defaultValue];
    }), [['custpage_step_plans', 'T'], ['custpage_step_insulation', 'T'], ['custpage_step_heating', 'T']],
        'no earlier request: every step ticked; the heat pump step is not offered');
    sendPage(t, 'POST', { custpage_step_insulation: 'T', custpage_step_heatpump: 'T', custpage_step_bogus: 'T' });
    var st = v3.state(t.w);
    assert.deepStrictEqual(st.rq, ['project', 'insulation', 'other'], 'heatpump (ruled out) and bogus dropped');
    assert.deepStrictEqual(st.answers, { has_ext: 'no' }, 'merged');
    assert.strictEqual(st.sections.plans.status, 'done');
    assert.ok(v3.logs(t.w, 'DESIGNINFO_REQUESTED')[0][2].indexOf('asking about: Your project, Understanding the heat loss of ' +
        'your property, Anything else for your Project Engineer? (rq project,insulation,other)') > 0);
    form = sendPage(t, 'GET');
    assert.deepStrictEqual(form.fields.filter(function (f) { return f.type === 'CHECKBOX'; }).map(function (f) {
        return [f.id, f.defaultValue];
    }), [['custpage_step_plans', 'F'], ['custpage_step_insulation', 'T'], ['custpage_step_heating', 'F']], 'pre-ticked from rq');
    // Nothing ticked: project and other only (allowed), never "everything".
    sendPage(t, 'POST', {});
    assert.deepStrictEqual(v3.state(t.w).rq, ['project', 'other']);
    var bar = v3.step(t, 'project');
    assert.strictEqual(bar.indexOf('Your plans and layout</span>'), -1);
    // A 2.3 / 2.3b request (no rq): every allowed step on the page.
    var old = v3.setup({ opp: { custbody_cdb_designinfo_state: stateWith(undefined) } });
    assert.ok(v3.step(old, 'project').indexOf('<span class="stitle">Heat pump information required for MCS</span>') > 0);
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
        custpage_fix_fc: '12', custpage_step_plans: 'T' });
    t.recheckUnits = t.w.units;
    assert.strictEqual(t.w.submits.length, 1);
    assert.deepStrictEqual(t.w.submits[0].values, { custbody_heat_source_type_26: ['4', '10'], custbody_mi_opp_fc: '12' });
    assert.strictEqual(t.w.emails.length, 0, 'no email');
    assert.strictEqual(t.w.opps[20].custbody_cdb_designinfo_state, '', 'the state untouched');
    assert.ok(form.fields[0].defaultValue.indexOf('Updated. The facts below are recalculated.') > 0);
    assert.strictEqual(field(form, 'custpage_fix_fc'), undefined, 'recalculated: nothing left to fix');
    assert.ok(form.fields[0].defaultValue.indexOf('Your project, Your plans and layout, Understanding the heat loss of your ' +
        'property, Heating and controls, Heat pump information required for MCS') > 0, 'the heat pump step now');
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
    var msg = t.w.tasks[0].values.message;
    assert.ok(msg.indexOf('Extension 1: (in the Notes), Being built now, marked on plans') > 0, msg);
    assert.ok(msg.indexOf('EPC used: certificate 1111-2222-3333-4444-5555, lodged 19/11/2021, valid until 19/11/2031.') > 0);
    assert.ok(msg.indexOf('- HP Design but no heat pump in Heat Source Type.') > 0);
    assert.ok(msg.indexOf('- The design service is HP Design, but the heat source is not a Nu-Heat heat pump.') > 0);
    assert.strictEqual(msg.indexOf('Where is it, and which rooms'), -1, 'hidden: not in the snapshot');
    assert.ok(msg.indexOf('Extension 1 walls: Same as the main house') > 0);
});

test('old state: a 2.3b state with removed qids reads without error; its progress is kept; logged once', function () {
    var t = v3.setup({ opp: { custbody_cdb_designinfo_state: JSON.stringify({ v: 2, s: { plans: { at: '2026-10-01T10:00Z',
        st: 'done' }, project: { at: '2026-10-01T10:00Z', st: 'opt' } }, a: { plans_current: 'yes', bigfiles: 'no' },
        n: ['w3w', 'year', 'walls_ex'], f: [{ q: 'plans_files', id: '901', n: 'QR20_plans.pdf', at: '2026-10-01T10:00Z' }],
        req: '2026-09-30T10:00Z', sent: '', task: '' }) } });
    var html = v3.step(t, 'plans');
    assert.ok(html.indexOf('<h1 id="h-step">Your plans and layout</h1>') > 0);
    assert.strictEqual(v3.logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN').length, 1);
    assert.ok(/plans_current, w3w, year, walls_ex/.test(v3.logs(t.w, 'DESIGNINFO_STATE_QID_UNKNOWN')[0][2]));
    var dash = v3.run(t, 'GET', { t: t.tok });
    assert.ok(dash.indexOf('In progress') > 0 && dash.indexOf('Thanks, we have: Your project, Your plans and layout. Still to ' +
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
