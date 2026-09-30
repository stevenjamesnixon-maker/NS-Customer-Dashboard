'use strict';
var test = require('node:test');
var assert = require('node:assert');
var dates = require('./helpers/amd').load('lib/cdb_lib_dates');

var NONE = dates.toSet([]);

test('brief B4 example: Tue 29 Sep 2026, N=3 -> Mon 5 Oct', function () {
    assert.strictEqual(dates.dayOfWeek('2026-09-29'), 2);
    assert.strictEqual(dates.firstAllowedDate('2026-09-29', 3, NONE), '2026-10-05');
    assert.strictEqual(dates.dayOfWeek('2026-10-05'), 1);
    // 30 Sep, 1 Oct and 2 Oct are skipped; the weekend is not allowed either.
    ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
        .forEach(function (key) {
            assert.strictEqual(dates.isAllowedDate(key, '2026-09-29', 3, NONE, 6), false, key);
        });
    assert.strictEqual(dates.isAllowedDate('2026-10-05', '2026-09-29', 3, NONE, 6), true);
});

test('a bank holiday is not a working day and does not count towards the notice', function () {
    // Christmas 2026: Fri 25 Dec, Mon 28 Dec (Boxing Day substitute).
    var holidays = dates.toSet(['2026-12-25', '2026-12-28']);
    // Today Wed 23 Dec, N=3: skip Thu 24, Tue 29, Wed 30 -> Thu 31 Dec.
    assert.strictEqual(dates.firstAllowedDate('2026-12-23', 3, holidays), '2026-12-31');
    assert.strictEqual(dates.isWorkingDay('2026-12-25', holidays), false);
    // A holiday after the first date is still refused.
    holidays = dates.toSet(['2026-10-12']);
    assert.strictEqual(dates.isAllowedDate('2026-10-12', '2026-09-29', 3, holidays, 6), false);
    assert.strictEqual(dates.isAllowedDate('2026-10-13', '2026-09-29', 3, holidays, 6), true);
    assert.strictEqual(dates.allowedDates('2026-09-29', 3, holidays, 6).indexOf('2026-10-12'), -1);
});

test('weekends are never allowed, and are skipped when counting the notice', function () {
    assert.strictEqual(dates.isAllowedDate('2026-10-10', '2026-09-29', 3, NONE, 6), false);
    assert.strictEqual(dates.isAllowedDate('2026-10-11', '2026-09-29', 3, NONE, 6), false);
    // Today Fri 2 Oct, N=3: skip Mon 5, Tue 6, Wed 7 -> Thu 8 Oct.
    assert.strictEqual(dates.firstAllowedDate('2026-10-02', 3, NONE), '2026-10-08');
    // Today Sat 3 Oct, N=1: skip Mon 5 -> Tue 6.
    assert.strictEqual(dates.firstAllowedDate('2026-10-03', 1, NONE), '2026-10-06');
    dates.allowedDates('2026-09-29', 3, NONE, 6).forEach(function (key) {
        assert.strictEqual(dates.isWeekend(key), false, key);
    });
});

test('N=0: the first working day after today; today itself never', function () {
    assert.strictEqual(dates.firstAllowedDate('2026-09-29', 0, NONE), '2026-09-30');
    assert.strictEqual(dates.isAllowedDate('2026-09-29', '2026-09-29', 0, NONE, 6), false);
    // Friday -> Monday.
    assert.strictEqual(dates.firstAllowedDate('2026-10-02', 0, NONE), '2026-10-05');
});

test('the six-month limit is inclusive and clamps to month end', function () {
    assert.strictEqual(dates.lastAllowedDate('2026-09-29', 6), '2027-03-29');
    assert.strictEqual(dates.isAllowedDate('2027-03-29', '2026-09-29', 3, NONE, 6), true); // Monday
    assert.strictEqual(dates.isAllowedDate('2027-03-30', '2026-09-29', 3, NONE, 6), false);
    var all = dates.allowedDates('2026-09-29', 3, NONE, 6);
    assert.strictEqual(all[0], '2026-10-05');
    assert.strictEqual(all[all.length - 1], '2027-03-29');
    assert.strictEqual(dates.lastAllowedDate('2026-08-31', 6), '2027-02-28');
});

test('invalid keys are refused', function () {
    ['', '2026-02-30', '2026-10-5', 'x', null].forEach(function (key) {
        assert.strictEqual(dates.isAllowedDate(key, '2026-09-29', 3, NONE, 6), false, String(key));
    });
});

test('today is London\'s today, across the BST changes', function () {
    // 29 Sep 2026 23:30 UTC is 30 Sep 00:30 BST.
    assert.strictEqual(dates.londonTodayKey(Date.UTC(2026, 8, 29, 23, 30)), '2026-09-30');
    // 29 Dec 2026 23:30 UTC is still 29 Dec in GMT.
    assert.strictEqual(dates.londonTodayKey(Date.UTC(2026, 11, 29, 23, 30)), '2026-12-29');
    // BST ends 01:00 UTC Sun 25 Oct 2026.
    assert.strictEqual(dates.londonTodayKey(Date.UTC(2026, 9, 24, 23, 30)), '2026-10-25');
    assert.strictEqual(dates.londonTodayKey(Date.UTC(2026, 9, 25, 23, 30)), '2026-10-25');
    // BST starts 01:00 UTC Sun 29 Mar 2026.
    assert.strictEqual(dates.londonTodayKey(Date.UTC(2026, 2, 28, 23, 30)), '2026-03-28');
    assert.strictEqual(dates.londonTodayKey(Date.UTC(2026, 2, 29, 23, 30)), '2026-03-30');
});

test('the calendar starts weeks on Monday and covers the window', function () {
    var months = dates.calendarMonths('2026-09-29', '2027-03-29');
    assert.strictEqual(months.length, 7);
    assert.strictEqual(months[0].title, 'September 2026');
    assert.strictEqual(months[1].weeks[0][3], '2026-10-01'); // Thursday
    assert.strictEqual(months[1].weeks[0][2], null);
    months.forEach(function (m) {
        m.weeks.forEach(function (w) { assert.strictEqual(w.length, 7); });
    });
});

test('formatLong and write dates', function () {
    assert.strictEqual(dates.formatLong('2026-10-05'), 'Mon 5 October 2026');
    var d = dates.localDateForWrite('2026-10-05');
    assert.strictEqual(dates.keyFromLocalDate(d), '2026-10-05');
    assert.strictEqual(d.getHours(), 12);
});
