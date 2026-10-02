'use strict';
/** House style: ES5 in the SuiteScript files, the CDB log prefix, versions in step. */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'src', 'FileCabinet', 'SuiteScripts', 'NuHeat', 'Customer Dashboard');
var FILES = ['cdb_sl_dashboard.js', 'cdb_mr_digest.js', 'lib/cdb_lib_config.js', 'lib/cdb_lib_token.js',
    'lib/cdb_lib_dates.js', 'lib/cdb_lib_data.js', 'lib/cdb_lib_render.js', 'lib/cdb_lib_task.js',
    'cdb_ue_salesorder.js', 'cdb_sl_send_link.js',
    // "Request an update" part A: the stored link.
    'lib/cdb_lib_link.js', 'cdb_ue_customer.js', 'cdb_mr_link_backfill.js',
    // Release 2.3: "Tell us about your property".
    'lib/cdb_lib_designinfo.js', 'cdb_ue_opportunity.js', 'cdb_sl_send_designinfo.js'];

/**
 * 2.0: the ONE file that may read the current user — the login-required Send delivery link
 * Suitelet, for its CDB SEND_LINK log line only (brief §5 step 7). Every other file, and above all
 * the no-login dashboard, still may not.
 */
var CURRENT_USER_ALLOWED = ['cdb_sl_send_link.js'];

FILES.forEach(function (f) {
    test(f, function () {
        var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert.ok(/'use strict';/.test(src), 'use strict');
        assert.ok(!/=>/.test(code), 'no arrow functions');
        assert.ok(!/\b(let|const)\s/.test(code), 'no let/const');
        assert.ok(code.indexOf('`') === -1, 'no template literals');
        assert.ok(!/\.includes\(/.test(code), 'no includes');
        assert.ok(!/log\.warn/.test(code), 'no log.warn');
        if (CURRENT_USER_ALLOWED.indexOf(f) < 0) {
            assert.ok(!/getCurrentUser/.test(code), 'no current user');
        } else {
            assert.strictEqual((code.match(/getCurrentUser/g) || []).length, 1, 'the current user read once, for the log');
        }
        var constant = /var VERSION = '(\d+\.\d+\.\d+)';/.exec(src);
        var header = /@version (\d+\.\d+\.\d+)/.exec(src);
        assert.ok(constant && header && constant[1] === header[1], 'VERSION and @version in step');
        (code.match(/log\.\w+\(\{\s*title:\s*'[^']*'/g) || []).forEach(function (t) {
            assert.fail('literal log title without the CDB prefix helper: ' + t);
        });
        assert.ok(!/custbody_del_date'\s*,\s*value/.test(code) && !/fieldId:\s*SO\.CONFIRMED_DATE,\s*value/.test(code),
            'never writes custbody_del_date');
    });
});
