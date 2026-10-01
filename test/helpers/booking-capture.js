'use strict';
/**
 * 2.2: everything an address-book booking produces — the confirmation page, the record writes, the
 * Task and the logs — on a fixed day, so a later release can prove it byte-identical
 * (test/snapshots/address-book-booking.json, captured from 2.1.2 before 2.2 was written).
 */
var amd = require('./amd');
var ns = require('./netsuite');

var FIXED_NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
var ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

function capture(prepare) {
    var realNow = Date.now;
    var w = ns.world();
    var s;
    var sl;
    var tok;
    var dates;
    var html = '';
    Date.now = function () { return FIXED_NOW; };
    try {
        if (prepare) { prepare(w); }
        s = ns.stubs(w);
        sl = amd.load('cdb_sl_dashboard', s);
        tok = amd.load('lib/cdb_lib_token', s).sign(42, 0);
        dates = amd.load('lib/cdb_lib_dates');
        sl.onRequest({
            request: { method: 'POST', parameters: { t: tok, a: 'delivery', so: '100',
                date: dates.firstAllowedDate(dates.londonTodayKey(Date.now()), 3, {}), time: '5', address: '900',
                vehicle: '2', unload: '3', contactName: 'Sam Site', contactPhone: '07700 900000',
                contactEmail: 'sam@example.com', requests: 'Ring first', payment: 'BACS' } },
            response: { setHeader: function () {}, write: function (o) { html += o.output; } }
        });
    } finally {
        Date.now = realNow;
    }
    return JSON.parse(JSON.stringify({
        html: html,
        saves: w.saves,
        submits: w.submits,
        tasks: w.tasks,
        logs: w.logs.filter(function (l) { return l[1] !== 'CDB USAGE'; })
    }).replace(ISO, 'ISO').split(tok).join('TOKEN'));
}

module.exports = { capture: capture };
