/**
 * cdb_lib_dates.js
 *
 * Pure date rules for arranging delivery: working days, the earliest allowed date, the booking
 * window. No NetSuite module is used, so every function is node-tested (test/dates.test.js).
 *
 * DATES ARE KEYS. Every date here is a 'YYYY-MM-DD' string: a calendar day with no time and no
 * time zone. Arithmetic is done in UTC on those days, so the server's own time zone (NetSuite
 * servers run on Pacific time) can never move a day. Converting to and from NetSuite's Date
 * objects happens in the callers, at the edge.
 *
 * TODAY IS LONDON'S TODAY. londonTodayKey() applies the UK daylight-saving rule itself (BST from
 * 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October) rather than
 * relying on Intl or the server's zone, which differ between runtimes.
 *
 * THE EARLIEST DATE. With notice N, the next N working days after today are skipped and the
 * first allowed date is the working day after them. The brief's worked example is the rule:
 * Tue 29 Sep 2026, N = 3 -> 30 Sep, 1 Oct and 2 Oct skipped -> Mon 5 Oct. Its prose ("the Nth
 * working day after today") would give Fri 2 Oct; the example wins and the difference is reported
 * in the PR. N = 0 skips nothing: the first working day after today. Today itself is never allowed.
 *
 * A working day is Monday to Friday and not on the non-delivery list.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.3.3
 */
define([], function () {

    'use strict';

    var VERSION = '1.3.3';

    var DAY_MS = 86400000;

    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'];

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    /**
     * @param {number} y
     * @param {number} m - 1 to 12
     * @param {number} d
     * @returns {string} 'YYYY-MM-DD'
     */
    function makeKey(y, m, d) {
        return y + '-' + pad2(m) + '-' + pad2(d);
    }

    /**
     * @param {string} key
     * @returns {{y: number, m: number, d: number}|null} null unless key is a real calendar day
     */
    function parseKey(key) {
        var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
        var y;
        var m;
        var d;
        var check;
        if (!match) {
            return null;
        }
        y = parseInt(match[1], 10);
        m = parseInt(match[2], 10);
        d = parseInt(match[3], 10);
        check = new Date(Date.UTC(y, m - 1, d));
        if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
            return null;
        }
        return { y: y, m: m, d: d };
    }

    function isValidKey(key) {
        return parseKey(key) !== null;
    }

    function keyToUtcMs(key) {
        var p = parseKey(key);
        return Date.UTC(p.y, p.m - 1, p.d);
    }

    function utcMsToKey(ms) {
        var date = new Date(ms);
        return makeKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }

    /**
     * @param {string} key
     * @param {number} days - may be negative
     * @returns {string}
     */
    function addDays(key, days) {
        return utcMsToKey(keyToUtcMs(key) + days * DAY_MS);
    }

    /**
     * Adds calendar months, clamping to the end of a shorter month (31 Aug + 6 -> 28/29 Feb).
     */
    function addMonths(key, months) {
        var p = parseKey(key);
        var total = (p.m - 1) + months;
        var y = p.y + Math.floor(total / 12);
        var m = ((total % 12) + 12) % 12 + 1;
        var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        return makeKey(y, m, Math.min(p.d, last));
    }

    /** @returns {number} 0 Sunday to 6 Saturday */
    function dayOfWeek(key) {
        return new Date(keyToUtcMs(key)).getUTCDay();
    }

    function isWeekend(key) {
        var dow = dayOfWeek(key);
        return dow === 0 || dow === 6;
    }

    /**
     * @param {string[]} keys
     * @returns {Object} a set: key -> true
     */
    function toSet(keys) {
        var set = {};
        var i;
        for (i = 0; i < (keys || []).length; i++) {
            set[keys[i]] = true;
        }
        return set;
    }

    /**
     * @param {string} key
     * @param {Object} holidays - set from toSet()
     */
    function isWorkingDay(key, holidays) {
        return !isWeekend(key) && !(holidays && holidays[key] === true);
    }

    /** The last Sunday of a month, as a UTC day number of the month. */
    function lastSunday(y, m) {
        var last = new Date(Date.UTC(y, m, 0));
        return last.getUTCDate() - last.getUTCDay();
    }

    /**
     * Today's date in Europe/London.
     * @param {number} nowMs - milliseconds since the epoch (Date.now())
     * @returns {string}
     */
    function londonTodayKey(nowMs) {
        var now = new Date(nowMs);
        var y = now.getUTCFullYear();
        var bstStart = Date.UTC(y, 2, lastSunday(y, 3), 1);
        var bstEnd = Date.UTC(y, 9, lastSunday(y, 10), 1);
        var offset = (nowMs >= bstStart && nowMs < bstEnd) ? 3600000 : 0;
        return utcMsToKey(nowMs + offset);
    }

    /**
     * The first date a delivery may be booked.
     *
     * @param {string} todayKey
     * @param {number} noticeDays - N, whole number >= 0
     * @param {Object} holidays - set
     * @returns {string}
     */
    function firstAllowedDate(todayKey, noticeDays, holidays) {
        var key = todayKey;
        var skipped = 0;
        var n = Math.max(0, parseInt(noticeDays, 10) || 0);
        for (;;) {
            key = addDays(key, 1);
            if (!isWorkingDay(key, holidays)) {
                continue;
            }
            if (skipped < n) {
                skipped++;
                continue;
            }
            return key;
        }
    }

    /**
     * The last date that may be booked: today plus the horizon in calendar months, inclusive.
     */
    function lastAllowedDate(todayKey, horizonMonths) {
        return addMonths(todayKey, horizonMonths);
    }

    /**
     * @returns {boolean} true when key is a working day between the first and last allowed dates
     */
    function isAllowedDate(key, todayKey, noticeDays, holidays, horizonMonths) {
        if (!isValidKey(key)) {
            return false;
        }
        return key >= firstAllowedDate(todayKey, noticeDays, holidays) &&
            key <= lastAllowedDate(todayKey, horizonMonths) &&
            isWorkingDay(key, holidays);
    }

    /**
     * Every allowed date, in order.
     * @returns {string[]}
     */
    function allowedDates(todayKey, noticeDays, holidays, horizonMonths) {
        var first = firstAllowedDate(todayKey, noticeDays, holidays);
        var last = lastAllowedDate(todayKey, horizonMonths);
        var result = [];
        var key = first;
        while (key <= last) {
            if (isWorkingDay(key, holidays)) {
                result.push(key);
            }
            key = addDays(key, 1);
        }
        return result;
    }

    /**
     * The months the calendar shows, each as weeks of seven cells (Monday first).
     *
     * @param {string} fromKey - first day to show a month for
     * @param {string} toKey - last day to show a month for
     * @returns {Array<{title: string, weeks: Array<Array<string|null>>}>}
     */
    function calendarMonths(fromKey, toKey) {
        var months = [];
        var from = parseKey(fromKey);
        var to = parseKey(toKey);
        var y = from.y;
        var m = from.m;
        var first;
        var lead;
        var daysInMonth;
        var weeks;
        var week;
        var d;

        while (y < to.y || (y === to.y && m <= to.m)) {
            first = makeKey(y, m, 1);
            lead = (dayOfWeek(first) + 6) % 7;
            daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
            weeks = [];
            week = [];
            for (d = 0; d < lead; d++) {
                week.push(null);
            }
            for (d = 1; d <= daysInMonth; d++) {
                week.push(makeKey(y, m, d));
                if (week.length === 7) {
                    weeks.push(week);
                    week = [];
                }
            }
            if (week.length) {
                while (week.length < 7) {
                    week.push(null);
                }
                weeks.push(week);
            }
            months.push({ title: MONTH_NAMES[m - 1] + ' ' + y, weeks: weeks });
            m++;
            if (m > 12) {
                m = 1;
                y++;
            }
        }
        return months;
    }

    /**
     * @param {string} key
     * @returns {string} 'Mon 5 October 2026', or '' for an invalid key
     */
    function formatLong(key) {
        var p = parseKey(key);
        if (!p) {
            return '';
        }
        return DAY_NAMES[dayOfWeek(key)] + ' ' + p.d + ' ' + MONTH_NAMES[p.m - 1] + ' ' + p.y;
    }

    /**
     * The customer-facing date (1.3.2): "Fri 30 Oct" in the current UK year, "Fri 16 Apr 2027"
     * otherwise. One helper for the dashboard, the form, the confirmations and the email.
     *
     * @param {string} key - the date
     * @param {string} todayKey - today in Europe/London (londonTodayKey); its year is "this year"
     * @returns {string} '' for an invalid key
     */
    function formatDisplay(key, todayKey) {
        var p = parseKey(key);
        var t = parseKey(todayKey);
        if (!p) {
            return '';
        }
        return DAY_NAMES[dayOfWeek(key)] + ' ' + p.d + ' ' + MONTH_NAMES[p.m - 1].slice(0, 3) +
            (t && t.y === p.y ? '' : ' ' + p.y);
    }

    /**
     * 1.3.3 (PR #7 amendment 1): an APPROXIMATE date as the customer sees it — month and year only,
     * "Mar 2027", whatever the year. '' for a blank or invalid key. A past date is shown as stored.
     * @param {string} key
     * @returns {string}
     */
    function formatMonthYear(key) {
        var p = parseKey(key);
        return p ? MONTH_NAMES[p.m - 1].slice(0, 3) + ' ' + p.y : '';
    }

    /**
     * The day of a JavaScript Date as NetSuite returned it (format.parse on the server), read in
     * the server's own zone, which is the zone format.parse built it in.
     * @param {Date} date
     * @returns {string}
     */
    function keyFromLocalDate(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            return '';
        }
        return makeKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
    }

    /**
     * A Date for a date field. Noon, so no zone conversion between the server and the account can
     * move it to a neighbouring day.
     * @param {string} key
     * @returns {Date}
     */
    function localDateForWrite(key) {
        var p = parseKey(key);
        return new Date(p.y, p.m - 1, p.d, 12, 0, 0);
    }

    return {
        VERSION: VERSION,
        makeKey: makeKey,
        parseKey: parseKey,
        isValidKey: isValidKey,
        addDays: addDays,
        addMonths: addMonths,
        dayOfWeek: dayOfWeek,
        isWeekend: isWeekend,
        toSet: toSet,
        isWorkingDay: isWorkingDay,
        londonTodayKey: londonTodayKey,
        firstAllowedDate: firstAllowedDate,
        lastAllowedDate: lastAllowedDate,
        isAllowedDate: isAllowedDate,
        allowedDates: allowedDates,
        calendarMonths: calendarMonths,
        formatLong: formatLong,
        formatDisplay: formatDisplay,
        formatMonthYear: formatMonthYear,
        keyFromLocalDate: keyFromLocalDate,
        localDateForWrite: localDateForWrite
    };
});
