'use strict';
/**
 * Release 2.3: the pure parts of "Tell us about your property" (lib/cdb_lib_designinfo.js), the Note and Task
 * builders (lib/cdb_lib_task.js 1.5.0) and the request email's wording (config.parseDesignInfoEmail). Grouped as the
 * brief's §9 "Pure" list.
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var amd = require('./helpers/amd');

var di = amd.load('lib/cdb_lib_designinfo', {});
var config = amd.load('lib/cdb_lib_config', {});
var task = amd.load('lib/cdb_lib_task', {});

var REGISTRY = fs.readFileSync(path.join(__dirname, '..', 'content', 'design-info-registry.csv'), 'utf8');
var ALLOW = config.designInfoAllowList();
var DENY = config.DESIGNINFO_DENY;
var HEADER = 'section,section_title,panel,qid,type,label,hint,options,field,required,when,why';

/** A registry of the header and these rows. */
function reg(rows, eol) {
    return [HEADER].concat(rows).join(eol || '\n') + (eol || '\n');
}

function parse(text) {
    return di.parseRegistry(text, ALLOW, DENY);
}

var MAPS = {
    FC_MAP: '{"1": "solid", "2": "joisted", "3": "overfloor", "4": "acoustic", "5": "solid|joisted", "6": "none", "7": "hp", ' +
        '"8": "unknown", "9": "solid|joisted|overfloor"}',
    HEAT_MAP: '{"11": "boiler", "12": "nuheat_hp", "13": "user_hp", "14": "other"}',
    VP_MAP: '{"21": "ufh", "22": "ufh_plus", "23": "hp"}',
    NEWBUILD_MARKET_IDS: ['31'],
    NEEDINFO_SUBSTATUS: ['1'],
    DESIGN_SUBSTATUS: ['1', '4', '5', '13']
};

function facts(o) {
    return di.buildFacts(o, MAPS);
}

function sectionIds(f) {
    return di.sectionsOf(di.visibleQuestions(parse(REGISTRY).questions, f)).map(function (s) { return s.id; });
}

// ---------------------------------------------------------------- the committed registry (amendment 1 §2)

test('the committed registry parses (2.4.0: v2, 16 columns): every field quoted, 0 rejected, 45 questions in 6 sections', function () {
    var r = parse(REGISTRY);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.headerVersion, 2);
    assert.deepStrictEqual(r.rejected, []);
    assert.strictEqual(r.questions.length, 45);
    assert.deepStrictEqual(di.sectionsOf(r.questions).map(function (s) { return s.id; }),
        ['project', 'plans', 'insulation', 'heating', 'heatpump', 'other']);
    // Amendment 1 §2: every non-empty label, hint, options, when and why is quoted.
    REGISTRY.split('\n').slice(1).filter(function (l) { return l; }).forEach(function (line) {
        var cells = di.parseCsv(line).rows[0];
        assert.strictEqual(cells.length, 16, line);
    });
    assert.ok(REGISTRY.indexOf(',"Your heat pump: make, model and where it will go",') > 0);
    assert.ok(REGISTRY.indexOf(',"Screed floors: liquid or hand-mixed, and the depth",') > 0);
    assert.ok(REGISTRY.indexOf(',"Joisted floors: joist type, direction and spacing, and any steels",') > 0);
    assert.ok(REGISTRY.indexOf(',"How far is the heat pump from your nearest neighbour\'s window or door?",') > 0);
});

test('the committed registry: the corrected labels, the heat rows\' floor condition, goods_date is Note only', function () {
    var q = {};
    parse(REGISTRY).questions.forEach(function (x) { q[x.qid] = x; });
    assert.strictEqual(q.heat_user_hp.label, 'Your heat pump: make, model and where it will go');
    assert.strictEqual(q.screed.label, 'Screed floors: liquid or hand-mixed, and the depth');
    assert.strictEqual(q.joists.label, 'Joisted floors: joist type, direction and spacing, and any steels');
    assert.strictEqual(q.nb_distance.label, 'How far is the heat pump from your nearest neighbour\'s window or door?');
    ['heat_boiler', 'heat_user_hp', 'heat_other', 'cylinder'].forEach(function (id) {
        assert.ok(/;service=ufh_plus,hp;fc=solid,joisted,overfloor,acoustic,unknown$/.test(q[id].whenText), id);
    });
    assert.strictEqual(q.heat_boiler.whenText, 'heat=boiler;service=ufh_plus,hp;fc=solid,joisted,overfloor,acoustic,unknown');
    assert.strictEqual(q.goods_date.store, 'note', 'amendment 1 §1');
    assert.strictEqual(q.goods_date.field, '');
    assert.strictEqual(q.build_stage.optionsFromField, true);
    assert.strictEqual(q.ins_choice.field, 'custbody_pq_cylinder_location', 'the EPC/SAP field, deliberately');
    // 2.4.0: no images yet.
    Object.keys(q).forEach(function (id) { assert.strictEqual(q[id].image, '', id); });
});

// ---------------------------------------------------------------- parseRegistry

test('registry: a BOM, CRLF, quoted commas, doubled quotes and an embedded newline (Excel output)', function () {
    var text = '\ufeff' + reg(['plans,Your plans,main,a1,long,"Ceilings, walls","He said ""hi""\nthen left",,note,N,,"Why, then"'], '\r\n');
    var r = parse(text);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.questions[0].label, 'Ceilings, walls');
    assert.strictEqual(r.questions[0].hint, 'He said "hi"\nthen left');
    assert.strictEqual(r.questions[0].why, 'Why, then');
});

test('registry: unquoted fields work too (a hand edit), extra columns are ignored, column order is free', function () {
    var r = di.parseRegistry('why,qid,section,section_title,panel,type,label,hint,options,field,required,when,extra\n' +
        'Because,a1,plans,Your plans,main,text,Year built,,,custbody15,Y,,ignored\n', ALLOW, DENY);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.questions[0].field, 'custbody15');
    assert.strictEqual(r.questions[0].required, true);
    assert.strictEqual(r.questions[0].why, 'Because');
});

test('registry: a missing column makes it invalid; empty text is empty; an unterminated quote is invalid', function () {
    assert.strictEqual(parse('section,section_title,panel,qid,type,label,hint,options,field,required,when\n').status, 'invalid');
    assert.ok(/missing column: why/.test(parse('section,section_title,panel,qid,type,label,hint,options,field,required,when\n').detail));
    assert.strictEqual(parse('').status, 'empty');
    assert.strictEqual(parse(reg([])).status, 'empty');
    assert.strictEqual(parse(reg(['plans,P,main,a,text,"oops,,,note,N,,'])).status, 'invalid');
});

test('registry: a bad row is rejected and listed, never the file', function () {
    var r = parse(reg([
        'plans,P,main,ok1,text,Fine,,,note,N,,',
        'plans,P,main,t1,slider,Bad type,,,note,N,,',
        'plans,P,main,ok1,text,Second ok1,,,note,N,,',
        'plans,P,main,f1,text,Not allowed,,,custbody_not_a_field,N,,',
        'plans,P,main,f2,text,Not a custbody,,,title,N,,',
        'plans,P,main,c1,choice,No options,,,note,N,,',
        'plans,P,main,c2,choice,Literal,,"A|B| |C",note,N,,',
        'project,P,main,c3,choice,From the field,,@field,custbody_build_stage,N,,',
        'plans,P,main,c4,choice,@field on a note,,@field,note,N,,',
        'plans,P,main,w1,text,Bad when,,,note,N,service=,',
        'plans,P,main,w2,text,Unknown key,,,note,N,colour=red,',
        'plans,P,main,w3,text,Unknown value,,,note,N,heat=gas,',
        'plans,P,main,s1,text,State on text,,,state,N,,',
        'plans,P,main,s2,yesno,State yesno,,,state,Y,,',
        'plans,P,main,r1,text,Bad required,,,note,maybe,,',
        'plans,P,main,Bad-Id,text,Upper case,,,note,N,,',
        'plans,P,main,fl,files,Files to a field,,,custbody15,N,,'
    ]));
    var why = {};
    r.rejected.forEach(function (x) { why[x.qid] = x.reason; });
    assert.deepStrictEqual(r.questions.map(function (q) { return q.qid; }), ['ok1', 'c2', 'c3', 's2']);
    assert.ok(/unknown type "slider"/.test(why.t1));
    assert.ok(/duplicate qid "ok1"/.test(why.ok1), 'the SECOND occurrence');
    assert.ok(/not an opportunity field the dashboard knows/.test(why.f1));
    assert.ok(/not an opportunity field/.test(why.f2), 'title is not a custbody_ field');
    assert.ok(/a choice needs options/.test(why.c1));
    assert.deepStrictEqual(r.questions[1].options, ['A', 'B', 'C']);
    assert.strictEqual(r.questions[2].optionsFromField, true);
    assert.ok(/@field" needs a field/.test(why.c4));
    assert.ok(/when:/.test(why.w1) && /unknown key "colour"/.test(why.w2) && /"gas" is not a value of heat/.test(why.w3));
    assert.ok(/state" is for yesno/.test(why.s1));
    assert.strictEqual(r.questions[3].store, 'state');
    assert.ok(/required must be Y or N/.test(why.r1));
    assert.ok(/lower-case/.test(why['Bad-Id']));
    assert.ok(/writes no field/.test(why.fl));
    assert.strictEqual(r.rejected[0].line, 3, 'the CSV line');
});

test('registry DENY-LIST (amendment 1 §7): custbody_opp_del_date is in the allow-list but every row writing it is rejected', function () {
    assert.ok(ALLOW.indexOf('custbody_opp_del_date') >= 0, 'FIELDS.OPPORTUNITY.DEL_DATE is in the allow-list');
    assert.ok(ALLOW.indexOf('custbody_build_stage') >= 0 && ALLOW.indexOf('custbody_pq_cylinder_location') >= 0);
    ['custbody_opp_del_date', 'custbody_opportunity_sub_status', 'custbody_mi_opp_fc', 'custbody_mi_heat_source',
        'custbody_mis_opp_market', 'custbody_cad_des_contact', 'custbody_cdb_designinfo_state'].forEach(function (f) {
        var r = parse(reg(['project,P,main,x,date,X,,,' + f + ',N,,']));
        assert.strictEqual(r.questions.length, 0, f);
        assert.ok(/may never be written from this page/.test(r.rejected[0].reason), f);
    });
});

// ---------------------------------------------------------------- buildFacts

test('buildFacts: each FC_MAP token, pairs, none, hp, unknown and an unlisted ID', function () {
    assert.deepStrictEqual(facts({ fc: '1' }).fc, ['solid']);
    assert.deepStrictEqual(facts({ fc: '2' }).fc, ['joisted']);
    assert.deepStrictEqual(facts({ fc: '3' }).fc, ['overfloor']);
    assert.deepStrictEqual(facts({ fc: '4' }).fc, ['acoustic']);
    assert.deepStrictEqual(facts({ fc: '5' }).fc, ['solid', 'joisted']);
    assert.deepStrictEqual(facts({ fc: '9' }).fc, ['solid', 'joisted', 'overfloor']);
    assert.deepStrictEqual(facts({ fc: '6' }).fc, ['none']);
    assert.deepStrictEqual(facts({ fc: '7' }).fc, ['hp']);
    assert.deepStrictEqual(facts({ fc: '8' }).fc, ['unknown']);
    assert.deepStrictEqual(facts({ fc: '99' }).fc, ['unknown'], 'unlisted');
    assert.deepStrictEqual(facts({ fc: '' }).fc, ['unknown'], 'blank');
    assert.ok(facts({ fc: '99' }).warnings.some(function (w) { return /FC 99 is not in FC_MAP/.test(w); }));
    assert.strictEqual(di.isFcNone(facts({ fc: '6' }).fc), true);
    // A bad entry is ignored, its ID unknown, and the problem listed.
    var f = di.buildFacts({ fc: '1' }, { FC_MAP: '{"1": "none|solid", "2": "solid|solid", "3": "concrete"}' });
    assert.deepStrictEqual(f.fc, ['unknown']);
    assert.ok(/FC_MAP entries ignored/.test(f.mapProblems[0]));
    assert.deepStrictEqual(di.buildFacts({ fc: '1' }, { FC_MAP: 'not json' }).mapProblems, ['FC_MAP ignored: not JSON']);
});

test('buildFacts: each HEAT_MAP value, other for unmapped; the service; new build; the warnings', function () {
    assert.strictEqual(facts({ heatSource: '11' }).heat, 'boiler');
    assert.strictEqual(facts({ heatSource: '12' }).heat, 'nuheat_hp');
    assert.strictEqual(facts({ heatSource: '13' }).heat, 'user_hp');
    assert.strictEqual(facts({ heatSource: '14' }).heat, 'other');
    assert.strictEqual(facts({ heatSource: '15' }).heat, 'other');
    assert.ok(facts({ heatSource: '15' }).warnings.some(function (w) { return /Heat source 15 is not in HEAT_MAP/.test(w); }));
    assert.strictEqual(facts({ heatSource: '14' }).warnings.some(function (w) { return /Heat source/.test(w); }), false);
    assert.strictEqual(facts({ valueProposition: '21' }).service, 'ufh');
    assert.strictEqual(facts({ valueProposition: '22' }).service, 'ufh_plus');
    assert.strictEqual(facts({ valueProposition: '23' }).service, 'hp');
    assert.strictEqual(facts({ valueProposition: '24' }).service, 'unknown');
    assert.ok(facts({ valueProposition: '24' }).warnings[0].indexOf('UFH Design + questions') > 0);
    assert.strictEqual(facts({ market: '31' }).newbuild, true);
    assert.strictEqual(facts({ market: '32' }).newbuild, false);
    assert.strictEqual(facts({ subStatus: '1' }).substatusMode, 'edit');
    assert.strictEqual(facts({ subStatus: '4' }).substatusMode, 'view');
    assert.strictEqual(facts({ subStatus: '8' }).substatusMode, '');
    assert.ok(facts({ valueProposition: '23', heatSource: '11' }).warnings.indexOf(
        'The design service is HP Design, but the heat source is not a Nu-Heat heat pump.') >= 0);
    assert.ok(facts({ valueProposition: '21', heatSource: '12' }).warnings.indexOf(
        'The heat source is a Nu-Heat heat pump, but the design service is not HP Design.') >= 0);
    // Unknowns are explicit values, never undefined.
    var f = di.buildFacts({}, {});
    assert.deepStrictEqual([f.service, f.fc, f.heat, f.newbuild], ['unknown', ['unknown'], 'other', false]);
});

// ---------------------------------------------------------------- whenMatches

test('whenMatches: AND across ;, OR within ,, empty is true, fc matches any token, unknown service as UFH Design +', function () {
    var f = { service: 'hp', fc: ['solid', 'joisted'], heat: 'nuheat_hp', newbuild: false };
    assert.strictEqual(di.whenMatches('', f), true);
    assert.strictEqual(di.whenMatches('service=ufh_plus,hp', f), true);
    assert.strictEqual(di.whenMatches('service=ufh', f), false);
    assert.strictEqual(di.whenMatches('service=hp;newbuild=yes', f), false);
    assert.strictEqual(di.whenMatches('service=hp;newbuild=no', f), true);
    assert.strictEqual(di.whenMatches('fc=joisted', f), true, 'one token of a pair');
    assert.strictEqual(di.whenMatches('fc=overfloor,acoustic', f), false);
    assert.strictEqual(di.whenMatches('heat=nuheat_hp;fc=solid', f), true);
    assert.strictEqual(di.whenMatches('service=ufh_plus', { service: 'unknown', fc: ['unknown'] }), true);
    assert.strictEqual(di.whenMatches('service=ufh', { service: 'unknown', fc: ['unknown'] }), false);
    assert.strictEqual(di.whenMatches('colour=red', f), false, 'a when that does not parse never matches');
});

// ---------------------------------------------------------------- visibility

test('visibility: the three services x a solid+joisted pair x a Nu-Heat heat pump', function () {
    var base = { fc: '5', heatSource: '12', market: '32' };
    assert.deepStrictEqual(sectionIds(facts(Object.assign({ valueProposition: '21' }, base))),
        ['project', 'plans', 'heating', 'heatpump', 'other'], 'UFH Design: no insulation');
    assert.deepStrictEqual(sectionIds(facts(Object.assign({ valueProposition: '22' }, base))),
        ['project', 'plans', 'insulation', 'heating', 'heatpump', 'other']);
    assert.deepStrictEqual(sectionIds(facts(Object.assign({ valueProposition: '23' }, base))),
        ['project', 'plans', 'insulation', 'heating', 'heatpump', 'other']);
    // The questions themselves: floor coverings only with UFH Design + or HP; both floor panels for the pair.
    function qids(vp) {
        return di.visibleQuestions(parse(REGISTRY).questions, facts(Object.assign({ valueProposition: vp }, base)))
            .map(function (q) { return q.qid; });
    }
    assert.strictEqual(qids('21').indexOf('coverings'), -1);
    assert.ok(qids('22').indexOf('coverings') >= 0);
    assert.ok(qids('23').indexOf('screed') >= 0 && qids('23').indexOf('joists') >= 0);
    assert.strictEqual(qids('23').indexOf('overfloor'), -1);
    assert.strictEqual(qids('23').indexOf('heat_boiler'), -1, 'a Nu-Heat heat pump: no boiler question');
    assert.ok(qids('23').indexOf('walls_ex') >= 0 && qids('23').indexOf('walls_new') === -1, 'existing, not new build');
});

test('visibility: heat pump only (fc=hp) sees no heating section at all (amendment 1 §2), even with an unmapped heat source', function () {
    assert.deepStrictEqual(sectionIds(facts({ valueProposition: '23', fc: '7', heatSource: '12' })),
        ['project', 'plans', 'insulation', 'heatpump', 'other']);
    assert.deepStrictEqual(sectionIds(facts({ valueProposition: '23', fc: '7', heatSource: '99' })),
        ['project', 'plans', 'insulation', 'other'], 'heat other, but no floor token: no heat_other');
});

// ---------------------------------------------------------------- progress

test('sectionStatus and completeness: required answers, files, state answers, noted marks, unavailable questions', function () {
    var qs = parse(reg([
        'plans,Your plans,main,p1,yesno,Current?,,,state,Y,,',
        'plans,Your plans,main,p2,files,Plans,,,note,Y,,',
        'plans,Your plans,main,p3,long,Ceilings,,,custbody_sections_ceiling_heights_2026,N,,',
        'heating,Heating,main,h1,long,Boiler,,,note,Y,,',
        'heating,Heating,main,h2,long,Manifolds,,,custbody_manifold_locations_2026,Y,,',
        'other,Other,main,o1,long,Anything,,,note,N,,'
    ])).questions;
    var state = di.emptyState();
    var plans = qs.slice(0, 3);
    assert.strictEqual(di.sectionStatus(plans, {}, state), 'todo');
    state.answers.p1 = 'yes';
    assert.strictEqual(di.sectionStatus(plans, {}, state), 'todo', 'the files are still needed');
    state.files.push({ qid: 'p2', id: '1', name: 'a.pdf', at: '2026-10-02T10:00:00Z' });
    assert.strictEqual(di.sectionStatus(plans, {}, state), 'done');
    assert.strictEqual(di.sectionStatus(qs.slice(5), {}, state), 'optional');
    var c = di.completeness(qs, { h2: 'Utility' }, state);
    assert.deepStrictEqual(c, { complete: false, missing: ['Heating'], sections: [{ id: 'plans', title: 'Your plans', status: 'done' },
        { id: 'heating', title: 'Heating', status: 'todo' }, { id: 'other', title: 'Other', status: 'optional' }] });
    state.noted.h1 = '2026-10-02T10:00:00Z';
    assert.strictEqual(di.completeness(qs, { h2: 'Utility' }, state).complete, true, 'a long Note answer, noted');
    // A question the page cannot take (missing or mismatched field) does not count.
    var h2 = Object.assign({}, qs[4], { unavailable: true });
    assert.strictEqual(di.sectionStatus([qs[3], h2], {}, state), 'done');
});

test('progressFromState, cardState: the four card states and FC none', function () {
    var qs = parse(REGISTRY).questions;
    var f = facts({ valueProposition: '22', fc: '1', heatSource: '11' });
    var shown = di.visibleQuestions(qs, f);
    var state = di.emptyState();
    assert.strictEqual(di.cardState({ needInfo: true, state: state }), 'needs_info');
    state.sections.plans = { saved: '2026-10-02T10:00:00Z', status: 'done' };
    assert.strictEqual(di.cardState({ needInfo: true, state: state }), 'info_partial');
    var p = di.progressFromState(shown, state);
    assert.deepStrictEqual(p.done, ['Your plans']);
    assert.deepStrictEqual(p.missing, ['How well insulated is it?', 'Heating and controls']);
    assert.strictEqual(p.pct, 33);
    state.sent = '2026-10-02T11:00:00Z';
    assert.strictEqual(di.cardState({ needInfo: true, state: state }), 'info_sent');
    assert.strictEqual(di.cardState({ needInfo: false, state: state }), 'designing');
    assert.strictEqual(di.cardState({ needInfo: true, fcNone: true, state: state }), 'fc_none');
});

// ---------------------------------------------------------------- the state

test('parseState: empty, unparsable, wrong version and a good one; stateText writes version 2 and round-trips', function () {
    assert.strictEqual(di.parseState('').status, 'empty');
    assert.strictEqual(di.parseState('{oops').status, 'invalid');
    assert.strictEqual(di.parseState('[1]').status, 'invalid');
    assert.strictEqual(di.parseState('{"v": 3}').status, 'invalid');
    assert.deepStrictEqual(di.parseState('{oops').state, di.emptyState(), 'never throws: an empty state');
    var s = di.emptyState();
    s.answers = { bigfiles: 'no', goods_date: '2026-11-28' };
    s.sections = { plans: { saved: '2026-10-02T14:02:33.123Z', status: 'done' }, other: { saved: '2026-10-02T14:02Z',
        status: 'optional' } };
    s.noted = { heat_boiler: true };
    s.files = [{ qid: 'plans_files', id: '123', name: 'a.pdf', at: '2026-10-02T14:02Z', attached: false }];
    s.requested = '2026-10-01T09:00:00Z';
    var text = di.stateText(s);
    assert.deepStrictEqual(JSON.parse(text), { v: 2, s: { plans: { at: '2026-10-02T14:02Z', st: 'done' }, other: {
        at: '2026-10-02T14:02Z', st: 'opt' } }, a: { bigfiles: 'no', goods_date: '2026-11-28' }, n: ['heat_boiler'],
        f: [{ q: 'plans_files', id: '123', n: 'a.pdf', at: '2026-10-02T14:02Z', x: 1 }], req: '2026-10-01T09:00Z', sent: '',
        task: '' });
    var back = di.parseState(text).state;
    assert.strictEqual(back.sections.other.status, 'optional');
    assert.strictEqual(back.files[0].attached, false);
    assert.deepStrictEqual(back.noted, { heat_boiler: true });
    assert.strictEqual(di.stateText(back), text, 'stable');
});

test('A3. a version 1 state migrates on read: pending dropped, keys renamed, written back as version 2', function () {
    var v1 = JSON.stringify({ v: 1, requested: '2026-10-01T09:00:00Z', sent: '2026-10-02T14:10:00Z', lastTaskAt: '2026-10-02T14:10:00Z',
        sections: { plans: { saved: '2026-10-02T14:02:00Z', status: 'done' }, other: { saved: 'x', status: 'optional' } },
        answers: { plans_current: 'yes' }, noted: { heat_boiler: '2026-10-02T14:02:00Z' },
        files: [{ qid: 'plans_files', id: '123', name: 'a.pdf', at: '2026-10-02T14:02:00Z', size: 99, attached: true }],
        pending: [{ s: 'Your plans', l: 'Ceilings', o: '', n: '2.4 m', at: 'x' }] });
    var p = di.parseState(v1);
    assert.strictEqual(p.status, 'ok');
    assert.strictEqual(p.detail, 'migrated from version 1');
    assert.deepStrictEqual(p.state.sections.plans, { saved: '2026-10-02T14:02:00Z', status: 'done' });
    assert.strictEqual(p.state.sections.other.status, 'optional');
    assert.deepStrictEqual(p.state.noted, { heat_boiler: true });
    assert.strictEqual(p.state.lastTaskAt, '2026-10-02T14:10:00Z');
    assert.strictEqual(p.state.pending, undefined, 'no change list any more');
    var v2 = JSON.parse(di.stateText(p.state));
    assert.strictEqual(v2.v, 2);
    assert.deepStrictEqual([v2.req, v2.sent, v2.task], ['2026-10-01T09:00Z', '2026-10-02T14:10Z', '2026-10-02T14:10Z']);
    assert.strictEqual(JSON.stringify(v2).indexOf('pending'), -1);
});

test('A3. the worst case fits: every section saved, 20 files with 60-character names, every state answer — under 3,500', function () {
    var s = di.emptyState();
    var reg = parse(REGISTRY).questions;
    var i;
    di.sectionsOf(reg).forEach(function (sec) {
        s.sections[sec.id] = { saved: '2026-10-02T14:02:33.000Z', status: 'todo' };
    });
    reg.forEach(function (q) {
        if (q.store === 'state') { s.answers[q.qid] = 'yes'; }
        if (q.store === 'note' && q.type === 'date') { s.answers[q.qid] = '2026-11-28'; }
        if (q.store === 'note' && q.type !== 'date' && q.type !== 'files') { s.noted[q.qid] = true; }
    });
    for (i = 0; i < 25; i++) {
        s.files.push({ qid: 'layouts_files', id: String(45288000 + i), name: Array(80).join('n'), at: '2026-10-02T14:02:33Z',
            attached: i % 2 === 0 });
    }
    s.requested = s.sent = s.lastTaskAt = '2026-10-02T14:02:33Z';
    var text = di.stateText(s);
    var g = di.stateTextGuarded(s);
    assert.strictEqual(JSON.parse(text).f.length, 20, 'at most 20 files');
    assert.strictEqual(JSON.parse(text).f[19].n.length, 60, 'names clipped to 60');
    assert.strictEqual(JSON.parse(text).f[0].id, '45288005', 'the newest kept');
    assert.ok(text.length < 3500, 'worst case ' + text.length + ' characters');
    assert.strictEqual(g.trimmed, false);
    assert.strictEqual(g.text, text);
});

test('A3. the size guard: over 3,500 the files drop to the last 5; never over the field', function () {
    var s = di.emptyState();
    var i;
    for (i = 0; i < 20; i++) {
        s.files.push({ qid: 'plans_files', id: String(i), name: Array(70).join('n'), at: '2026-10-02T14:02Z' });
        s.answers['answer_' + i] = Array(40).join('a');
    }
    assert.ok(di.stateText(s).length > 3500);
    var g = di.stateTextGuarded(s);
    assert.strictEqual(g.trimmed, true);
    assert.deepStrictEqual(JSON.parse(g.text).f.map(function (f) { return f.id; }), ['15', '16', '17', '18', '19']);
    assert.ok(g.text.length <= 3900);
    // Pathological: far too many answers — files and noted go, then the answers; it still fits.
    for (i = 0; i < 200; i++) { s.answers['more_' + i] = Array(40).join('b'); }
    g = di.stateTextGuarded(s);
    assert.ok(g.trimmed && g.text.length <= 3900, String(g.text.length));
    assert.strictEqual(JSON.parse(g.text).v, 2);
});

test('uploads: extensions, the stored name, sizes, London time', function () {
    assert.strictEqual(di.extensionAllowed('Plans.PDF'), true);
    assert.strictEqual(di.extensionAllowed('house.dwg'), true);
    assert.strictEqual(di.extensionAllowed('virus.exe'), false);
    assert.strictEqual(di.extensionAllowed('noext'), false);
    assert.strictEqual(di.uploadName('QR123', 'plans_files', '20261002-1502', 'C:\\Users\\me\\Ground floor (rev B).pdf'),
        'QR123_plans_files_20261002-1502_Ground_floor_rev_B.pdf');
    assert.strictEqual(di.sizeText(1258291), '1.2 MB');
    assert.strictEqual(di.sizeText(350000), '342 KB');
    assert.deepStrictEqual(di.londonTime(Date.UTC(2026, 9, 2, 14, 2)), { key: '2026-10-02', stamp: '20261002-1502',
        text: '02/10/2026 15:02' }, 'BST');
    assert.strictEqual(di.londonTime(Date.UTC(2026, 11, 2, 14, 2)).stamp, '20261202-1402', 'GMT');
});

// ---------------------------------------------------------------- the Note and the Task (task 1.5.0)

test('the Note: sections, sent, old → new with — for blank, files, not saved, large files', function () {
    var n = task.buildDesignInfoNote({
        sectionsSaved: ['Your plans', 'How well insulated is it?'], sent: false,
        blocks: [{ title: 'Your plans', changes: [{ label: 'Ceiling heights', oldText: '', newText: '2.4 m' }],
            files: [{ name: 'QR1_plans_files_x_a.pdf', sizeText: '1.2 MB' }] }, { title: 'Empty', changes: [], files: [] }],
        notSaved: ['coverings (field missing)'], bigFiles: true });
    assert.strictEqual(n.clipped, false);
    assert.strictEqual(n.body, 'Sections saved: Your plans, How well insulated is it?\nSent to PE: no\n\nYour plans\n' +
        ' Ceiling heights: \u2014 \u2192 2.4 m\n Files: QR1_plans_files_x_a.pdf (1.2 MB)\n\n' +
        'Not saved to the record: coverings (field missing)\n\nLarge files: customer has files over 10 MB');
    var big = task.buildDesignInfoNote({ sectionsSaved: ['A'], sent: true, blocks: [{ title: 'A', changes: Array(40).join('x')
        .split('x').map(function () { return { label: 'L', oldText: '', newText: Array(200).join('y') }; }) }] });
    assert.strictEqual(big.clipped, true);
    assert.strictEqual(big.body.length, 3900);
    assert.ok(/\n\(truncated\)$/.test(big.body));
    assert.strictEqual(task.buildDesignInfoTitle('Barn', 'QR1'), 'DESIGN INFO \u2013 Barn');
    assert.strictEqual(task.buildDesignInfoTitle('', 'QR1'), 'DESIGN INFO \u2013 QR1');
});

test('A3. the Task snapshot: every section, (nothing yet), the Notes pointer with and without a previous send, files, Mimecast, warnings', function () {
    var o = { complete: false, missing: ['Heating and controls'], sections: [
        { title: 'Your plans', status: 'done', lines: ['Ceilings: 2.4 m', 'New or extra plans: a.pdf'] },
        { title: 'Heating and controls', status: 'todo', lines: [] }, { title: 'Anything else', status: 'optional', lines: [] }],
        sinceText: '02/10/2026 15:10', files: [{ name: 'a.pdf', label: 'plans_files' }], folderText: 'File Cabinet folder 555',
        goodsLine: 'Customer says goods are needed by 28/11/2026 (we hold 14/11/2026).', bigFiles: true,
        warnings: ['Heat source 15 is not in HEAT_MAP'], notSaved: ['coverings (field missing)'], failures: [], noteFailed: true };
    var m = task.buildDesignInfoMessage(o);
    assert.ok(m.indexOf('The customer has sent design information. Check it on the Project Specification tab and the attached ' +
        'files, then move the sub-status to Design Required when you\u2019re ready.') === 0);
    assert.ok(m.indexOf('Still missing: Heating and controls.') > 0);
    assert.ok(m.indexOf('Your plans (done)\n- Ceilings: 2.4 m\n- New or extra plans: a.pdf\n') > 0);
    assert.ok(m.indexOf('Heating and controls (to do)\n(nothing yet)\n') > 0);
    assert.ok(m.indexOf('Anything else (optional)\n(nothing yet)') > 0);
    assert.ok(m.indexOf('Changes since the last send are in the opportunity\u2019s Notes dated after 02/10/2026 15:10.') > 0);
    assert.ok(m.indexOf('Files uploaded since the last Send (File Cabinet folder 555):\n- a.pdf, plans_files') > 0);
    assert.ok(m.indexOf('Send a Mimecast large-file request.') > 0);
    assert.ok(m.indexOf('Customer says goods are needed by 28/11/2026') > 0);
    assert.ok(m.indexOf('Audit note NOT created') > 0);
    assert.ok(m.indexOf('- Heat source 15 is not in HEAT_MAP') > 0);
    assert.ok(m.indexOf('Not saved to the record (the customer was told we\u2019ll cover it on the call): coverings (field missing).') > 0);
    o.sinceText = '';
    assert.strictEqual(task.buildDesignInfoMessage(o).indexOf('Changes since the last send'), -1, 'omitted with none');
    // Clipped at 3,900.
    o.sections[0].lines = Array(40).join('x').split('x').map(function () { return 'Label: ' + Array(200).join('v'); });
    var c = task.clipBody(task.buildDesignInfoMessage(o));
    assert.strictEqual(c.clipped, true);
    assert.strictEqual(c.body.length, 3900);
});

test('DESIGNINFO_EMAIL: defaults; string overrides of known keys; TIPS only as pairs; invalid keeps the defaults', function () {
    var p = config.parseDesignInfoEmail('');
    assert.strictEqual(p.status, 'empty');
    assert.strictEqual(p.text.BUTTON, 'TELL US ABOUT YOUR PROPERTY');
    p = config.parseDesignInfoEmail('{"SUBJECT": "Hi", "NOPE": "x", "BUTTON": 3, "TIPS": [["a", "b"]]}');
    assert.strictEqual(p.text.SUBJECT, 'Hi');
    assert.strictEqual(p.text.BUTTON, 'TELL US ABOUT YOUR PROPERTY');
    assert.deepStrictEqual(p.text.TIPS, [['a', 'b']]);
    assert.strictEqual(p.text.NOPE, undefined);
    assert.strictEqual(config.parseDesignInfoEmail('{"TIPS": [["a"]]}').text.TIPS.length, 3);
    assert.strictEqual(config.parseDesignInfoEmail('nope').status, 'invalid');
    assert.strictEqual(config.DESIGNINFO_EMAIL.SUBJECT, 'Let\u2019s start your design: tell us about your property');
});

// ---------------------------------------------------------------- amendment 2 (1.0.1)

test('A2. plainValue strips control characters, keeps newlines, never escapes; sameText ignores line endings', function () {
    assert.strictEqual(di.plainValue('Don\'t & "q" <b>\u0007\r\nok'), 'Don\'t & "q" <b>\nok');
    assert.strictEqual(di.plainValue(Array(400).join('a')).length, 300);
    assert.strictEqual(di.sameText('a\r\nb', 'a\nb'), true);
    assert.strictEqual(di.sameText('a\rb ', 'a\nb'), true);
    assert.strictEqual(di.sameText('a', 'b'), false);
});

test('A2. parseFcMapOnly reads FC_MAP alone', function () {
    var m = di.parseFcMapOnly({ FC_MAP: '{"7": "none"}', HEAT_MAP: 'not read' });
    assert.deepStrictEqual(m.fc, { 7: ['none'] });
    assert.strictEqual(m.fcEmpty, false);
    assert.strictEqual(di.parseFcMapOnly({}).fcEmpty, true);
});

test('A2. task.clipBody: 3,900 with (truncated); the Task title is plain text', function () {
    var c = task.clipBody(Array(5000).join('m'));
    assert.strictEqual(c.clipped, true);
    assert.strictEqual(c.body.length, 3900);
    assert.strictEqual(task.clipBody('short').clipped, false);
    assert.strictEqual(task.buildDesignInfoTitle('Barn & "Co"\u0007', 'QR1'), 'DESIGN INFO – Barn & "Co" ');
});
