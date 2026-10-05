'use strict';
/**
 * Release 2.3b (dashboard 2.4.0, designinfo 1.1.0): the registry v2 — both headers, the step columns, the committed
 * file, and the visible-section table that decides the steps. Pure: no NetSuite stubs.
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var amd = require('./helpers/amd');

var di = amd.load('lib/cdb_lib_designinfo', {});
var config = amd.load('lib/cdb_lib_config', {});

var REGISTRY = fs.readFileSync(path.join(__dirname, '..', 'content', 'design-info-registry.csv'), 'utf8');
var V1 = 'section,section_title,panel,qid,type,label,hint,options,field,required,when,why';
var V2 = V1 + ',step_intro,step_minutes,image,placeholder';

function parse(text) {
    return di.parseRegistry(text, config.designInfoAllowList(), config.DESIGNINFO_DENY);
}

// ---------------------------------------------------------------- both headers

test('registry: the v1 header (12 columns) and the v2 header (16) both parse; neither shape is rejected', function () {
    var v1 = parse(V1 + '\nplans,Your plans,main,a1,text,Year built,,,custbody15,Y,,\n');
    assert.strictEqual(v1.status, 'ok');
    assert.strictEqual(v1.headerVersion, 1);
    assert.deepStrictEqual(v1.rejected, []);
    assert.strictEqual(v1.questions[0].stepIntro, '', 'no step columns: empty');
    assert.strictEqual(v1.questions[0].stepMinutes, 0);
    assert.strictEqual(v1.questions[0].image, '');
    assert.strictEqual(v1.questions[0].placeholder, '');
    var v2 = parse(V2 + '\nplans,Your plans,main,a1,text,Year built,,,custbody15,Y,,,"Check your plans.",2,,"e.g. 1930"\n');
    assert.strictEqual(v2.status, 'ok');
    assert.strictEqual(v2.headerVersion, 2);
    assert.deepStrictEqual(v2.rejected, []);
    assert.strictEqual(v2.questions[0].placeholder, 'e.g. 1930');
    // Column order is free in v2 too.
    var moved = parse('placeholder,image,step_minutes,step_intro,' + V1 + '\n,,3,Hi,plans,Your plans,main,a1,text,Year,,,' +
        'custbody15,N,,\n');
    assert.strictEqual(moved.status, 'ok');
    assert.strictEqual(moved.headerVersion, 2);
    assert.strictEqual(moved.questions[0].stepMinutes, 3);
});

test('registry: a partial v2 header (some of the four step columns) is invalid, naming what is missing', function () {
    var r = parse(V1 + ',step_intro,step_minutes\nplans,Your plans,main,a1,text,Year built,,,custbody15,Y,,,Hi,2\n');
    assert.strictEqual(r.status, 'invalid');
    assert.ok(/image/.test(r.detail) && /placeholder/.test(r.detail), r.detail);
});

test('registry: the step intro and minutes come from the section\'s first row; later rows\' values are ignored', function () {
    var r = parse([V2,
        'plans,Your plans,main,a1,text,One,,,note,N,,,"First intro",2,,',
        'plans,Your plans,main,a2,text,Two,,,note,N,,,"Ignored intro",9,,',
        'other,Anything else,main,b1,long,Three,,,note,N,,,,,,'].join('\n') + '\n');
    assert.strictEqual(r.status, 'ok');
    var s = di.sectionsOf(r.questions);
    assert.deepStrictEqual(s.map(function (x) { return [x.id, x.intro, x.minutes]; }),
        [['plans', 'First intro', 2], ['other', '', 0]]);
    assert.strictEqual(r.questions[1].stepIntro, 'First intro', 'every question carries its section\'s');
});

test('registry: image and placeholder are accepted on any row; a step_minutes that is not a whole number rejects the row', function () {
    var r = parse([V2,
        'plans,Your plans,main,a1,text,One,,,note,N,,,Intro,2,plans.png,"e.g. 2.4 m"',
        'plans,Your plans,main,a2,text,Two,,,note,N,,,,,,"Type here"',
        'other,Anything else,main,b1,long,Three,,,note,N,,,Intro,about 2,,'].join('\n') + '\n');
    assert.strictEqual(r.questions.length, 2);
    assert.strictEqual(r.questions[0].image, 'plans.png');
    assert.strictEqual(r.questions[0].placeholder, 'e.g. 2.4 m');
    assert.strictEqual(r.questions[1].placeholder, 'Type here');
    assert.strictEqual(r.rejected.length, 1);
    assert.ok(/step_minutes must be a whole number/.test(JSON.stringify(r.rejected[0])), JSON.stringify(r.rejected));
});

// ---------------------------------------------------------------- the committed v2 file

test('the committed registry is v2: 0 rejected, 45 unique qids, every section with an intro and minutes, no images', function () {
    var r = parse(REGISTRY);
    var ids = r.questions.map(function (q) { return q.qid; });
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.headerVersion, 2);
    assert.deepStrictEqual(r.rejected, []);
    assert.strictEqual(ids.length, 45);
    assert.strictEqual(ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length, 45, 'unique');
    assert.strictEqual(REGISTRY.split(/\r?\n/)[0], V2);
    di.sectionsOf(r.questions).forEach(function (s) {
        assert.ok(s.intro, s.id + ': an intro');
        assert.ok(s.minutes > 0, s.id + ': minutes');
    });
    r.questions.forEach(function (q) { assert.strictEqual(q.image, '', q.qid + ': no images in this release'); });
    // The 2.3 qids the v2 file removed: a stored answer under one is ignored (unknownStateQids).
    ['fc_unknown', 'overfloor', 'acoustic', 'mcs_reflect', 'mcs_barrier', 'mcs_vis', 'mcs_distance', 'mcs_position', 'rad_area',
        'hp_files'].forEach(function (id) { assert.strictEqual(ids.indexOf(id), -1, id); });
});

test('unknownStateQids: the answers and noted marks under qids the registry does not have', function () {
    var qs = parse(REGISTRY).questions;
    var st = di.emptyState();
    st.answers = { plans_current: 'yes', fc_unknown: 'x' };
    st.noted = { w3w: true, mcs_position: true };
    assert.deepStrictEqual(di.unknownStateQids(st, qs).sort(), ['fc_unknown', 'mcs_position']);
    assert.deepStrictEqual(di.unknownStateQids(di.emptyState(), qs), []);
});

// ---------------------------------------------------------------- the visible-section table

/**
 * The steps (the visible sections, registry order) for {service} x {FC} x {heat source}, with the heating step's
 * questions in brackets. Existing house (newbuild no). Review follows every row.
 */
var TABLE = {
    'ufh solid boiler': 'project, plans, heating(manifolds screed through_walls), other',
    'ufh solid nuheat_hp': 'project, plans, heating(manifolds screed through_walls), heatpump, other',
    'ufh joisted boiler': 'project, plans, heating(manifolds joists joist_files through_walls), other',
    'ufh joisted nuheat_hp': 'project, plans, heating(manifolds joists joist_files through_walls), heatpump, other',
    'ufh overfloor boiler': 'project, plans, heating(manifolds through_walls), other',
    'ufh overfloor nuheat_hp': 'project, plans, heating(manifolds through_walls), heatpump, other',
    'ufh solid|joisted boiler': 'project, plans, heating(manifolds screed joists joist_files through_walls), other',
    'ufh solid|joisted nuheat_hp': 'project, plans, heating(manifolds screed joists joist_files through_walls), heatpump, other',
    'ufh unknown boiler': 'project, plans, heating(manifolds screed joists joist_files through_walls), other',
    'ufh unknown nuheat_hp': 'project, plans, heating(manifolds screed joists joist_files through_walls), heatpump, other',
    'ufh hp boiler': 'project, plans, other',
    'ufh hp nuheat_hp': 'project, plans, heatpump, other',
    'ufh_plus solid boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder screed coverings through_walls), other',
    'ufh_plus solid nuheat_hp': 'project, plans, insulation, heating(manifolds screed coverings through_walls), heatpump, other',
    'ufh_plus joisted boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder joists joist_files coverings ' +
        'through_walls), other',
    'ufh_plus joisted nuheat_hp': 'project, plans, insulation, heating(manifolds joists joist_files coverings through_walls), ' +
        'heatpump, other',
    'ufh_plus overfloor boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder coverings through_walls), other',
    'ufh_plus overfloor nuheat_hp': 'project, plans, insulation, heating(manifolds coverings through_walls), heatpump, other',
    'ufh_plus solid|joisted boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder screed joists joist_files ' +
        'coverings through_walls), other',
    'ufh_plus solid|joisted nuheat_hp': 'project, plans, insulation, heating(manifolds screed joists joist_files coverings ' +
        'through_walls), heatpump, other',
    'ufh_plus unknown boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder screed joists joist_files ' +
        'coverings through_walls), other',
    'ufh_plus unknown nuheat_hp': 'project, plans, insulation, heating(manifolds screed joists joist_files coverings ' +
        'through_walls), heatpump, other',
    'ufh_plus hp boiler': 'project, plans, insulation, other',
    'ufh_plus hp nuheat_hp': 'project, plans, insulation, heatpump, other',
    'hp solid boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder screed coverings through_walls), other',
    'hp solid nuheat_hp': 'project, plans, insulation, heating(manifolds screed coverings through_walls), heatpump, other',
    'hp joisted boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder joists joist_files coverings ' +
        'through_walls), other',
    'hp joisted nuheat_hp': 'project, plans, insulation, heating(manifolds joists joist_files coverings through_walls), heatpump, ' +
        'other',
    'hp overfloor boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder coverings through_walls), other',
    'hp overfloor nuheat_hp': 'project, plans, insulation, heating(manifolds coverings through_walls), heatpump, other',
    'hp solid|joisted boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder screed joists joist_files ' +
        'coverings through_walls), other',
    'hp solid|joisted nuheat_hp': 'project, plans, insulation, heating(manifolds screed joists joist_files coverings ' +
        'through_walls), heatpump, other',
    'hp unknown boiler': 'project, plans, insulation, heating(manifolds heat_boiler cylinder screed joists joist_files coverings ' +
        'through_walls), other',
    'hp unknown nuheat_hp': 'project, plans, insulation, heating(manifolds screed joists joist_files coverings through_walls), ' +
        'heatpump, other',
    'hp hp boiler': 'project, plans, insulation, other',
    'hp hp nuheat_hp': 'project, plans, insulation, heatpump, other'
};

test('the visible-section table: {ufh, ufh_plus, hp} x {solid, joisted, overfloor, solid|joisted, unknown, hp} x ' +
    '{boiler, nuheat_hp}', function () {
    var qs = parse(REGISTRY).questions;
    var seen = 0;
    ['ufh', 'ufh_plus', 'hp'].forEach(function (service) {
        ['solid', 'joisted', 'overfloor', 'solid|joisted', 'unknown', 'hp'].forEach(function (fc) {
            ['boiler', 'nuheat_hp'].forEach(function (heat) {
                var key = service + ' ' + fc + ' ' + heat;
                var shown = di.visibleQuestions(qs, { service: service, fc: fc.split('|'), heat: heat, newbuild: false });
                var got = di.sectionsOf(shown).map(function (s) {
                    return s.id + (s.id === 'heating' ? '(' + s.questions.map(function (q) { return q.qid; }).join(' ') + ')' : '');
                }).join(', ');
                assert.strictEqual(got, TABLE[key], key);
                seen += 1;
            });
        });
    });
    assert.strictEqual(seen, Object.keys(TABLE).length);
    // The insulation step is the existing-house set for newbuild no, the new-build set for yes.
    var ins = function (nb) {
        return di.visibleQuestions(qs, { service: 'hp', fc: ['solid'], heat: 'nuheat_hp', newbuild: nb }).filter(function (q) {
            return q.section === 'insulation';
        }).map(function (q) { return q.qid; }).join(' ');
    };
    assert.strictEqual(ins(false), 'ins_choice ins_files year walls_ex windows_ex roof_ex floors_ex');
    assert.strictEqual(ins(true), 'ins_choice ins_files year walls_new windows_new roof_new floors_new');
});
