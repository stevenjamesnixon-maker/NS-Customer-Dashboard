'use strict';
/** House style: ES5 in the SuiteScript files, the CDB log prefix, versions in step. */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'src', 'FileCabinet', 'SuiteScripts', 'NuHeat', 'Customer Dashboard');
var FILES = ['cdb_sl_dashboard.js', 'cdb_mr_digest.js', 'lib/cdb_lib_config.js', 'lib/cdb_lib_token.js',
    'lib/cdb_lib_dates.js', 'lib/cdb_lib_data.js', 'lib/cdb_lib_render.js', 'lib/cdb_lib_task.js'];

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
        assert.ok(!/getCurrentUser/.test(code), 'no current user');
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
