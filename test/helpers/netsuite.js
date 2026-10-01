'use strict';
/**
 * An in-memory NetSuite for the Suitelet and digest tests. Only as faithful as its author: it
 * catches wiring and flow errors, not API behaviour. Sandbox testing is still the real test.
 */
var nodeCrypto = require('crypto');

function pad(n) { return (n < 10 ? '0' : '') + n; }
function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function world() {
    var w = {
        logs: [], tasks: [], saves: [], emails: [], submits: [], contacts: {}, missingFields: [],
        redirects: [], urls: [], user: { id: 7, name: 'Sam Staff' },
        customers: {
            42: { isinactive: false, custentity_cdb_link_version: '', entityid: 'C42', companyname: 'Acme Ltd',
                isperson: false, email: 'acme@example.com', salesrep: [{ value: '88', text: 'Rep' }],
                custentity_cdb_dashboard_contact: '' },
            43: { isinactive: false, custentity_cdb_link_version: '', entityid: 'C43', companyname: 'Other',
                isperson: false, email: '', salesrep: '', custentity_cdb_dashboard_contact: '' }
        },
        employees: {
            77: { firstname: 'Pem', lastname: 'Engineer', phone: '0101', email: 'pe@x', isinactive: false },
            88: { firstname: 'Ray', lastname: 'Rep', phone: '0202', email: 'rep@x', isinactive: false },
            500: { firstname: 'Fall', lastname: 'Back', phone: '0303', email: 'fb@x', isinactive: false }
        },
        opps: {
            4: { entity: '42', title: 'Barn', tranid: 'OPP4', entitystatus: '13', custbody_opportunity_sub_status: '8',
                salesrep: '88', custbody_pe: '77', custbody_value_proposition: '2', custbody_opp_site_adress: 'Farm' },
            9: { entity: '43', title: 'Theirs', tranid: 'OPP9', entitystatus: '13', custbody_opportunity_sub_status: '8',
                salesrep: '88', custbody_pe: '', custbody_value_proposition: '1', custbody_opp_site_adress: '' }
        },
        orders: {
            100: { tranid: 'SO100', status: 'SalesOrd:B', opportunity: '4', custbody_finance_status: '',
                custbody_quote_type: '1', custbody_ready_for_delivery: true, custbody_del_date: '',
                custbody_cust_pay_intent: '', custbody_finance_status_untouched: true, shipaddresslist: '901',
                custbody_del_contact: 'Old Name', custbody_delivery_con_num: '0111', custbody_delivery_con_email: '' },
            101: { tranid: 'SO101', status: 'SalesOrd:G', opportunity: '4', custbody_finance_status: '',
                custbody_quote_type: '1', custbody_ready_for_delivery: true, custbody_del_date: '', custbody_cust_pay_intent: '' },
            200: { tranid: 'SO200', status: 'SalesOrd:B', opportunity: '9', custbody_finance_status: '',
                custbody_quote_type: '1', custbody_ready_for_delivery: true, custbody_del_date: '', custbody_cust_pay_intent: '' }
        },
        lists: {
            customlist_del_time_per: { 2: 'AM delivery', 5: 'PM delivery', 3: 'Anytime' },
            customlist_delivery_veh: { 1: 'Artic', 2: 'Rigid' },
            customlist_unload_req: { 1: 'Tail lift', 2: 'Forklift', 3: 'By hand' }
        }
    };
    return w;
}

function findClause(expr, field) {
    var i;
    var f;
    if (!Array.isArray(expr)) { return null; }
    if (expr[0] === field && typeof expr[1] === 'string') { return expr; }
    for (i = 0; i < expr.length; i++) { f = findClause(expr[i], field); if (f) { return f; } }
    return null;
}

function stubs(w) {
    function results(rows) {
        return { runPaged: function () { return { pageRanges: [{ index: 0 }], fetch: function () { return { data: rows }; } }; } };
    }
    function asList(v) { return Array.isArray(v) ? v.map(String) : [String(v)]; }
    var search = {
        Type: { CUSTOMER: 'customer', EMPLOYEE: 'employee', CONTACT: 'contact', OPPORTUNITY: 'opportunity', SALES_ORDER: 'salesorder' },
        Sort: { ASC: 'ASC', DESC: 'DESC' },
        Summary: { GROUP: 'GROUP' },
        createColumn: function (c) { return c; },
        lookupFields: function (o) {
            var src = { customer: w.customers, employee: w.employees, opportunity: w.opps, contact: w.contacts,
                salesorder: w.orders }[o.type];
            var r = src && src[o.id];
            var out = {};
            if (!r) { throw new Error('RCRD_DSNT_EXIST'); }
            // 2.0.2: model an account where the photo field does not exist on the employee.
            if (o.type === 'employee' && w.photoFieldThrows && o.columns.indexOf('custentity_employee_photo_link') >= 0) {
                throw new Error('An nlobjSearchColumn contains an invalid column: custentity_employee_photo_link.');
            }
            o.columns.forEach(function (c) {
                var v = r[c];
                out[c] = (((o.type === 'opportunity' && ['entity', 'salesrep', 'custbody_pe', 'custbody_value_proposition', 'entitystatus'].indexOf(c) >= 0) ||
                        (o.type === 'salesorder' && c === 'opportunity')) && v) ?
                    [{ value: v, text: '' }] : (v === undefined ? '' : v);
            });
            return out;
        },
        create: function (def) {
            var rows = [];
            var clause;
            w.searches = w.searches || [];
            w.searches.push(def);
            // As NetSuite does: the opportunity search type has no mainline filter.
            if (def.type === 'opportunity' && findClause(def.filters, 'mainline')) {
                throw new Error('An nlobjSearchFilter contains invalid search criteria: mainline.');
            }
            if (def.type === 'opportunity') {
                clause = findClause(def.filters, 'entity');
                Object.keys(w.opps).forEach(function (id) {
                    var o = w.opps[id];
                    if (!clause || asList(clause[2]).indexOf(o.entity) >= 0) {
                        rows.push({ id: id, getValue: function (n) { return o[n] || ''; }, getText: function () { return ''; } });
                    }
                });
            } else if (def.type === 'salesorder') {
                // 1.2: the separate extras search (it is the one that reads terms) can be made to
                // throw, to model a field that does not apply to sales orders.
                if ((def.columns || []).indexOf('terms') >= 0 && w.extrasThrow) {
                    throw new Error('An nlobjSearchColumn contains an invalid column: custbodycustbody_sys_bal_incvat.');
                }
                // The quote description is confirmed on the Estimate only: model the risk that an
                // unjoined sales order column makes the search throw.
                (def.columns || []).forEach(function (c) {
                    if (c === 'custbody_quote_description' || (c && c.name === 'custbody_quote_description' && !c.join)) {
                        throw new Error('An nlobjSearchColumn contains an invalid column: custbody_quote_description.');
                    }
                });
                var st = findClause(def.filters, 'status');
                var ent = findClause(def.filters, 'entity');
                // 1.3: the recently delivered search (native F/G) can be made to throw.
                if (st && st[2].indexOf('SalesOrd:F') >= 0 && w.recentThrow) {
                    throw new Error('An unexpected error occurred in the recently delivered search.');
                }
                var byId = findClause(def.filters, 'internalid');
                var byOpp = null;
                (function walk(e) { if (!Array.isArray(e)) { return; } if (e[0] === 'opportunity' && e[1] === 'anyof') { byOpp = e; } e.forEach(walk); }(def.filters));
                Object.keys(w.orders).forEach(function (id) {
                    var o = w.orders[id];
                    if (st && st[2].indexOf(o.status) < 0) { return; }
                    if (ent && asList(ent[2]).indexOf(String(o.entity || '')) < 0) { return; }
                    if (byId && asList(byId[2]).indexOf(id) < 0) { return; }
                    if (byOpp && asList(byOpp[2]).indexOf(o.opportunity) < 0) { return; }
                    rows.push({ id: id,
                        getValue: function (n) {
                            if (n && typeof n === 'object') {
                                if (n.join === 'createdFrom' && n.name === 'custbody_quote_description') {
                                    return o.quoteDescription || '';
                                }
                                n = n.name;
                            }
                            return o[n] === undefined ? '' : o[n];
                        },
                        getText: function (n) {
                            if (n === 'custbody_quote_type') { return 'Underfloor heating system'; }
                            if (n === 'custbody_del_time_per') { return w.lists.customlist_del_time_per[o[n]] || ''; }
                            return '';
                        } });
                });
            } else if (w.lists[def.type]) {
                var ids = asList(findClause(def.filters, 'internalid')[2]);
                ids.forEach(function (id) {
                    if (w.lists[def.type][id]) { rows.push({ id: id, getValue: function () { return w.lists[def.type][id]; } }); }
                });
            }
            return results(rows);
        }
    };
    var record = {
        Type: { CUSTOMER: 'customer', SALES_ORDER: 'salesorder', TASK: 'task' },
        load: function (o) {
            if (o.type === 'customer') {
                var lines = [{ id: '900', label: 'Home', addressbookaddress_text: '1 Home Rd\nTown' },
                    { id: '901', label: 'Site', addressbookaddress_text: 'Plot 2\nVillage' }];
                return {
                    getLineCount: function () { return o.id === '42' ? 2 : 0; },
                    getSublistValue: function (s) { return lines[s.line][s.fieldId] || ''; }
                };
            }
            var src = w.orders[o.id];
            var pending = {};
            return {
                getValue: function (f) { var v = pending.hasOwnProperty(f.fieldId) ? pending[f.fieldId] : src[f.fieldId]; return v === undefined ? '' : v; },
                getText: function (f) {
                    if (f.fieldId === 'custbody_edd_certainty') { return { 3: 'Customer Definite' }[this.getValue(f)] || ''; }
                    return String(this.getValue(f));
                },
                getField: function (f) { return w.missingFields.indexOf(f.fieldId) >= 0 ? null : { id: f.fieldId }; },
                setValue: function (f) { pending[f.fieldId] = f.value; },
                save: function (opts) {
                    w.saves.push({ id: o.id, values: pending, opts: opts });
                    Object.keys(pending).forEach(function (k) { src[k] = pending[k] instanceof Date ? keyOf(pending[k]) : pending[k]; });
                    return o.id;
                }
            };
        },
        submitFields: function (o) { w.submits.push(o); return o.id; },
        create: function () {
            var t = { values: {} };
            w.tasks.push(t);
            return { setValue: function (f) { t.values[f.fieldId] = f.value; }, save: function () { return 555; } };
        }
    };
    return {
        'N/search': search,
        'N/record': record,
        'N/format': {
            Type: { DATE: 'date' },
            parse: function (o) { var p = String(o.value).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); },
            format: function (o) { return keyOf(o.value); }
        },
        'N/runtime': { getCurrentScript: function () {
            var p = w.params || { custscript_cdb_won_statuses: '13', custscript_cdb_lost_statuses: '14',
                custscript_cdb_design_substatus: '1,4,5,13', custscript_cdb_needinfo_substatus: '1',
                custscript_cdb_delivery_substatus: '8,11', custscript_cdb_excluded_statuses: '90',
                custscript_cdb_excluded_quote_types: '7,8', custscript_cdb_pay_bacs: '1', custscript_cdb_pay_card: '2',
                custscript_cdb_fallback_employee: '500', custscript_cdb_logo_url: '',
                custscript_cdb_time_values: '2,5,3', custscript_cdb_vehicle_values: '1,2',
                custscript_cdb_unload_values: '1,2,3', custscript_cdb_pe_valueprops: '2,3', custscript_cdb_notice_days: '3',
                custscript_cdb_bank_name: 'Test Bank', custscript_cdb_bank_sort: '11-22-33', custscript_cdb_bank_account: '87654321',
                custscript_cdb_edd_definite_value: '3',
                custscript_cdb_option_hints: '{"vehicle":{"1":"Up to 16 m long"},"unload":{"3":"Bring helpers"}}' };
            // Per-test overrides on top of the defaults (1.2).
            Object.keys(w.paramOverrides || {}).forEach(function (k) { p[k] = w.paramOverrides[k]; });
            return { id: w.scriptId || 'customscript_cdb_sl_dashboard', getParameter: function (o) { return p[o.name]; },
                getRemainingUsage: function () { return 900; } };
        },
        // 2.0: only the login-required Send delivery link Suitelet reads it, for its log.
        getCurrentUser: function () { return w.user; },
        executionContext: w.executionContext || 'USERINTERFACE',
        ContextType: { USER_INTERFACE: 'USERINTERFACE', CSV_IMPORT: 'CSVIMPORT', WEBSERVICES: 'WEBSERVICES' } },
        'N/log': {
            audit: function (o) { w.logs.push(['audit', o.title, o.details]); },
            error: function (o) { w.logs.push(['error', o.title, o.details]); },
            debug: function () {}
        },
        'N/email': { send: function (o) {
            if (w.emailThrow) { throw new Error('SSS_AUTHOR_MUST_BE_EMPLOYEE'); }
            w.emails.push(o);
        } },
        // The dashboard link as before; 2.0: any further parameter appended, encoded, in order; an
        // internal URL (no returnExternalUrl) for the Send delivery link Suitelet.
        'N/url': { resolveScript: function (o) {
            var extra = Object.keys(o.params || {}).filter(function (k) { return k !== 't'; }).map(function (k) {
                return '&' + encodeURIComponent(k) + '=' + encodeURIComponent(o.params[k]);
            }).join('');
            w.urls.push(o);
            if (!o.returnExternalUrl) {
                return '/app/site/hosting/scriptlet.nl?script=' + o.scriptId + '&deploy=' + o.deploymentId + extra;
            }
            return 'https://acct.extforms.netsuite.com/sl?t=' + o.params.t + extra;
        } },
        'N/redirect': { toRecord: function (o) { w.redirects.push(o); } },
        'N/ui/message': { Type: { CONFIRMATION: 'confirmation', WARNING: 'warning', ERROR: 'error', INFORMATION: 'information' } },
        'N/encode': { Encoding: { UTF_8: 'UTF_8', BASE_64: 'BASE_64' } },
        'N/crypto': {
            HashAlg: { SHA256: 'SHA256' },
            createSecretKey: function () { return {}; },
            createHmac: function () {
                var h = nodeCrypto.createHmac('sha256', 'k');
                return { update: function (u) { h.update(u.input); }, digest: function () { return h.digest('base64'); } };
            }
        }
    };
}

module.exports = { world: world, stubs: stubs, keyOf: keyOf };
