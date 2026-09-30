'use strict';
var test = require('node:test');
var assert = require('node:assert');
var nodeCrypto = require('crypto');
var amd = require('./helpers/amd');

/** N/crypto stubbed with node's HMAC and a fixed test secret. */
function stubs(customers, calls) {
    return {
        'N/encode': { Encoding: { UTF_8: 'UTF_8', BASE_64: 'BASE_64', HEX: 'HEX' } },
        'N/crypto': {
            HashAlg: { SHA256: 'SHA256' },
            createSecretKey: function (o) {
                calls.push(['createSecretKey', o]);
                return { secret: 'test-secret-of-at-least-thirty-two-chars' };
            },
            createHmac: function (o) {
                calls.push(['createHmac', o.algorithm]);
                var h = nodeCrypto.createHmac('sha256', o.key.secret);
                return {
                    update: function (u) { h.update(u.input, 'utf8'); },
                    digest: function (d) { assert.strictEqual(d.outputEncoding, 'BASE_64'); return h.digest('base64'); }
                };
            }
        },
        'N/search': {
            Type: { CUSTOMER: 'customer' },
            lookupFields: function (o) {
                if (!customers[o.id]) { throw new Error('RCRD_DSNT_EXIST'); }
                return customers[o.id];
            }
        },
        'N/url': { resolveScript: function (o) { return 'https://x/app/site/hosting/scriptlet.nl?t=' + o.params.t; } },
        'N/runtime': {}
    };
}

function load(customers) {
    var calls = [];
    return { token: amd.load('lib/cdb_lib_token', stubs(customers || {}, calls)), calls: calls };
}

test('payload encode/decode', function () {
    var t = load().token;
    assert.strictEqual(t.makePayload(123, ''), 'c123.v0');
    assert.strictEqual(t.makePayload('123', null), 'c123.v0');
    assert.strictEqual(t.makePayload(123, '4'), 'c123.v4');
    assert.deepStrictEqual(t.parsePayload('c123.v4'), { customerId: '123', version: 4 });
    ['', 'c.v1', 'c12.v', 'x12.v1', 'c12.v1.x', 'c-1.v0', 'c1.v-1'].forEach(function (p) {
        assert.strictEqual(t.parsePayload(p), null, p);
    });
});

test('base64 and base64url round trip against node', function () {
    var t = load().token;
    ['c1.v0', 'c12.v0', 'c123.v0', 'c98765.v12', 'a', 'ab'].forEach(function (s) {
        assert.strictEqual(t.asciiToBase64(s), Buffer.from(s, 'ascii').toString('base64'), s);
        assert.strictEqual(t.base64ToAscii(t.asciiToBase64(s)), s);
        assert.strictEqual(t.base64ToAscii(t.fromBase64Url(t.toBase64Url(t.asciiToBase64(s)))), s);
    });
    assert.strictEqual(t.toBase64Url('a+b/c=='), 'a-b_c');
    assert.strictEqual(t.base64ToAscii('not base64!'), null);
});

test('sign then verify: valid, stable, uses the API secret', function () {
    var r = load({ 42: { isinactive: false, custentity_cdb_link_version: '' } });
    var tok = r.token.sign(42, '');
    assert.strictEqual(tok, r.token.sign(42, 0), 'stable per customer and version');
    assert.ok(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tok), 'url-safe');
    assert.deepStrictEqual(r.token.verify(tok), { ok: true, customerId: '42', reason: '' });
    assert.deepStrictEqual(r.calls[0], ['createSecretKey', { secret: 'custsecret_cdb_link_key', encoding: 'UTF_8' }]);
    assert.deepStrictEqual(r.calls[1], ['createHmac', 'SHA256']);
    // The payload part decodes to the documented payload.
    assert.strictEqual(Buffer.from(tok.split('.')[0], 'base64url').toString(), 'c42.v0');
});

test('verify fails closed: tampering, shape, customer, version', function () {
    var customers = {
        42: { isinactive: false, custentity_cdb_link_version: '' },
        43: { isinactive: true, custentity_cdb_link_version: '' },
        44: { isinactive: false, custentity_cdb_link_version: '2' }
    };
    var t = load(customers).token;
    var good = t.sign(42, 0);
    var sig = good.split('.')[1];
    var forged = t.toBase64Url(t.asciiToBase64('c43.v0')) + '.' + sig;
    var R = t.REASONS;

    assert.strictEqual(t.verify(forged).reason, R.SIGNATURE, 'payload swapped');
    assert.strictEqual(t.verify(good.slice(0, -1) + (good.slice(-1) === 'A' ? 'B' : 'A')).reason, R.SIGNATURE);
    assert.strictEqual(t.verify('').reason, R.SHAPE);
    assert.strictEqual(t.verify(undefined).reason, R.SHAPE);
    assert.strictEqual(t.verify('a.b.c').reason, R.SHAPE);
    assert.strictEqual(t.verify(t.toBase64Url(t.asciiToBase64('hello')) + '.' + sig).reason, R.PAYLOAD);
    assert.strictEqual(t.verify(t.sign(99, 0)).reason, R.CUSTOMER_MISSING);
    assert.strictEqual(t.verify(t.sign(43, 0)).reason, R.CUSTOMER_INACTIVE);
    assert.ok(t.verify(t.sign(44, 0)).reason.indexOf(R.VERSION) === 0, 'version bumped revokes');
    assert.strictEqual(t.verify(t.sign(44, 2)).ok, true);
});

test('constant-time compare', function () {
    var t = load().token;
    assert.strictEqual(t.constantTimeEqual('abc', 'abc'), true);
    assert.strictEqual(t.constantTimeEqual('abc', 'abd'), false);
    assert.strictEqual(t.constantTimeEqual('abc', 'ab'), false);
    assert.strictEqual(t.constantTimeEqual('', ''), true);
});

test('buildLink signs at the current version', function () {
    var t = load({ 44: { isinactive: false, custentity_cdb_link_version: '2' } }).token;
    assert.strictEqual(t.buildLink(44), 'https://x/app/site/hosting/scriptlet.nl?t=' + t.sign(44, 2));
    assert.throws(function () { t.buildLink(1); }, /CDB_CUSTOMER_NOT_FOUND/);
});
