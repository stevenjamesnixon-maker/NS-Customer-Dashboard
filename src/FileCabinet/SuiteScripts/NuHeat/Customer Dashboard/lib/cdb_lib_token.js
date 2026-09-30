/**
 * cdb_lib_token.js
 *
 * The customer's link: sign, verify, build.
 *
 *   payload  c<customerId>.v<version>
 *   token    base64url(payload) + '.' + base64url(HMAC-SHA256(payload))
 *
 * STABLE, NO EXPIRY. One customer has one link until custentity_cdb_link_version changes.
 * Incrementing that field revokes every link the customer has been sent. Empty means 0.
 *
 * THE KEY is the API Secret custsecret_cdb_link_key, through N/crypto:
 *   crypto.createSecretKey({ secret: 'custsecret_cdb_link_key', encoding: encode.Encoding.UTF_8 })
 *   crypto.createHmac({ algorithm: crypto.HashAlg.SHA256, key: key })
 *   hmac.update({ input: payload, inputEncoding: encode.Encoding.UTF_8 })
 *   hmac.digest({ outputEncoding: encode.Encoding.BASE_64 })
 * createSecretKey's encoding says how the secret's clear text is read. It defaults to HEX;
 * UTF_8 lets the secret be any random string. The secret must be restricted in the account to
 * the two scripts of this repo. See docs/context.md section 4 for what was and was not verified.
 *
 * VERIFY FAILS CLOSED. Any failure — shape, signature, customer missing or inactive, version —
 * returns ok: false with a reason for the audit log. The page shows the reason to nobody.
 *
 * Everything except the HMAC and the customer lookup is pure and node-tested
 * (test/token.test.js). The payload is ASCII, so base64 is done here in plain code rather than
 * through N/encode, which keeps it testable.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/crypto', 'N/encode', 'N/search', 'N/url', './cdb_lib_config'],
    function (crypto, encode, search, url, config) {

    'use strict';

    var VERSION = '1.0.0';

    var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    var REASONS = {
        SHAPE: 'malformed token',
        PAYLOAD: 'malformed payload',
        SIGNATURE: 'signature mismatch',
        CUSTOMER_MISSING: 'customer not found',
        CUSTOMER_INACTIVE: 'customer inactive',
        VERSION: 'link version revoked'
    };

    /**
     * Pure: base64 of an ASCII string.
     * @param {string} text
     * @returns {string}
     */
    function asciiToBase64(text) {
        var out = '';
        var i;
        var a;
        var b;
        var c;
        for (i = 0; i < text.length; i += 3) {
            a = text.charCodeAt(i);
            b = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN;
            c = i + 2 < text.length ? text.charCodeAt(i + 2) : NaN;
            out += ALPHABET.charAt(a >> 2);
            out += ALPHABET.charAt(((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4));
            out += isNaN(b) ? '=' : ALPHABET.charAt(((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6));
            out += isNaN(c) ? '=' : ALPHABET.charAt(c & 63);
        }
        return out;
    }

    /**
     * Pure: the ASCII string a base64 value encodes.
     * @param {string} b64
     * @returns {string|null} null when b64 is not valid base64 or decodes to non-ASCII
     */
    function base64ToAscii(b64) {
        var clean = String(b64);
        var out = '';
        var i;
        var n = [];
        var j;
        var code;
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) {
            return null;
        }
        for (i = 0; i < clean.length; i += 4) {
            for (j = 0; j < 4; j++) {
                n[j] = clean.charAt(i + j) === '=' ? -1 : ALPHABET.indexOf(clean.charAt(i + j));
            }
            code = (n[0] << 2) | (n[1] >> 4);
            out += String.fromCharCode(code);
            if (n[2] >= 0) {
                out += String.fromCharCode(((n[1] & 15) << 4) | (n[2] >> 2));
            }
            if (n[3] >= 0) {
                out += String.fromCharCode(((n[2] & 3) << 6) | n[3]);
            }
        }
        for (i = 0; i < out.length; i++) {
            if (out.charCodeAt(i) > 127) {
                return null;
            }
        }
        return out;
    }

    /** Pure: standard base64 -> base64url, unpadded. */
    function toBase64Url(b64) {
        return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /** Pure: base64url -> standard base64, padded. */
    function fromBase64Url(b64url) {
        var b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) {
            b64 += '=';
        }
        return b64;
    }

    /**
     * Pure: empty, null or not a whole number -> 0.
     * @returns {number}
     */
    function normaliseVersion(raw) {
        var text = String(raw === null || raw === undefined ? '' : raw).replace(/^\s+|\s+$/g, '');
        return /^\d+$/.test(text) ? parseInt(text, 10) : 0;
    }

    /**
     * Pure.
     * @param {string|number} customerId
     * @param {string|number} version
     * @returns {string} 'c<customerId>.v<version>'
     */
    function makePayload(customerId, version) {
        return 'c' + String(customerId) + '.v' + normaliseVersion(version);
    }

    /**
     * Pure.
     * @param {string} payload
     * @returns {{customerId: string, version: number}|null}
     */
    function parsePayload(payload) {
        var match = /^c(\d+)\.v(\d+)$/.exec(String(payload || ''));
        if (!match) {
            return null;
        }
        return { customerId: String(parseInt(match[1], 10)), version: parseInt(match[2], 10) };
    }

    /**
     * Pure: the token for a payload, given its signature as standard base64.
     */
    function assembleToken(payload, signatureBase64) {
        return toBase64Url(asciiToBase64(payload)) + '.' + toBase64Url(signatureBase64);
    }

    /**
     * Pure: splits a token.
     * @returns {{payload: string, signature: string}|null} signature still base64url
     */
    function splitToken(token) {
        var parts = String(token || '').split('.');
        var payload;
        if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
                !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
            return null;
        }
        payload = base64ToAscii(fromBase64Url(parts[0]));
        if (payload === null) {
            return null;
        }
        return { payload: payload, signature: parts[1] };
    }

    /**
     * Pure: compares two strings without stopping at the first difference.
     * @returns {boolean}
     */
    function constantTimeEqual(a, b) {
        var left = String(a);
        var right = String(b);
        var diff = left.length ^ right.length;
        var length = Math.max(left.length, right.length);
        var i;
        for (i = 0; i < length; i++) {
            diff |= (i < left.length ? left.charCodeAt(i) : 0) ^
                (i < right.length ? right.charCodeAt(i) : 0);
        }
        return diff === 0;
    }

    /**
     * The HMAC-SHA256 of a payload as standard base64. The one crypto call.
     * @param {string} payload
     * @returns {string}
     */
    function hmacBase64(payload) {
        var key = crypto.createSecretKey({
            secret: config.SECRET_ID,
            encoding: encode.Encoding.UTF_8
        });
        var hmac = crypto.createHmac({ algorithm: crypto.HashAlg.SHA256, key: key });
        hmac.update({ input: payload, inputEncoding: encode.Encoding.UTF_8 });
        return hmac.digest({ outputEncoding: encode.Encoding.BASE_64 });
    }

    /**
     * @param {string|number} customerId
     * @param {string|number} version
     * @returns {string} the token
     */
    function sign(customerId, version) {
        var payload = makePayload(customerId, version);
        return assembleToken(payload, hmacBase64(payload));
    }

    /**
     * @param {string|number} customerId
     * @returns {{isInactive: boolean, version: number}|null} null when the customer is not found
     */
    function readCustomer(customerId) {
        var fields = config.FIELDS.CUSTOMER;
        var result;
        try {
            result = search.lookupFields({
                type: search.Type.CUSTOMER,
                id: customerId,
                columns: ['isinactive', fields.LINK_VERSION]
            });
        } catch (e) {
            return null;
        }
        if (!result) {
            return null;
        }
        return {
            isInactive: result.isinactive === true || result.isinactive === 'T',
            version: normaliseVersion(result[fields.LINK_VERSION])
        };
    }

    /**
     * Verifies a token. Never throws.
     *
     * @param {string} token
     * @returns {{ok: boolean, customerId: string, reason: string}}
     */
    function verify(token) {
        var parts = splitToken(token);
        var parsed;
        var expected;
        var customer;

        if (!parts) {
            return { ok: false, customerId: '', reason: REASONS.SHAPE };
        }
        parsed = parsePayload(parts.payload);
        if (!parsed) {
            return { ok: false, customerId: '', reason: REASONS.PAYLOAD };
        }
        try {
            expected = toBase64Url(hmacBase64(parts.payload));
        } catch (e) {
            return { ok: false, customerId: parsed.customerId,
                reason: 'signing failed: ' + (e && e.message ? e.message : String(e)) };
        }
        if (!constantTimeEqual(expected, parts.signature)) {
            return { ok: false, customerId: parsed.customerId, reason: REASONS.SIGNATURE };
        }
        customer = readCustomer(parsed.customerId);
        if (!customer) {
            return { ok: false, customerId: parsed.customerId, reason: REASONS.CUSTOMER_MISSING };
        }
        if (customer.isInactive) {
            return { ok: false, customerId: parsed.customerId, reason: REASONS.CUSTOMER_INACTIVE };
        }
        if (customer.version !== parsed.version) {
            return { ok: false, customerId: parsed.customerId,
                reason: REASONS.VERSION + ' (token v' + parsed.version + ', customer v' +
                    customer.version + ')' };
        }
        return { ok: true, customerId: parsed.customerId, reason: '' };
    }

    /**
     * The dashboard URL for a token, with optional extra parameters.
     * @param {string} token
     * @param {Object} [extra]
     * @returns {string}
     */
    function linkForToken(token, extra) {
        var params = { t: token };
        var key;
        for (key in (extra || {})) {
            if (extra.hasOwnProperty(key)) {
                params[key] = extra[key];
            }
        }
        return url.resolveScript({
            scriptId: config.SCRIPTS.SUITELET,
            deploymentId: config.SCRIPTS.SUITELET_DEPLOYMENT,
            returnExternalUrl: true,
            params: params
        });
    }

    /**
     * The customer's dashboard link, at the customer's current link version. For the digest and
     * for future email templates.
     *
     * @param {string|number} customerId
     * @returns {string}
     * @throws {Error} CDB_CUSTOMER_NOT_FOUND
     */
    function buildLink(customerId) {
        var customer = readCustomer(customerId);
        if (!customer) {
            throw new Error('CDB_CUSTOMER_NOT_FOUND: customer ' + customerId);
        }
        return linkForToken(sign(customerId, customer.version));
    }

    return {
        VERSION: VERSION,
        REASONS: REASONS,
        asciiToBase64: asciiToBase64,
        base64ToAscii: base64ToAscii,
        toBase64Url: toBase64Url,
        fromBase64Url: fromBase64Url,
        normaliseVersion: normaliseVersion,
        makePayload: makePayload,
        parsePayload: parsePayload,
        assembleToken: assembleToken,
        splitToken: splitToken,
        constantTimeEqual: constantTimeEqual,
        sign: sign,
        verify: verify,
        linkForToken: linkForToken,
        buildLink: buildLink
    };
});
