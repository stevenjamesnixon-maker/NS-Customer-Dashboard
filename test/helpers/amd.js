'use strict';
/**
 * A minimal AMD loader for the node tests. Loads a SuiteScript module, resolving './relative'
 * dependencies from disk and 'N/...' modules from the stubs given. Nothing is cached between
 * calls, so every test gets fresh modules with its own stubs.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'NuHeat',
    'Customer Dashboard');

function load(relativePath, stubs, cache) {
    var file = path.join(ROOT, relativePath.replace(/\.js$/, '') + '.js');
    var seen = cache || {};
    var captured = null;
    var deps;
    if (seen[file]) {
        return seen[file];
    }
    // Same realm as the tests, so instanceof Date holds for values passed in.
    new Function('define', fs.readFileSync(file, 'utf8') + '\n//# sourceURL=' + file)(
        function (d, factory) {
            captured = typeof d === 'function' ? { deps: [], factory: d } : { deps: d, factory: factory };
        });
    deps = captured.deps.map(function (dep) {
        if (dep.indexOf('N/') === 0) {
            return (stubs && stubs[dep]) || {};
        }
        // 2.1: the AMD 'require' dependency. Absolute module paths resolve from stubs.modules (the
        // Online-quote library, stubbed); anything else throws as NetSuite does for a missing module.
        // The callback runs synchronously, as server-side require() does.
        if (dep === 'require') {
            return (stubs && stubs.require) || function (ids, callback) {
                var mods = ids.map(function (id) {
                    var m = stubs && stubs.modules && stubs.modules[id];
                    if (!m) {
                        throw new Error('MODULE_DOES_NOT_EXIST: ' + id);
                    }
                    return m;
                });
                callback.apply(null, mods);
            };
        }
        return load(path.relative(ROOT, path.resolve(path.dirname(file), dep)), stubs, seen);
    });
    seen[file] = captured.factory.apply(null, deps);
    return seen[file];
}

module.exports = { load: load };
