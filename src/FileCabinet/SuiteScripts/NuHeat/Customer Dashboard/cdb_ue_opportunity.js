/**
 * cdb_ue_opportunity.js
 *
 * The opportunity's "Request design information" button, and the banner after it (release 2.3).
 * User Event on Opportunity, beforeLoad only. Built like cdb_ue_salesorder.js.
 *
 * VIEW ONLY, INTERNAL UI ONLY. In any other event (EDIT, CREATE, COPY…) or any other execution context it does
 * nothing at all.
 *
 * THE BUTTON shows only when ALL of these hold, read from the RECORD's own fields (data.requestRefusal(), the one
 * rule the Suitelet uses too):
 *   1. the status (entitystatus) is Won (WON_STATUSES);
 *   2. the sub-status is in NEEDINFO_SUBSTATUS (Awaiting Design Info);
 *   3. custbody_mi_opp_fc maps to anything but none in FC_MAP — and FC_MAP is set (empty or invalid: no button,
 *      since a OneZone, Electric UFH or Parts project could not be told apart).
 * Settings: the record only (SCRIPT_KEYS[OPP_UE]: WON_STATUSES, NEEDINFO_SUBSTATUS, FC_MAP), loaded quietly — one
 * settings search (~10 units) per view. Any error, or a missing setting: no button, log.debug.
 * The button is a convenience, not the check: the Suitelet runs the same checks on the server first.
 *
 * ON CLICK the browser goes to the internal Suitelet customscript_cdb_sl_send_designinfo with opp=<id>: a confirm
 * page, then the email. The URL is built here with url.resolveScript; the handler is a tiny inline
 * window.location call, as on the sales order. No client script file.
 *
 * THE BANNER. After sending, the Suitelet redirects back here with cdbdi=sent|failed and cdbdt=<milliseconds>. The
 * text comes ONLY from config.DESIGNINFO_BANNERS (a fixed whitelist); an unknown code shows nothing, and nothing
 * from the URL is shown. It shows for config.SEND_LINK_BANNER_SECONDS after cdbdt.
 *
 * WRITES NOTHING. Never throws into the record view.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['N/runtime', 'N/url', 'N/ui/message', 'N/log', './lib/cdb_lib_config', './lib/cdb_lib_data'],
    function (runtime, url, message, log, config, data) {

    'use strict';

    var VERSION = '1.0.0';

    var OPP = config.FIELDS.OPPORTUNITY;

    var BUTTON_ID = 'custpage_cdb_request_designinfo';
    var BUTTON_LABEL = 'Request design information';

    /** The URL parameters the Send design information Suitelet redirects back with. */
    var PARAM_CODE = 'cdbdi';
    var PARAM_TIME = 'cdbdt';

    /** Seconds of clock difference between two NetSuite servers we tolerate for cdbdt. */
    var SKEW_SECONDS = 60;

    function trim(value) {
        return String(value === null || value === undefined ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    /**
     * The whitelisted banner for the request, or null: unknown code, no or bad timestamp, or too old.
     * @returns {Object|null} an entry of config.DESIGNINFO_BANNERS
     */
    function bannerFor(params, nowMs) {
        var code = trim(params && params[PARAM_CODE]);
        var sent = trim(params && params[PARAM_TIME]);
        var age;
        if (!config.DESIGNINFO_BANNERS.hasOwnProperty(code) || !/^\d{1,15}$/.test(sent)) {
            return null;
        }
        age = nowMs - parseInt(sent, 10);
        if (age < -SKEW_SECONDS * 1000 || age > config.SEND_LINK_BANNER_SECONDS * 1000) {
            return null;
        }
        return config.DESIGNINFO_BANNERS[code];
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

    /** The three conditions, from the record: '' when the button may show, else why not. */
    function refusal(rec) {
        var cfg;
        try {
            cfg = config.load(log, true);
        } catch (e) {
            return 'settings: ' + (e && e.message ? e.message : String(e));
        }
        return data.requestRefusal(trim(rec.getValue({ fieldId: OPP.STATUS })), trim(rec.getValue({ fieldId: OPP.SUB_STATUS })),
            trim(rec.getValue({ fieldId: OPP.FC })), cfg);
    }

    function addButton(context) {
        var id = trim(context.newRecord.id);
        var why;
        var link;
        if (!/^\d+$/.test(id)) {
            return;
        }
        why = refusal(context.newRecord);
        if (why) {
            log.debug({ title: config.logTitle('DESIGNINFO_NO_BUTTON'), details: 'Opportunity ' + id + ': ' + why });
            return;
        }
        link = url.resolveScript({
            scriptId: config.SCRIPTS.SEND_DESIGNINFO,
            deploymentId: config.SCRIPTS.SEND_DESIGNINFO_DEPLOYMENT,
            params: { opp: id }
        });
        // The URL goes into an inline handler: only URL characters, never a quote or a bracket.
        if (!/^[A-Za-z0-9\/?=&._:%~+-]+$/.test(String(link))) {
            log.debug({ title: config.logTitle('DESIGNINFO_NO_BUTTON'), details: 'Opportunity ' + id +
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
            log.debug({ title: config.logTitle('DESIGNINFO_NO_BUTTON'), details: 'Opportunity ' +
                (context.newRecord ? context.newRecord.id : '') + ' (v' + VERSION + '): ' + (e && e.message ? e.message : String(e)) });
        }
    }

    return { beforeLoad: beforeLoad };
});
