'use strict';
/**
 * Amendment 1 (30 Sep 2026). Production: "CDB DIGEST_FAILED: Customer 215781: An
 * nlobjSearchFilter contains invalid search criteria: mainline." The opportunity search type has no
 * mainline filter. Every opportunity search, on the Suitelet and in the digest, must leave it out.
 * Sales order searches keep it.
 */
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var ns = require('./helpers/netsuite');

function hasTerm(expr, name) {
    if (!Array.isArray(expr)) { return false; }
    if (expr[0] === name) { return true; }
    return expr.some(function (e) { return hasTerm(e, name); });
}

function byType(w, type) {
    return (w.searches || []).filter(function (d) { return d.type === type; });
}

test('getOpportunities: no mainline term (the Suitelet path)', function () {
    var w = ns.world();
    var data = amd.load('lib/cdb_lib_data', ns.stubs(w));
    var cfg = { LOST_STATUSES: ['14'] };
    var opps = data.getOpportunities('42', cfg);
    var searches = byType(w, 'opportunity');
    assert.strictEqual(searches.length, 1);
    assert.strictEqual(hasTerm(searches[0].filters, 'mainline'), false);
    assert.deepStrictEqual(opps.map(function (o) { return o.id; }), ['4']);
});

test('digest LIVE input: the opportunity search has no mainline term; sales order searches keep it', function () {
    var w = ns.world();
    w.scriptId = 'customscript_cdb_mr_digest';
    w.params = { custscript_cdbmr_won_statuses: '13', custscript_cdbmr_lost_statuses: '14',
        custscript_cdbmr_design_substatus: '1,4,5,13', custscript_cdbmr_needinfo_substatus: '1',
        custscript_cdbmr_delivery_substatus: '8,11', custscript_cdbmr_excluded_statuses: '90',
        custscript_cdbmr_excluded_quote_types: '7,8', custscript_cdbmr_pay_bacs: '1', custscript_cdbmr_pay_card: '2',
        custscript_cdbmr_fallback_employee: '500', custscript_cdb_digest_mode: 'LIVE' };
    var mr = amd.load('cdb_mr_digest', ns.stubs(w));
    mr.getInputData();
    var opp = byType(w, 'opportunity');
    var so = byType(w, 'salesorder');
    assert.strictEqual(opp.length, 1, 'customersWithOpenOpportunity ran');
    assert.strictEqual(hasTerm(opp[0].filters, 'mainline'), false);
    assert.strictEqual(so.length, 1);
    assert.strictEqual(hasTerm(so[0].filters, 'mainline'), true, 'sales order search unchanged');
});

test('the stub rejects mainline on an opportunity search, as NetSuite does', function () {
    var w = ns.world();
    var search = ns.stubs(w)['N/search'];
    assert.throws(function () {
        search.create({ type: 'opportunity', filters: [['mainline', 'is', 'T']] });
    }, /invalid search criteria: mainline/);
});

test('no source file puts mainline on an opportunity search', function () {
    var fs = require('fs');
    var path = require('path');
    var root = path.join(__dirname, '..', 'src');
    function walk(dir) {
        return fs.readdirSync(dir).reduce(function (all, f) {
            var p = path.join(dir, f);
            return all.concat(fs.statSync(p).isDirectory() ? walk(p) : (/\.js$/.test(f) ? [p] : []));
        }, []);
    }
    walk(root).forEach(function (file) {
        var src = fs.readFileSync(file, 'utf8');
        var re = /search\.create\(\{\s*type:\s*search\.Type\.OPPORTUNITY[\s\S]*?\n\s{8}\}\)/g;
        var m;
        while ((m = re.exec(src)) !== null) {
            var code = m[0].replace(/\/\/.*$/gm, '');
            assert.strictEqual(/['"]mainline['"]/.test(code), false, path.basename(file) + ': ' + code);
        }
    });
});
