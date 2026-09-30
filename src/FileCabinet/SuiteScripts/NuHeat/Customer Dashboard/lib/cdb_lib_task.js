/**
 * cdb_lib_task.js
 *
 * The Task for the account manager (or PE) when a customer requests a delivery. One Task per
 * request, created AFTER the sales order has saved. The caller keeps the sales order change if
 * this throws, logs it at ERROR and still shows the customer their confirmation.
 *
 * NEVER THE CURRENT USER. The Suitelet runs without login as user -4; runtime.getCurrentUser()
 * is never used for the assignee or anything else. The assignee comes from
 * cdb_lib_data.resolveRecipient() (brief C6).
 *
 * Status, priority and sendemail use NetSuite's own text values (NOTSTART, HIGH), which are the
 * same in every account. They are not internal IDs.
 *
 * sendemail ("Notify Assignee by Email") is a body field of the Task record in the Records
 * Browser and is settable from script. NOT verified in this account; see docs/context.md
 * section 10.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/record', './cdb_lib_dates'], function (record, dates) {

    'use strict';

    var VERSION = '1.0.0';

    /** Longest title the Task accepts. */
    var TITLE_MAX = 200;

    /**
     * Pure: the Task title.
     * @returns {string}
     */
    function buildTitle(tranId, customerName) {
        var title = 'Delivery requested: ' + tranId + ' – ' + customerName;
        return title.length > TITLE_MAX ? title.slice(0, TITLE_MAX - 1) + '…' : title;
    }

    /**
     * Pure: the Task message.
     *
     * @param {Array<{label: string, oldText: string, newText: string}>} changes
     * @param {string} paymentText
     * @param {string} requests
     * @returns {string}
     */
    function buildMessage(changes, paymentText, requests) {
        var lines = ['The customer requested a delivery through the customer dashboard.', '',
            'Changed on the sales order (old → new):'];
        var i;
        for (i = 0; i < changes.length; i++) {
            lines.push('- ' + changes[i].label + ': ' + (changes[i].oldText || '(empty)') + ' → ' +
                (changes[i].newText || '(empty)'));
        }
        lines.push('');
        lines.push('Payment: ' + paymentText);
        lines.push('Special requests: ' + (requests || '(none)'));
        lines.push('');
        lines.push('Confirm the delivery date (custbody_del_date) once payment is in hand. The ' +
            'dashboard never sets it.');
        return lines.join('\n');
    }

    /**
     * Creates the Task.
     *
     * @param {Object} opts - { title, assigneeId, customerId, opportunityId, message, todayKey }
     * @returns {{id: number, sendEmailSet: boolean}}
     * @throws whatever record.create/save throws — the caller catches
     */
    function createDeliveryTask(opts) {
        var task = record.create({ type: record.Type.TASK, isDynamic: false });
        var sendEmailSet = true;

        task.setValue({ fieldId: 'title', value: opts.title });
        task.setValue({ fieldId: 'assigned', value: opts.assigneeId });
        task.setValue({ fieldId: 'company', value: opts.customerId });
        task.setValue({ fieldId: 'transaction', value: opts.opportunityId });
        task.setValue({ fieldId: 'message', value: opts.message });
        task.setValue({ fieldId: 'status', value: 'NOTSTART' });
        task.setValue({ fieldId: 'priority', value: 'HIGH' });
        task.setValue({ fieldId: 'startdate', value: dates.localDateForWrite(opts.todayKey) });
        task.setValue({ fieldId: 'duedate', value: dates.localDateForWrite(opts.todayKey) });
        try {
            task.setValue({ fieldId: 'sendemail', value: true });
        } catch (e) {
            // A field the account does not expose must not cost the customer their Task.
            sendEmailSet = false;
        }
        return { id: task.save({ ignoreMandatoryFields: true }), sendEmailSet: sendEmailSet };
    }

    return {
        VERSION: VERSION,
        buildTitle: buildTitle,
        buildMessage: buildMessage,
        createDeliveryTask: createDeliveryTask
    };
});
