'use strict';
var test = require('node:test');
var assert = require('node:assert');
var amd = require('./helpers/amd');
var fx = require('./helpers/fixtures');

var CFG = fx.CFG;

/**
 * N/search stub. search.create records the filters; running it returns the fixture rows that pass
 * the native status filter, the way NetSuite applies it. Rows carry statusCode ('SalesOrd:G').
 */
function searchStub(rows, captured) {
    function findStatus(expr) {
        var i;
        var found;
        if (!Array.isArray(expr)) { return null; }
        if (expr[0] === 'status' && expr[1] === 'anyof') { return expr[2]; }
        for (i = 0; i < expr.length; i++) {
            found = findStatus(expr[i]);
            if (found) { return found; }
        }
        return null;
    }
    return {
        Type: { SALES_ORDER: 'salesorder' },
        Sort: { ASC: 'ASC' },
        createColumn: function (c) { return c; },
        create: function (def) {
            var allowed = findStatus(def.filters);
            captured.push(def);
            var hits = rows.filter(function (r) { return !allowed || allowed.indexOf(r.statusCode) >= 0; });
            return {
                runPaged: function () {
                    return {
                        pageRanges: [{ index: 0 }],
                        fetch: function () {
                            return { data: hits.map(function (r) {
                                return {
                                    id: r.id,
                                    getValue: function (n) {
                                        var map = { tranid: r.tranId, entity: '', opportunity: r.opportunityId,
                                            custbody_finance_status: r.recordStatus, custbody_quote_type: r.quoteType,
                                            custbody_cust_pay_intent: '', custbody_ready_for_delivery: r.ready ? 'T' : 'F' };
                                        return map[n] === undefined ? '' : map[n];
                                    },
                                    getText: function (n) { return n === 'custbody_quote_type' ? r.quoteTypeText : ''; }
                                };
                            }) };
                        }
                    };
                }
            };
        }
    };
}

function loadData(rows, captured) {
    return amd.load('lib/cdb_lib_data', {
        'N/search': searchStub(rows || [], captured || []),
        'N/format': { Type: { DATE: 'date' }, parse: function () { return new Date(NaN); } },
        'N/record': {}, 'N/runtime': {}
    });
}

test('stage grouping from fixture rows', function () {
    var data = loadData();
    var opps = [
        fx.opp('1', '10', ''),              // quote
        fx.opp('2', '13', '1'),             // won, awaiting design info
        fx.opp('3', '13', '4'),             // won, designing
        fx.opp('4', '13', '8'),             // won, design complete, orders below
        fx.opp('5', '14', '8'),             // lost: never shown
        fx.opp('6', '13', '12'),            // delivered: not shown
        fx.opp('7', '13', '11')             // partially delivered, but only a Parts order
    ];
    var orders = [
        fx.order('100', '4', { ready: true }),
        fx.order('101', '4', { holdReason: 'Awaiting DNO' }),
        fx.order('102', '4', { payIntent: '1', shipDateKey: '2026-10-05', timeText: 'AM delivery' }),
        fx.order('103', '4', { confirmedDateKey: '2026-10-07', payIntent: '1', ready: true }),
        fx.order('104', '4', { quoteType: '7', ready: true }),       // Parts: hidden
        fx.order('105', '4', { recordStatus: '90', ready: true }),   // excluded Record Status: hidden
        fx.order('106', '7', { quoteType: '8' })                      // FOC only
    ];
    var g = data.groupProjects(opps, orders, CFG);

    assert.deepStrictEqual(g.toOrder.map(function (o) { return o.id; }), ['1']);
    assert.deepStrictEqual(g.inDesign.map(function (r) { return [r.opp.id, r.badge]; }),
        [['2', 'needs_info'], ['3', 'designing']]);
    assert.strictEqual(g.forDelivery.length, 1, 'opp 7 has no visible order, so it is not shown');
    assert.strictEqual(g.forDelivery[0].opp.id, '4');
    assert.deepStrictEqual(g.forDelivery[0].orders.map(function (r) { return [r.order.id, r.state]; }), [
        ['100', 'ready'], ['101', 'needs_info'], ['102', 'awaiting_payment'], ['103', 'booked']
    ]);
    assert.strictEqual(g.anyReady, true);
    assert.strictEqual(g.isEmpty, false);
});

test('empty sections and nothing to show', function () {
    var data = loadData();
    var g = data.groupProjects([fx.opp('6', '13', '12')], [], CFG);
    assert.strictEqual(g.isEmpty, true);
    assert.strictEqual(g.anyReady, false);
});

test('SO state order: booked beats payment beats ready', function () {
    var data = loadData();
    assert.strictEqual(data.orderState(fx.order('1', '1', { confirmedDateKey: '2026-10-07', payIntent: '1', ready: true })), 'booked');
    assert.strictEqual(data.orderState(fx.order('1', '1', { payIntent: '2', ready: true })), 'awaiting_payment');
    assert.strictEqual(data.orderState(fx.order('1', '1', { ready: true })), 'ready');
    assert.strictEqual(data.orderState(fx.order('1', '1', {})), 'needs_info');
});

test('open order: opportunity, Record Status, quote type', function () {
    var data = loadData();
    assert.strictEqual(data.isOpenOrder(fx.order('1', '4', { recordStatus: '' }), CFG), true, 'blank status is open');
    assert.strictEqual(data.isOpenOrder(fx.order('1', '4', { recordStatus: '91' }), CFG), false);
    assert.strictEqual(data.isOpenOrder(fx.order('1', '', {}), CFG), false);
    assert.strictEqual(data.isOpenOrder(fx.order('1', '4', { quoteType: '' }), CFG), true, 'blank quote type is not excluded');
    assert.strictEqual(data.isOpenOrder(fx.order('1', '4', { quoteType: '8' }), CFG), false);
});

test('addendum: the native status filter is A, B, D, E only', function () {
    var data = loadData();
    var f = JSON.stringify(data.openOrderFilters());
    assert.ok(f.indexOf('["status","anyof",["SalesOrd:A","SalesOrd:B","SalesOrd:D","SalesOrd:E"]]') >= 0, f);
    ['SalesOrd:C', 'SalesOrd:F', 'SalesOrd:G', 'SalesOrd:H'].forEach(function (s) {
        assert.strictEqual(f.indexOf(s), -1, s);
    });
});

test('addendum: a Billed SO with a blank Record Status is not shown; a Pending Fulfillment SO is', function () {
    var captured = [];
    var rows = [
        Object.assign(fx.order('200', '4', { ready: true, recordStatus: '' }), { statusCode: 'SalesOrd:G' }),
        Object.assign(fx.order('201', '4', { ready: true, recordStatus: '' }), { statusCode: 'SalesOrd:B' })
    ];
    var data = loadData(rows, captured);
    var orders = data.getOrdersForOpportunities(['4']);
    var g = data.groupProjects([fx.opp('4', '13', '8')], orders, CFG);
    assert.deepStrictEqual(g.forDelivery[0].orders.map(function (r) { return r.order.id; }), ['201']);
    assert.strictEqual(captured.length, 1);
});

test('C6 recipient: PE case, PE missing, no rep, value props empty', function () {
    var data = loadData();
    assert.deepStrictEqual(data.resolveRecipient({ valueProposition: '2', pe: '77', salesRep: '88' }, CFG),
        { employeeId: '77', source: 'pe' });
    assert.deepStrictEqual(data.resolveRecipient({ valueProposition: '3', pe: '', salesRep: '88' }, CFG),
        { employeeId: '88', source: 'salesrep' }, 'PE case with no PE falls back to the rep');
    assert.deepStrictEqual(data.resolveRecipient({ valueProposition: '1', pe: '77', salesRep: '88' }, CFG),
        { employeeId: '88', source: 'salesrep' });
    assert.deepStrictEqual(data.resolveRecipient({ valueProposition: '2', pe: '', salesRep: '' }, CFG),
        { employeeId: '500', source: 'fallback' });
    assert.deepStrictEqual(data.resolveRecipient({ valueProposition: '2', pe: '77', salesRep: '88' },
        Object.assign({}, CFG, { PE_VALUEPROPS: [] })), { employeeId: '88', source: 'salesrep' },
        'empty parameter: always the sales rep');
});
