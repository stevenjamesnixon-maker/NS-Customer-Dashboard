/**
 * cdb_ue_customer.js
 *
 * Keeps each customer's base dashboard link in custentity_cdb_link ("Request an update" part A,
 * 2 Oct 2026). User Event on Customer, afterSubmit only, on create, edit and xedit (inline edit, mass
 * update), deployed in ALL execution contexts: UI, CSV import, web services, scripts. The deployment
 * applies to every customer-type record (lead, prospect, customer).
 *
 * WHY. Online-quote's Update Opportunity page reads the field and appends &a=update&opp=<id> for the rep's
 * "Give us an update" button, with no code dependency on this repo (cdb_lib_token.js, EXTERNAL CONSUMER).
 *
 * PER SAVE (lib/cdb_lib_link.js ensure(), shared with cdb_mr_link_backfill.js):
 *   1. the customer's ID, isinactive, custentity_cdb_link_version and custentity_cdb_link: from the
 *      new record on create and edit (no governance); on xedit the new record carries only the changed
 *      fields, so from ONE lookupFields (1 unit);
 *   2. an inactive customer: nothing;
 *   3. token.linkMatches(stored link, id, version): nothing (pure, no crypto);
 *   4. otherwise token.buildLink(id) and one submitFields of custentity_cdb_link only.
 * Incrementing custentity_cdb_link_version (revocation) rewrites the link on the same save. A copied
 * customer carries the original's link: it names another customer, so it is rewritten.
 *
 * WHAT IT CANNOT SEE: a new API Secret value, a new dashboard deployment or domain, a refreshed Sandbox.
 * The stored payload is unchanged by those, so run cdb_mr_link_backfill.js after each.
 *
 * GOVERNANCE (User Event: 1,000 units): a save whose link is right costs 0 (create, edit) or 1 (xedit).
 * A write adds buildLink()'s lookup (1) and submitFields on a customer (5), so 6 or 7; CDB LINK_WRITTEN
 * logs the units actually used.
 *
 * NEVER THROWS. A customer save must never fail because of this script: everything is caught and logged
 * as CDB LINK_FAILED (error).
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/log', './lib/cdb_lib_config', './lib/cdb_lib_link'],
    function (log, config, link) {

    'use strict';

    var VERSION = '1.0.0';

    /**
     * @param {Object} context - afterSubmit context
     */
    function afterSubmit(context) {
        var types;
        var id = '';
        var state;
        try {
            types = context.UserEventType;
            if (context.type !== types.CREATE && context.type !== types.EDIT && context.type !== types.XEDIT) {
                return;
            }
            id = String(context.newRecord.id);
            // xedit: the new record has only the changed fields, so read all three from the database.
            state = context.type === types.XEDIT ? null : link.stateFromRecord(context.newRecord);
            link.ensure(id, state, { exact: false, log: log, source: 'User Event (' + context.type + ')' });
        } catch (e) {
            try {
                log.error({ title: config.logTitle('LINK_FAILED'), details: 'Customer ' + id + ' (User Event v' +
                    VERSION + '): ' + (e && e.message ? e.message : String(e)) });
            } catch (ignore) {
                // Nothing more to do: the save must go ahead.
            }
        }
    }

    return { afterSubmit: afterSubmit };
});
