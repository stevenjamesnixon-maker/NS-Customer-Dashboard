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
 * 1.3 (release 2.1 part B): the "Tell us where you're up to" Tasks — "Customer update: …" (normal
 * priority) and "Customer not going ahead: …" (HIGH) — through createTask(), which takes the priority.
 * createDeliveryTask() is createTask() at HIGH, unchanged. The messages are plain text: NetSuite shows
 * the Task message as text, and the customer's words go in as typed.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.3.0
 */
define(['N/record', './cdb_lib_dates'], function (record, dates) {

    'use strict';

    var VERSION = '1.3.0';

    /** Longest title the Task accepts. */
    var TITLE_MAX = 200;

    /**
     * Pure: the Task title.
     * @returns {string}
     */
    function buildTitle(tranId, description) {
        // 1.2: "Delivery requested: SO239737 · <description, first 60 chars>".
        var text = String(description || '');
        var title = 'Delivery requested: ' + tranId + (text ? ' \u00b7 ' + (text.length > 60 ? text.slice(0, 60) + '\u2026' : text) : '');
        return title.length > TITLE_MAX ? title.slice(0, TITLE_MAX - 1) + '\u2026' : title;
    }

    /**
     * Pure: the Task message.
     *
     * @param {Array<{label: string, oldText: string, newText: string}>} changes
     * @param {string} paymentText
     * @param {string} requests
     * @param {Object} [order] - 1.2: { description, uniqueRef, paymentChoice ('BACS' | 'Card' |
     *                           'Add to account'), amountText (render.amountText(): "£x inc VAT (£y ex VAT)";
     *                           2.0.5 — '' for Add to account or an unknown amount),
     *                           account (true for an Add-to-account booking) }
     * @returns {string}
     */
    function buildMessage(changes, paymentText, requests, order) {
        var o = order || {};
        var lines = ['The customer requested a delivery through the customer dashboard.', ''];
        var i;
        if (o.description) {
            lines.push('Order: ' + o.description);
        }
        if (o.uniqueRef) {
            lines.push('Split reference: ' + o.uniqueRef);
        }
        if (o.paymentChoice) {
            lines.push('Payment choice: ' + o.paymentChoice);
        }
        if (o.amountText) {
            lines.push('Amount to pay: ' + o.amountText);
        }
        if (o.description || o.uniqueRef || o.paymentChoice || o.amountText) {
            lines.push('');
        }
        lines.push('Changed on the sales order (old \u2192 new):');
        for (i = 0; i < changes.length; i++) {
            lines.push('- ' + changes[i].label + ': ' + (changes[i].oldText || '(empty)') + ' → ' +
                (changes[i].newText || '(empty)'));
        }
        lines.push('');
        lines.push('Payment: ' + paymentText);
        lines.push('Special requests: ' + (requests || '(none)'));
        lines.push('');
        lines.push(o.account ? 'Add the order to the customer\u2019s account and confirm the delivery date ' +
            '(custbody_del_date). The dashboard never sets it.' : 'Confirm the delivery date (custbody_del_date) ' +
            'once payment is in hand. The dashboard never sets it.');
        return lines.join('\n');
    }

    /** NetSuite's own priority text values, the same in every account. */
    var PRIORITY = { HIGH: 'HIGH', MEDIUM: 'MEDIUM' };

    /** Pure (1.3): a title cut to TITLE_MAX. */
    function clampTitle(title) {
        return title.length > TITLE_MAX ? title.slice(0, TITLE_MAX - 1) + '\u2026' : title;
    }

    /** Pure (1.3): "<lead>: QR123 <opportunity title>". */
    function oppTitle(lead, tranId, title) {
        return clampTitle(lead + ': ' + [tranId, title].filter(function (x) { return !!x; }).join(' '));
    }

    /** Pure (1.3): "Customer update: {QR} {title}". */
    function buildUpdateTitle(tranId, title) {
        return oppTitle('Customer update', tranId, title);
    }

    /** Pure (1.3): "Customer not going ahead: {QR} {title}". */
    function buildLostTitle(tranId, title) {
        return oppTitle('Customer not going ahead', tranId, title);
    }

    /**
     * Pure (1.3): the "Customer update" message.
     * @param {Object} o - { changes: [{label, oldText, newText}] (what was saved), notSaved: '' or the
     *   reason the opportunity write failed, attempted: [{label, oldText, newText}] (shown when notSaved),
     *   note, call: null or { phone, timeLabel } }
     * @returns {string}
     */
    function buildUpdateMessage(o) {
        var lines = ['The customer sent an update through the customer dashboard ("Tell us where you\u2019re up to").', ''];
        var list = o.notSaved ? (o.attempted || []) : (o.changes || []);
        var i;
        if (list.length) {
            lines.push(o.notSaved ? 'NOT saved on the opportunity (' + o.notSaved + '). Please update it by hand ' +
                '(old \u2192 new):' : 'Saved on the opportunity (old \u2192 new):');
            for (i = 0; i < list.length; i++) {
                lines.push('- ' + list[i].label + ': ' + (list[i].oldText || '(empty)') + ' \u2192 ' +
                    (list[i].newText || '(empty)'));
            }
        } else {
            lines.push('No changes to the opportunity.');
        }
        lines.push('');
        lines.push('Note from the customer: ' + (o.note || '(none)'));
        lines.push('');
        lines.push(o.call ? 'CALL REQUESTED: ' + o.call.phone + ', best time: ' + o.call.timeLabel + '.' :
            'No call requested.');
        return lines.join('\n');
    }

    /**
     * Pure (1.3): the "Customer not going ahead" message.
     * @param {Object} o - { reasonText, comment, lostLine ("Opportunity set to Lost" or "NOT set to Lost: …"),
     *   objectionLine ('' or what happened to the objection), quotes: null (could not be listed) or
     *   [{tranId, description}] }
     * @returns {string}
     */
    function buildLostMessage(o) {
        var lines = ['The customer told us through the customer dashboard that they are not going ahead.', ''];
        var i;
        lines.push('Reason: ' + (o.reasonText || '(none given)'));
        lines.push('Comment: ' + (o.comment || '(none)'));
        if (o.objectionLine) {
            lines.push(o.objectionLine);
        }
        lines.push('');
        lines.push(o.lostLine);
        lines.push('');
        if (o.quotes === null || o.quotes === undefined) {
            lines.push('Open quotes: could not be listed. Check the opportunity.');
        } else if (!o.quotes.length) {
            lines.push('Open quotes: none.');
        } else {
            lines.push('Open quotes (the dashboard has not changed them; please deal with them):');
            for (i = 0; i < o.quotes.length; i++) {
                lines.push('- ' + o.quotes[i].tranId + (o.quotes[i].description ? ': ' + o.quotes[i].description : ''));
            }
        }
        return lines.join('\n');
    }

    /**
     * Creates the Task.
     *
     * @param {Object} opts - { title, assigneeId, customerId, opportunityId, message, todayKey, priority
     *                          (PRIORITY; default HIGH, as every Task before 1.3) }
     * @returns {{id: number, sendEmailSet: boolean}}
     * @throws whatever record.create/save throws — the caller catches
     */
    function createTask(opts) {
        var task = record.create({ type: record.Type.TASK, isDynamic: false });
        var sendEmailSet = true;

        task.setValue({ fieldId: 'title', value: opts.title });
        task.setValue({ fieldId: 'assigned', value: opts.assigneeId });
        task.setValue({ fieldId: 'company', value: opts.customerId });
        task.setValue({ fieldId: 'transaction', value: opts.opportunityId });
        task.setValue({ fieldId: 'message', value: opts.message });
        task.setValue({ fieldId: 'status', value: 'NOTSTART' });
        task.setValue({ fieldId: 'priority', value: opts.priority || PRIORITY.HIGH });
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

    /** The delivery Task: createTask() at HIGH, exactly as before 1.3. */
    function createDeliveryTask(opts) {
        return createTask({ title: opts.title, assigneeId: opts.assigneeId, customerId: opts.customerId,
            opportunityId: opts.opportunityId, message: opts.message, todayKey: opts.todayKey, priority: PRIORITY.HIGH });
    }

    return {
        VERSION: VERSION,
        buildTitle: buildTitle,
        buildMessage: buildMessage,
        PRIORITY: PRIORITY,
        buildUpdateTitle: buildUpdateTitle,
        buildLostTitle: buildLostTitle,
        buildUpdateMessage: buildUpdateMessage,
        buildLostMessage: buildLostMessage,
        createTask: createTask,
        createDeliveryTask: createDeliveryTask
    };
});
