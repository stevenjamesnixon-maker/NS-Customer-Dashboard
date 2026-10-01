/**
 * cdb_ue_salesorder.js
 *
 * The sales order's "Send delivery link" button, and the banner after it (release 2.0).
 * User Event on Sales Order, beforeLoad only.
 *
 * VIEW ONLY, INTERNAL UI ONLY. In any other event (EDIT, CREATE, COPY…) or any other execution
 * context (CSV import, web services, scripts) it does nothing at all.
 *
 * THE BUTTON shows only when every one of these holds, read from the RECORD's own fields — no
 * search, no parameter, no governance:
 *   1. opportunity is set;
 *   2. the native order status (orderstatus) is A, B, D or E — config.SHIPPABLE_STATUSES without
 *      the 'SalesOrd:' prefix, so there is one definition of "can still ship";
 *   3. custbody_del_date is empty (not booked);
 *   4. custbody_cust_pay_intent is empty (not requested);
 *   5. custbody_ready_for_delivery is ticked.
 * The button is a convenience, not the check: the Suitelet runs data.guardOrder() — the full "open
 * + ready + not booked/requested/released" definition — before it sends anything. A released or
 * excluded order can show the button and is then refused.
 *
 * ON CLICK the browser goes to the internal Suitelet customscript_cdb_sl_send_link with so=<id>.
 * The URL is built here with url.resolveScript; the button's handler is a tiny inline
 * window.location call. No client script file.
 *
 * THE BANNER. After sending, the Suitelet redirects back here with cdbsl=sent|refused|failed and
 * cdblt=<milliseconds>. The banner text comes ONLY from config.SEND_LINK_BANNERS, a fixed whitelist
 * keyed by that code; an unknown code shows nothing, and nothing from the URL is ever shown. It
 * shows for config.SEND_LINK_BANNER_SECONDS (300) after cdblt, so a bookmarked or reloaded URL stops
 * showing it. The recipient's email is NOT in the banner: it is in neither the record nor the URL
 * (it is in the CDB SEND_LINK log and on the Communication tab).
 *
 * WRITES NOTHING. Never throws into the record view: any error is logged as CDB UE_FAILED.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @version 2.0.0
 */
define(['N/runtime', 'N/url', 'N/ui/message', 'N/log', './lib/cdb_lib_config'],
    function (runtime, url, message, log, config) {

    'use strict';

    var VERSION = '2.0.0';

    var SO = config.FIELDS.SALES_ORDER;

    var BUTTON_ID = 'custpage_cdb_send_link';
    var BUTTON_LABEL = 'Send delivery link';

    /** The URL parameters the Send delivery link Suitelet redirects back with. */
    var PARAM_CODE = 'cdbsl';
    var PARAM_TIME = 'cdblt';

    /** Seconds of clock difference between two NetSuite servers we tolerate for cdblt. */
    var SKEW_SECONDS = 60;

    function trim(value) {
        return String(value === null || value === undefined ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    /** A, B, D, E: config.SHIPPABLE_STATUSES without the 'SalesOrd:' prefix. */
    function shippableLetters() {
        return config.SHIPPABLE_STATUSES.map(function (code) {
            return code.replace(/^SalesOrd:/, '');
        });
    }

    /**
     * The five button conditions, from the record's fields only.
     * @param {Object} rec - context.newRecord
     * @returns {boolean}
     */
    function canSend(rec) {
        var ready = rec.getValue({ fieldId: SO.READY });
        return trim(rec.getValue({ fieldId: SO.OPPORTUNITY })) !== '' &&
            shippableLetters().indexOf(trim(rec.getValue({ fieldId: 'orderstatus' }))) >= 0 &&
            trim(rec.getValue({ fieldId: SO.CONFIRMED_DATE })) === '' &&
            trim(rec.getValue({ fieldId: SO.PAY_INTENT })) === '' &&
            (ready === true || ready === 'T');
    }

    /**
     * The whitelisted banner for the request, or null: unknown code, no or bad timestamp, or older
     * than SEND_LINK_BANNER_SECONDS.
     * @param {Object} params - request parameters
     * @param {number} nowMs
     * @returns {Object|null} an entry of config.SEND_LINK_BANNERS
     */
    function bannerFor(params, nowMs) {
        var code = trim(params && params[PARAM_CODE]);
        var sent = trim(params && params[PARAM_TIME]);
        var age;
        if (!config.SEND_LINK_BANNERS.hasOwnProperty(code) || !/^\d{1,15}$/.test(sent)) {
            return null;
        }
        age = nowMs - parseInt(sent, 10);
        if (age < -SKEW_SECONDS * 1000 || age > config.SEND_LINK_BANNER_SECONDS * 1000) {
            return null;
        }
        return config.SEND_LINK_BANNERS[code];
    }

    function addBanner(context) {
        var banner = bannerFor(context.request ? context.request.parameters : null, Date.now());
        if (banner) {
            context.form.addPageInitMessage({
                type: message.Type[banner.type],
                title: banner.title,
                message: banner.message
            });
        }
    }

    function addButton(context) {
        var id = trim(context.newRecord.id);
        var link;
        if (!/^\d+$/.test(id) || !canSend(context.newRecord)) {
            return;
        }
        link = url.resolveScript({
            scriptId: config.SCRIPTS.SEND_LINK,
            deploymentId: config.SCRIPTS.SEND_LINK_DEPLOYMENT,
            params: { so: id }
        });
        // The URL goes into an inline handler: only URL characters, never a quote or a bracket.
        if (!/^[A-Za-z0-9\/?=&._:%~+-]+$/.test(String(link))) {
            log.error({ title: config.logTitle('UE_FAILED'), details: 'Sales order ' + id +
                ': unexpected characters in the Suitelet URL, so no button: ' + String(link) });
            return;
        }
        context.form.addButton({
            id: BUTTON_ID,
            label: BUTTON_LABEL,
            functionName: 'window.location.assign(\'' + link + '\')'
        });
    }

    /**
     * @param {Object} context - beforeLoad context
     */
    function beforeLoad(context) {
        if (context.type !== context.UserEventType.VIEW ||
                runtime.executionContext !== runtime.ContextType.USER_INTERFACE) {
            return;
        }
        try {
            addBanner(context);
            addButton(context);
        } catch (e) {
            log.error({ title: config.logTitle('UE_FAILED'), details: 'Sales order ' +
                (context.newRecord ? context.newRecord.id : '') + ' (v' + VERSION + '): ' +
                (e && e.message ? e.message : String(e)) });
        }
    }

    return { beforeLoad: beforeLoad };
});
