/**
 * cdb_lib_config.js
 *
 * Every script ID, field ID and setting of the customer dashboard, and what an empty setting
 * means. Every dashboard script reads its configuration through load(); none reads a setting or a
 * parameter directly.
 *
 * NO NUMERIC INTERNAL IDS. List values, statuses, employees and quote types all differ between
 * Sandbox and Production, so they come from settings. Script and field IDs are the same in every
 * account and are committed here. See docs/context.md section 3.
 *
 * 3.0: ONE SETTINGS RECORD. Each setting is held once, as a row of the custom record
 * customrecord_cdb_setting (Name = the PARAMETERS key, custrecord_cdb_setting_value = the value,
 * written exactly as the parameter is). load() runs ONE search per script execution (cached in
 * module scope, ~10 units) and, for each key the script needs (SCRIPT_KEYS), takes:
 *   1. the active row's value when it is not blank            source "record"
 *   2. otherwise the script's own parameter (the IDs below)   source "parameter"
 *   3. otherwise the key's empty rule, unchanged              source "default" / "none" / "missing"
 * Either way the value goes through the same parser, so the same value gives the same config.
 * Two active rows for one key the script needs throw CDB_SETTING_DUPLICATE; a row whose name is not
 * a key is logged (CDB SETTING_UNKNOWN) and ignored; a failed search (no permission, no record
 * type) is logged (CDB SETTINGS_UNAVAILABLE) and every key falls back to its parameter.
 *
 * THE PARAMETERS ARE THE TRANSITION FALLBACK. Their IDs differ by script, because a script parameter
 * is a custom field and custom field IDs are unique across the account: the dashboard Suitelet's are
 * custscript_cdb_, the Map/Reduce's twins custscript_cdbmr_, the Send delivery link Suitelet's
 * custscript_cdbsend_. PARAMETERS names each explicitly per script (PARAMETER_COLUMNS picks the
 * column): no derivation and no cross-script fallback. Once every key logs "record" in
 * CDB SETTINGS_SOURCE they can be deleted (docs/context.md, "Removing the parameters"). A new
 * script gets no parameters: list its keys in SCRIPT_KEYS and give it no PARAMETER_COLUMNS entry.
 *
 * load() THROWS ONCE and names every missing setting, so a half-configured deployment fails with
 * one clear message instead of a trail of confusing ones.
 *
 * The pure parts, resolveSettings(), groupSettingRows() and readParameters(), take plain data and
 * getters and are node-tested.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * 3.1 (release 2.1 part B): three record-only keys for "Tell us where you're up to" —
 * UPD_LOST_STATUS_MAP, UPD_BUILD_STAGES and UPD_OBJECTION_TYPES. They have NO script parameter
 * (ids: {}): a missing row means the key's empty rule, "none". parseLostStatusMap() reads the map.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 3.1.0
 */
define(['N/runtime', 'N/search'], function (runtime, search) {

    'use strict';

    var VERSION = '3.1.0';

    /** Every log title starts with this. One string to grep the execution log for. */
    var LOG_PREFIX = 'CDB ';

    var SCRIPTS = {
        SUITELET: 'customscript_cdb_sl_dashboard',
        SUITELET_DEPLOYMENT: 'customdeploy_cdb_sl_dashboard',
        DIGEST: 'customscript_cdb_mr_digest',
        DIGEST_DEPLOYMENT: 'customdeploy_cdb_mr_digest',
        // 2.0: the internal Suitelet behind the sales order's "Send delivery link" button, and the
        // User Event that adds the button.
        SEND_LINK: 'customscript_cdb_sl_send_link',
        SEND_LINK_DEPLOYMENT: 'customdeploy_cdb_sl_send_link',
        SALES_ORDER_UE: 'customscript_cdb_ue_salesorder'
    };

    /**
     * The API Secret. Set to "Allow for all scripts" in the account (2.0 correction): restricting it
     * to named scripts failed in Production ("An error occurred while decrypting a secret"), probably
     * because N/crypto is called from a library file. Never restricted by employee.
     */
    var SECRET_ID = 'custsecret_cdb_link_key';

    /**
     * 3.0: the Customer Dashboard Setting record (Steve creates it; docs/context.md section 4,
     * "Settings"). Name field on: the Name is the PARAMETERS key. NOTES is for people; the code never
     * reads it. Inactive rows are ignored.
     */
    var SETTING_RECORD = {
        TYPE: 'customrecord_cdb_setting',
        NAME: 'name',
        VALUE: 'custrecord_cdb_setting_value',
        NOTES: 'custrecord_cdb_setting_notes'
    };

    var RECORD_TYPES = {
        NON_DELIVERY: 'customrecord_cdb_nondelivery',
        // 3.1: the Customer Objection types (Online-quote); names read for the "Why not?" list.
        OBJECTION_TYPE: 'customrecord_nh_objection_type',
        LIST_TIME: 'customlist_del_time_per',
        LIST_VEHICLE: 'customlist_delivery_veh',
        LIST_UNLOAD: 'customlist_unload_req'
    };

    /**
     * Field IDs, grouped by the record that OWNS them. custbody_ says nothing about which
     * transaction a field is on, so the record is the point of this table.
     * custbody_opp_site_adress is spelt with one d in the account. It is the real ID: do not fix it.
     */
    var FIELDS = {
        CUSTOMER: {
            LINK_VERSION: 'custentity_cdb_link_version',
            DASHBOARD_CONTACT: 'custentity_cdb_dashboard_contact',
            DIGEST_OPTOUT: 'custentity_cdb_digest_optout',
            LAST_DIGEST: 'custentity_cdb_last_digest'
        },
        OPPORTUNITY: {
            STATUS: 'entitystatus',
            SUB_STATUS: 'custbody_opportunity_sub_status',
            SITE_ADDRESS: 'custbody_opp_site_adress',
            PE: 'custbody_pe',
            VALUE_PROPOSITION: 'custbody_value_proposition',
            // 3.1 (release 2.1 part B): the two fields the customer can change, through the Online-quote
            // Update Opportunity library only (OPPLIB below). Read by guardOpportunity(); never written here.
            BUILD_STAGE: 'custbody_build_stage',
            DEL_DATE: 'custbody_opp_del_date'
        },
        SALES_ORDER: {
            OPPORTUNITY: 'opportunity',
            RECORD_STATUS: 'custbody_finance_status',
            QUOTE_TYPE: 'custbody_quote_type',
            CONFIRMED_DATE: 'custbody_del_date',
            READY: 'custbody_ready_for_delivery',
            HOLD_REASON: 'custbody_delivery_hold_reason',
            SHIP_DATE: 'custbody_defaultshipdate',
            TIME: 'custbody_del_time_per',
            VEHICLE: 'custbody_delivery_veh',
            UNLOAD: 'custbody_unload_req',
            CONTACT_NAME: 'custbody_del_contact',
            CONTACT_PHONE: 'custbody_delivery_con_num',
            CONTACT_EMAIL: 'custbody_delivery_con_email',
            SPECIAL_REQUESTS: 'custbody_special_requests',
            PAY_INTENT: 'custbody_cust_pay_intent',
            BOOKING_REQUESTED: 'custbody_cust_booking_req',
            SHIP_ADDRESS: 'shipaddresslist',
            // 1.1. Optional on the loaded record: written only when so.getField() finds them.
            AWAITING_PAYMENT: 'custbody_cdb_awaiting_payment',
            EDD_CERTAINTY: 'custbody_edd_certainty',
            // 1.2. Read ONLY by cdb_lib_data.getOrderExtras(), a separate fail-safe search. Never add
            // these to the main order searches: a field that does not apply to sales orders makes
            // the whole search throw. custbodycustbody_sys_bal_incvat has a DOUBLED PREFIX in the
            // account. It is the real ID: do not "fix" it.
            TERMS: 'terms',
            UNIQUE_REF: 'custbody_unique_so_ref',
            // 2.0.5 (Steve, 1 Oct): the system balances are THE amount to pay, after any deposits —
            // BALANCE including VAT, BALANCE_EX excluding VAT. Nothing else is read for the amount: the
            // old total - custbody_deposit_total fallback gave inconsistent, wrong figures.
            BALANCE: 'custbodycustbody_sys_bal_incvat',
            BALANCE_EX: 'custbody_sys_bal_exvat'
        },
        /**
         * Read from the sales order's ORIGINATING QUOTE through the createdFrom join. Confirmed
         * on the Estimate only: never add it as an unjoined sales order column, which can make
         * the whole search throw if the field does not apply to sales orders.
         */
        QUOTE: {
            JOIN: 'createdFrom',
            DESCRIPTION: 'custbody_quote_description'
        },
        NON_DELIVERY: {
            DATE: 'custrecord_cdb_nd_date'
        },
        /** 2.0.2: the account manager's photo for the email card (Send Quote 2.2.0 reads the same field). */
        EMPLOYEE: {
            PHOTO_LINK: 'custentity_employee_photo_link'
        }
    };

    /**
     * The native sales order statuses that can still ship (addendum of 30 Sep). An order counts
     * only if its native status is one of these, IN ADDITION to the Record Status rule.
     * Standard NetSuite status codes, the same in every account, so they belong in code. They
     * match the input filter of opsync_mr_readiness.js in NS-Opportunity-SO-Sync (PR #8).
     *
     *   SalesOrd:A  Pending Approval
     *   SalesOrd:B  Pending Fulfillment
     *   SalesOrd:D  Partially Fulfilled
     *   SalesOrd:E  Pending Billing/Partially Fulfilled
     *
     * Left out deliberately: C Cancelled, F Pending Billing, G Billed, H Closed.
     *
     * These codes are FILTER values. A search result's status column does not return them, so
     * never compare a column value against this list; filter with it.
     */
    var SHIPPABLE_STATUSES = ['SalesOrd:A', 'SalesOrd:B', 'SalesOrd:D', 'SalesOrd:E'];

    /**
     * 1.3: the native statuses of an order that HAS SHIPPED — fully fulfilled. Used only by the
     * "Recently delivered" search. Standard NetSuite codes, not account IDs.
     *
     *   SalesOrd:F  Pending Billing
     *   SalesOrd:G  Billed
     */
    var DELIVERED_STATUSES = ['SalesOrd:F', 'SalesOrd:G'];

    var TEXT_LIMITS = {
        CONTACT_NAME: 100,
        CONTACT_PHONE: 40,
        CONTACT_EMAIL: 254,
        SPECIAL_REQUESTS: 1000,
        // 3.1: "Tell us where you're up to": the note and the not-going-ahead comment.
        UPDATE_NOTE: 1000,
        UPDATE_COMMENT: 1000
    };

    /**
     * 3.1 (release 2.1 part B): the Online-quote Update Opportunity library — the ONLY way the dashboard
     * writes an opportunity or creates an objection. Required by ABSOLUTE path at request time (not in
     * define()), so a missing or old library costs the update action only, never the dashboard. The
     * folder name has a space; AMD module IDs allow it. MIN_VERSION: fieldOptions, writeOppUpdate and
     * createObjections arrived in 1.2.0.
     */
    var OPPLIB = {
        PATH: '/SuiteScripts/NuHeat/2026 Quote/nuheat_opp_update_lib',
        MIN_VERSION: '1.2.0'
    };

    /**
     * 3.1: the customer stages an opportunity's customer can be at, as UPD_LOST_STATUS_MAP keys them.
     * NetSuite's own stage names, the same in every account.
     */
    var CUSTOMER_STAGES = ['LEAD', 'PROSPECT', 'CUSTOMER'];

    /** 3.1: the "best time to call" choices. Customer-facing wording; the Task uses label. */
    var CALL_TIMES = {
        MORNING: { label: 'Morning', phrase: 'in the morning' },
        AFTERNOON: { label: 'Afternoon', phrase: 'in the afternoon' },
        ANY: { label: 'Any time', phrase: 'soon' }
    };
    var CALL_TIME_ORDER = ['MORNING', 'AFTERNOON', 'ANY'];

    /** How far ahead a delivery can be booked. */
    var BOOKING_HORIZON_MONTHS = 6;

    var DIGEST_MODES = { TEST: 'TEST', LIVE: 'LIVE' };

    /**
     * The guidance above the vehicle and unloading options (release 1.1). Customer-facing wording,
     * so it lives here rather than in the render code. Each paragraph is [bold lead, rest]; both
     * parts are escaped when rendered.
     */
    var DELIVERY_GUIDANCE = [
        ['Most deliveries come on an articulated lorry, up to 16 m long and 4 m tall.',
            ' If there are narrow lanes, low branches, tight turns or narrow gates on the way, ' +
            'choose a smaller vehicle and we\u2019ll arrange it.'],
        ['Unloading:',
            ' the driver unloads at the nearest flat, level, hard surface, such as the kerbside ' +
            'or a driveway, and can\u2019t move it further. Please have people on site to help ' +
            'carry everything into dry storage. Pallets can weigh up to 1,250 kg.']
    ];

    /**
     * 2.0: the "Send delivery link" email's wording, in one place. Plain text: render escapes every
     * value. {SO} in SUBJECT is the order number; {name} in HELLO the greeting name.
     */
    var DELIVERY_LINK_EMAIL = {
        SUBJECT: 'Your order {SO} is ready to deliver: choose your date',
        // 2.0.3: the v2 design (docs/design/canvas/EmailDeliveryLink.dc.html).
        EYEBROW: 'READY TO DELIVER',
        HEADING: 'Your order is ready, {name}',
        HEADING_NO_NAME: 'Your order is ready',
        SUB: 'Choose a delivery date that suits you. It only takes a couple of minutes.',
        ORDER_LABEL: 'YOUR ORDER',
        FACT_ORDER: 'Order',
        FACT_PROJECT: 'Project',
        FACT_THIS_ORDER: 'This order',
        FACT_EARLIEST: 'Earliest delivery',
        EARLIEST_SOONER: '(sooner? call us)',
        FACT_AMOUNT: 'Amount to pay',
        BUTTON: 'CHOOSE MY DELIVERY DATE',
        DASHBOARD_LINK: 'Or view all your projects',
        HOW_HEADING: 'How it works',
        STEP1_TITLE: 'Pick a date',
        STEP1_TEXT: 'Any weekday from {n} working days’ time, morning, afternoon or any time.',
        // {first} the AM's first name ("us" when none); {phone} becomes a tel: link.
        SOONER: 'Need it sooner? That’s fine, just call {first} on {phone} and we’ll do our best.',
        SOONER_NO_NAME: 'us',
        STEP2_TITLE: 'Tell us about access',
        STEP2_TEXT: 'The largest lorry that can reach you, how we unload, and who to call on the day.',
        STEP3_TITLE: 'Pay, and we confirm',
        STEP3_PREPAY: 'Pay by bank transfer or card. We book your delivery and email you the confirmed date.',
        STEP3_ACCOUNT: 'Choose how you’d like to pay, or add it to your account. We book your delivery and ' +
            'email you the confirmed date.',
        TIPS_HEADING: 'Before you book',
        // [title, text, icon key (EMAIL_ICONS)]
        TIPS: [
            ['Lorry access', 'Most deliveries come on an articulated lorry up to 16 m long. Narrow lanes or low ' +
                'branches? Tell us and we’ll send a smaller one.', 'LORRY'],
            ['Where it’s left', 'The driver unloads at the nearest flat, hard surface, such as the kerbside or ' +
                'driveway.', 'PARCEL'],
            ['People on site', 'Pallets can weigh up to 1,250 kg, so please have help to move everything into dry ' +
                'storage.', 'PEOPLE']
        ],
        QUESTIONS: 'Questions?',
        PERSONAL: 'This link is personal to you. Please don’t forward this email.',
        FOOTER: 'You’re receiving this because you have an order with Nu-Heat.',
        // 2.0.2: the hidden preview text.
        PREHEADER: 'Your order is ready: choose your delivery date.'
    };

    /**
     * 2.0.3: the digest v2 wording (docs/design/canvas/EmailDigestV2.dc.html).
     */
    var DIGEST_EMAIL = {
        TILES: { READY: 'ready to book', PAY: 'awaiting payment', DESIGN: 'in design', BOOKED: 'booked' },
        ACTION_ONE: '1 order is ready to deliver',
        ACTION_MANY: '{n} orders are ready to deliver',
        ACTION_BUTTON: 'CHOOSE DATE',
        ACTION_MAX: 3,
        ACTION_MORE: 'and {n} more on your projects page',
        PROJECTS_HEADING: 'Your projects',
        STAGES: ['Quote', 'Ordered', 'Design', 'Delivery', 'Delivered'],
        STAGE_BOOKED: 'Booked',
        DESIGNING: 'Our design team is working on it. Nothing needed from you.',
        NEEDS_INFO: 'We need some information from you for the design.',
        QUOTE_SENT: 'Quote sent',
        BUTTON: 'VIEW ALL YOUR PROJECTS'
    };

    /**
     * FIXED BRANDING IMAGES ARE CONSTANTS, NOT PARAMETERS (Steve, 1 Oct 2026, amendment 4). Parameters are
     * for values that differ by account or that the business changes; these are public image
     * addresses — a stated exception to "no numeric IDs in code" (docs/context.md section 3).
     *
     * 2.0.4: the delivery-link email's hero is Send Quote 2.2.0's hero ("Order conformation.jpg"), its
     * URL and width/height attributes copied exactly from 2026.03-Online-quote nuheat_send_quote_sl.js
     * line 1278 (commit 4463cfa; the image host is EMAIL_IMG, nuheat_opp_update_lib.js line 858). Used
     * only when it starts with https://, so a blank value just leaves the image out.
     */
    var EMAIL_HERO_URL = 'https://images.chamaileon.io/5b1fac592f38b800113c85ca/5ca8626420e2346b3ee9a013/1613738610524_Order%20conformation.jpg';
    var EMAIL_HERO_WIDTH = 600;
    var EMAIL_HERO_HEIGHT = 337;

    /**
     * 2.0.4: the "Before you book" icons — square PNGs, teal on transparent, in the File Cabinet.
     * Rendered 48 x 48, alt="". https only; a blank value shows that tip as text only.
     */
    var EMAIL_ICONS = {
        LORRY: 'https://472052.app.netsuite.com/core/media/media.nl?id=45288884&c=472052&h=YG3D77A_OOKzKO9LzdSh8qCBM_Qr_En-TPwnaNAj05uNwXTt',
        PARCEL: 'https://472052.app.netsuite.com/core/media/media.nl?id=45288882&c=472052&h=LYL2p04TmhzcuKyFJgXMvB494htOkdY4CtKz2NtMjNuki5Xh',
        PEOPLE: 'https://472052.app.netsuite.com/core/media/media.nl?id=45288883&c=472052&h=C5AaAsJ443aW4Ynf8xeMzviVQiVXnajV6qhnVZQCv8dGaTx2'
    };

    /**
     * 2.0.2: THE CUSTOMER EMAIL STANDARD — Send Quote 2.2.0's email card, constants copied unchanged
     * from 2026.03-Online-quote nuheat_opp_update_lib.js 1.1.0 (commit 4463cfa): the image host, the
     * green footer, its logo and the five social links, and the button colours. Every customer email
     * from the dashboard (the digest and the delivery link) uses them, so they are one family with the
     * quote email. Change them here and in the Online-quote library together.
     */
    var EMAIL_STANDARD = {
        IMG_BASE: 'https://images.chamaileon.io/5b1fac592f38b800113c85ca/5ca8626420e2346b3ee9a013/',
        FOOTER_LOGO: '1604422010305_Nu-Heat%20Master%20logo%20wht%20on%20green.png',
        FOOTER_BG: '#25847a',
        SOCIAL_LINKS: [
            ['https://www.facebook.com/nuheatuk/', '1604502171665_white%20-%20facebook.png'],
            ['https://www.instagram.com/nuheatufh/', '1604502172039_white%20-%20instagram.png'],
            ['https://www.linkedin.com/company/nu-heat/', '1604502171857_white%20-%20linkedin.png'],
            ['https://twitter.com/nuheatuk', '1604502172417_white%20-%20twitter.png'],
            ['https://youtube.com/channel/UCsfB8s56fcERuaBFovwYnGQ', '1604502172308_white%20-%20youtube.png']
        ],
        BUTTON_BG: '#ffb500',
        BUTTON_TEXT: '#3e3b39',
        // 2.0.3 (v2 designs): the AM card's CALL (filled) and EMAIL (outline) buttons, the purple button,
        // the section heading colours, the panels and the footer.
        PURPLE: '#59315f',
        MAGENTA: '#a3155f',
        TEAL: '#25847a',
        PANEL: '#f4f4f4',
        FOOTER_TEXT: '#e6f3f1',
        // 2.0.3: Send Quote's contact fallback, when the AM employee has no phone or no email.
        FALLBACK_PHONE: '01404 540604',
        FALLBACK_EMAIL: 'info@nu-heat.co.uk',
        // The card's name when the employee has none (Send Quote's GENERIC_REP_NAME); never a first name.
        GENERIC_AM_NAME: 'Your Account Manager',
        DIGEST_PREHEADER: 'Here\u2019s where your Nu-Heat projects are up to.'
    };

    /**
     * 2.0: the sales order banner after "Send delivery link". A FIXED WHITELIST keyed by the cdbsl
     * code in the URL: only these texts are ever shown, and an unknown code shows nothing. Nothing
     * from the URL is shown. type is an N/ui/message Type key.
     */
    var SEND_LINK_BANNERS = {
        sent: { type: 'CONFIRMATION', title: 'Delivery link sent',
            message: 'The customer has been emailed a link to arrange delivery for this order. ' +
                'The email is on the Communication tab.' },
        refused: { type: 'WARNING', title: 'Delivery link not sent',
            message: 'This order can\u2019t be booked online right now (it may already be booked, requested, ' +
                'released or not ready), or the customer has no email address. Details are in the script ' +
                'log (CDB SEND_REFUSED or CDB SEND_NO_RECIPIENT).' },
        failed: { type: 'ERROR', title: 'Delivery link not sent',
            message: 'The email could not be sent. Details are in the script log (CDB SEND_FAILED).' }
    };

    /** 2.0: how long the banner shows after the redirect (cdblt, milliseconds since the epoch). */
    var SEND_LINK_BANNER_SECONDS = 300;

    /**
     * Every setting, by key. The key is also the Name of its customrecord_cdb_setting row (3.0).
     *
     * kind (the same parser for a record value and a parameter value):
     *   idlist  comma list of whole numbers -> string[]
     *   id      one whole number (Integer, or a List/Record select) -> string
     *   int     whole number >= 0 -> number
     *   mode    TEST | LIVE
     *   https   an https URL
     *   text    free text
     *
     * empty (neither a record value nor a parameter value, or the chosen value is invalid):
     *   throw    missing -> named in the one error load() throws
     *   default  missing or invalid -> the default, logged at audit
     *   none     missing -> the empty value, logged at audit
     *
     * ids: the transition fallback, the parameter's ID on each existing script (PARAMETER_COLUMNS).
     * Which keys a script needs is SCRIPT_KEYS, not this table.
     */
    var PARAMETERS = {
        WON_STATUSES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_won_statuses', MR: 'custscript_cdbmr_won_statuses' } },
        LOST_STATUSES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_lost_statuses', MR: 'custscript_cdbmr_lost_statuses' } },
        DESIGN_SUBSTATUS: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_design_substatus', MR: 'custscript_cdbmr_design_substatus' } },
        NEEDINFO_SUBSTATUS: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_needinfo_substatus', MR: 'custscript_cdbmr_needinfo_substatus' } },
        DELIVERY_SUBSTATUS: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_delivery_substatus', MR: 'custscript_cdbmr_delivery_substatus' } },
        EXCLUDED_STATUSES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_excluded_statuses', MR: 'custscript_cdbmr_excluded_statuses',
                SEND: 'custscript_cdbsend_excluded_statuses' } },
        EXCLUDED_QUOTE_TYPES: { kind: 'idlist', empty: 'throw',
            ids: { SL: 'custscript_cdb_excluded_quote_types', MR: 'custscript_cdbmr_excluded_quote_types',
                SEND: 'custscript_cdbsend_excluded_quote_types' } },
        // 2.0: the Send delivery link Suitelet (SEND) reads six of these, as custscript_cdbsend_ twins:
        // the guard's three lists, the fallback author, the logo and (2.0.1) the type labels. Empty
        // means what it means on the dashboard Suitelet.
        PAY_BACS: { kind: 'id', empty: 'throw',
            ids: { SL: 'custscript_cdb_pay_bacs', MR: 'custscript_cdbmr_pay_bacs' } },
        PAY_CARD: { kind: 'id', empty: 'throw',
            ids: { SL: 'custscript_cdb_pay_card', MR: 'custscript_cdbmr_pay_card' } },
        FALLBACK_EMPLOYEE: { kind: 'id', empty: 'throw',
            ids: { SL: 'custscript_cdb_fallback_employee', MR: 'custscript_cdbmr_fallback_employee',
                SEND: 'custscript_cdbsend_fallback_employee' } },
        // 1.2. Pay up front vs account. Empty prepay terms -> everyone pays up front; empty account
        // value -> the account option is never offered. Both fail closed: they offer less.
        // Suitelet only: nothing in the digest reads it (amendment 1).
        // 2.0.3: SEND twins too, for the delivery-link email's "Amount to pay" row and step 3 wording.
        PREPAY_TERMS: { kind: 'idlist', empty: 'none',
            ids: { SL: 'custscript_cdb_prepay_terms', SEND: 'custscript_cdbsend_prepay_terms' } },
        PAY_ACCOUNT: { kind: 'id', empty: 'none',
            ids: { SL: 'custscript_cdb_pay_account', MR: 'custscript_cdbmr_pay_account',
                SEND: 'custscript_cdbsend_pay_account' } },
        // 1.3. Record Statuses that stay visible although they are in EXCLUDED_STATUSES ("Release to
        // Warehouse": staff set it when payment arrives). Empty -> released orders stay hidden.
        RELEASED_STATUSES: { kind: 'idlist', empty: 'none',
            ids: { SL: 'custscript_cdb_released_statuses', MR: 'custscript_cdbmr_released_statuses',
                SEND: 'custscript_cdbsend_released_statuses' } },
        // 1.3. "Recently delivered": how many days back, and the Record Statuses never shown there.
        RECENT_DAYS: { kind: 'int', empty: 'default', defaultValue: 7,
            ids: { SL: 'custscript_cdb_recent_days', MR: 'custscript_cdbmr_recent_days' } },
        RECENT_HIDDEN_STATUSES: { kind: 'idlist', empty: 'none',
            ids: { SL: 'custscript_cdb_recent_hidden_statuses', MR: 'custscript_cdbmr_recent_hidden_statuses' } },
        // 1.2. JSON {"<quote type id>": "UFH", ...}. Parsed by parseTypeLabels(); never fails the page.
        QUOTE_TYPE_LABELS: { kind: 'text', empty: 'none',
            ids: { SL: 'custscript_cdb_quote_type_labels', MR: 'custscript_cdbmr_quote_type_labels',
                SEND: 'custscript_cdbsend_quote_type_labels' } },
        LOGO_URL: { kind: 'https', empty: 'none',
            ids: { SL: 'custscript_cdb_logo_url', MR: 'custscript_cdbmr_logo_url',
                SEND: 'custscript_cdbsend_logo_url' } },

        TIME_VALUES: { kind: 'idlist', empty: 'throw', ids: { SL: 'custscript_cdb_time_values' } },
        VEHICLE_VALUES: { kind: 'idlist', empty: 'throw', ids: { SL: 'custscript_cdb_vehicle_values' } },
        UNLOAD_VALUES: { kind: 'idlist', empty: 'throw', ids: { SL: 'custscript_cdb_unload_values' } },
        PE_VALUEPROPS: { kind: 'idlist', empty: 'none', ids: { SL: 'custscript_cdb_pe_valueprops' } },
        // 2.0.3: SEND twin for the delivery-link email's "Earliest delivery" (the form's calculation).
        NOTICE_DAYS: { kind: 'int', empty: 'default', defaultValue: 3,
            ids: { SL: 'custscript_cdb_notice_days', SEND: 'custscript_cdbsend_notice_days' } },
        BANK_NAME: { kind: 'text', empty: 'throw', ids: { SL: 'custscript_cdb_bank_name' } },
        BANK_SORT: { kind: 'text', empty: 'throw', ids: { SL: 'custscript_cdb_bank_sort' } },
        BANK_ACCOUNT: { kind: 'text', empty: 'throw', ids: { SL: 'custscript_cdb_bank_account' } },
        // 1.1. JSON hints for the vehicle and unloading option cards. Parsed by parseOptionHints();
        // a bad value never fails the page.
        OPTION_HINTS: { kind: 'text', empty: 'none', ids: { SL: 'custscript_cdb_option_hints' } },
        // 1.1. The customlist955 ID for "Customer Definite". Empty writes nothing (fails closed).
        EDD_DEFINITE: { kind: 'id', empty: 'none', ids: { SL: 'custscript_cdb_edd_definite_value' } },

        DIGEST_MODE: { kind: 'mode', empty: 'throw', ids: { MR: 'custscript_cdb_digest_mode' } },
        DIGEST_TEST_CUSTOMERS: { kind: 'idlist', empty: 'throw', onlyInTestMode: true,
            ids: { MR: 'custscript_cdb_digest_test_customers' } },
        DIGEST_DAYS: { kind: 'int', empty: 'default', defaultValue: 14,
            ids: { MR: 'custscript_cdb_digest_days' } },
        DIGEST_CAP: { kind: 'int', empty: 'default', defaultValue: 200,
            ids: { MR: 'custscript_cdb_digest_cap' } },

        // 3.1 (release 2.1 part B): "Tell us where you're up to". RECORD ONLY — no parameter on any
        // script (ids: {}), so a missing row is "none". Dashboard Suitelet only.
        // JSON {"CUSTOMER": "<status id>", "PROSPECT": "...", "LEAD": "..."}: the Lost status for an
        // opportunity whose customer is at that stage (parseLostStatusMap()). Empty or invalid: "not going
        // ahead" sends the Task but does not set Lost. NEVER another stage's status (it can move the stage).
        UPD_LOST_STATUS_MAP: { kind: 'text', empty: 'none', ids: {} },
        // custbody_build_stage option IDs offered, in this order. Empty: the stage question is hidden.
        UPD_BUILD_STAGES: { kind: 'idlist', empty: 'none', ids: {} },
        // customrecord_nh_objection_type IDs offered as "Why not?", in this order. Empty: no reason list.
        UPD_OBJECTION_TYPES: { kind: 'idlist', empty: 'none', ids: {} }
    };

    /**
     * 3.0: which settings each script needs, and nothing else. A script that is not here throws
     * CDB_UNKNOWN_SCRIPT. A new script is added here with its keys and no PARAMETER_COLUMNS entry:
     * it reads the record only. A node test checks each list against its PARAMETERS column.
     */
    var SCRIPT_KEYS = {};
    SCRIPT_KEYS[SCRIPTS.SUITELET] = ['WON_STATUSES', 'LOST_STATUSES', 'DESIGN_SUBSTATUS', 'NEEDINFO_SUBSTATUS',
        'DELIVERY_SUBSTATUS', 'EXCLUDED_STATUSES', 'EXCLUDED_QUOTE_TYPES', 'PAY_BACS', 'PAY_CARD', 'FALLBACK_EMPLOYEE',
        'PREPAY_TERMS', 'PAY_ACCOUNT', 'RELEASED_STATUSES', 'RECENT_DAYS', 'RECENT_HIDDEN_STATUSES', 'QUOTE_TYPE_LABELS',
        'LOGO_URL', 'TIME_VALUES', 'VEHICLE_VALUES', 'UNLOAD_VALUES', 'PE_VALUEPROPS', 'NOTICE_DAYS', 'BANK_NAME',
        'BANK_SORT', 'BANK_ACCOUNT', 'OPTION_HINTS', 'EDD_DEFINITE',
        // 3.1: record only, no parameter column entry.
        'UPD_LOST_STATUS_MAP', 'UPD_BUILD_STAGES', 'UPD_OBJECTION_TYPES'];
    SCRIPT_KEYS[SCRIPTS.DIGEST] = ['WON_STATUSES', 'LOST_STATUSES', 'DESIGN_SUBSTATUS', 'NEEDINFO_SUBSTATUS',
        'DELIVERY_SUBSTATUS', 'EXCLUDED_STATUSES', 'EXCLUDED_QUOTE_TYPES', 'PAY_BACS', 'PAY_CARD', 'FALLBACK_EMPLOYEE',
        'PAY_ACCOUNT', 'RELEASED_STATUSES', 'RECENT_DAYS', 'RECENT_HIDDEN_STATUSES', 'QUOTE_TYPE_LABELS', 'LOGO_URL',
        'DIGEST_MODE', 'DIGEST_TEST_CUSTOMERS', 'DIGEST_DAYS', 'DIGEST_CAP'];
    SCRIPT_KEYS[SCRIPTS.SEND_LINK] = ['EXCLUDED_STATUSES', 'EXCLUDED_QUOTE_TYPES', 'FALLBACK_EMPLOYEE', 'PREPAY_TERMS',
        'PAY_ACCOUNT', 'RELEASED_STATUSES', 'QUOTE_TYPE_LABELS', 'LOGO_URL', 'NOTICE_DAYS'];

    /**
     * 3.0: the transition fallback. Which PARAMETERS ids column each existing script's parameters
     * are in. Removed, with the parameters, once every key reads from the record.
     */
    var PARAMETER_COLUMNS = {};
    PARAMETER_COLUMNS[SCRIPTS.SUITELET] = 'SL';
    PARAMETER_COLUMNS[SCRIPTS.DIGEST] = 'MR';
    PARAMETER_COLUMNS[SCRIPTS.SEND_LINK] = 'SEND';

    /** 3.0: where each value came from, as CDB SETTINGS_SOURCE prints it. */
    var SOURCES = { RECORD: 'record', PARAMETER: 'parameter', DEFAULT: 'default', NONE: 'none',
        MISSING: 'missing', UNUSED: 'unused' };

    /**
     * @param {*} value
     * @returns {boolean} true for null, undefined, '' and whitespace
     */
    function isBlank(value) {
        return value === null || value === undefined || String(value).replace(/^\s+|\s+$/g, '') === '';
    }

    /**
     * @param {string} raw
     * @returns {string[]|null} whole-number IDs, or null when any entry is not a whole number
     */
    function parseIdList(raw) {
        var parts = String(raw).split(',');
        var result = [];
        var i;
        var part;
        for (i = 0; i < parts.length; i++) {
            part = parts[i].replace(/^\s+|\s+$/g, '');
            if (part === '') {
                continue;
            }
            if (!/^\d+$/.test(part)) {
                return null;
            }
            result.push(String(parseInt(part, 10)));
        }
        return result.length ? result : null;
    }

    /**
     * Parses one raw value by kind.
     * @returns {{ok: boolean, value: *}}
     */
    function parseValue(kind, raw) {
        var text = String(raw).replace(/^\s+|\s+$/g, '');
        var list;
        switch (kind) {
            case 'idlist':
                list = parseIdList(text);
                return { ok: list !== null, value: list };
            case 'id':
                return { ok: /^\d+$/.test(text), value: text };
            case 'int':
                return { ok: /^\d+$/.test(text), value: parseInt(text, 10) };
            case 'mode':
                text = text.toUpperCase();
                return { ok: text === DIGEST_MODES.TEST || text === DIGEST_MODES.LIVE, value: text };
            case 'https':
                return { ok: /^https:\/\/[^\s"'<>]+$/i.test(text), value: text };
            default:
                return { ok: true, value: text };
        }
    }

    /**
     * The empty value of a kind, used for 'none'.
     */
    function emptyValue(kind) {
        return kind === 'idlist' ? [] : '';
    }

    /**
     * @param {string} column - 'SL', 'MR' or 'SEND'
     * @returns {string[]} the keys with a parameter in that column, in PARAMETERS order
     */
    function keysForColumn(column) {
        var keys = [];
        var key;
        for (key in PARAMETERS) {
            if (PARAMETERS.hasOwnProperty(key) && PARAMETERS[key].ids[column]) {
                keys.push(key);
            }
        }
        return keys;
    }

    /**
     * Pure (3.0): groups the active settings rows by key.
     *
     * @param {Array<{id: string, name: string, value: *}>} list - the search's rows
     * @returns {{rows: Object, unknown: string[]}}
     *   rows     known key -> [{id, value}], every active row for it (two or more is a duplicate)
     *   unknown  'name (id)' for each row whose trimmed name is not a PARAMETERS key, exactly as typed
     */
    function groupSettingRows(list) {
        var rows = {};
        var unknown = [];
        var i;
        var name;
        for (i = 0; i < list.length; i++) {
            name = String(list[i].name === null || list[i].name === undefined ? '' : list[i].name)
                .replace(/^\s+|\s+$/g, '');
            if (!PARAMETERS.hasOwnProperty(name)) {
                unknown.push('"' + name + '" (' + list[i].id + ')');
                continue;
            }
            rows[name] = rows[name] || [];
            rows[name].push({ id: String(list[i].id), value: list[i].value });
        }
        return { rows: rows, unknown: unknown };
    }

    /**
     * Pure (3.0): chooses, parses and validates every setting one script needs.
     *
     * For each key: a non-blank record value, else the script's parameter (when getParameter and the
     * column give it one), else the empty rule. The chosen value is parsed by the key's kind; an
     * invalid value goes to the empty rule as it always has, naming where it came from. A blank
     * record value falls back; an invalid one does not (the record is the setting once it is set).
     *
     * Messages about a parameter are word for word what 2.x logged.
     *
     * @param {Object} rows - groupSettingRows().rows; {} when there are none or the search failed
     * @param {function(string): *|null} getParameter - returns the raw value for a parameter ID
     * @param {string[]} keys - the keys the script needs (SCRIPT_KEYS)
     * @param {string|null} column - the script's PARAMETERS column, or null when it has no parameters
     * @returns {{config: Object, missing: string[], missingKeys: string[], notes: string[],
     *            sources: Object, duplicates: string[]}}
     *   config      keyed by logical key
     *   missing     what is empty (or invalid) where empty means throw: the parameter ID, or
     *               'setting KEY' when there is no parameter or the record's value was invalid
     *   missingKeys the keys of missing, in the same order
     *   notes       audit lines for defaults and 'none' values
     *   sources     key -> SOURCES value, in PARAMETERS order
     *   duplicates  'KEY (id, id)' for each needed key with two or more active rows
     */
    function resolveSettings(rows, getParameter, keys, column) {
        var config = {};
        var missing = [];
        var missingKeys = [];
        var notes = [];
        var sources = {};
        var duplicates = [];
        var deferred = [];
        var needed = {};
        var key;
        var def;
        var picked;
        var parsed;
        var i;

        for (i = 0; i < keys.length; i++) {
            needed[keys[i]] = true;
        }

        /** Where the value comes from, and its raw value. */
        function pick(key) {
            var def = PARAMETERS[key];
            var found = rows[key] || [];
            var id = column ? def.ids[column] : null;
            if (found.length === 1 && !isBlank(found[0].value)) {
                return { source: SOURCES.RECORD, label: 'setting ' + key, raw: found[0].value };
            }
            if (id && getParameter) {
                return { source: SOURCES.PARAMETER, label: id, raw: getParameter(id) };
            }
            return { source: SOURCES.PARAMETER, label: 'setting ' + key, raw: null };
        }

        /** Parses the picked value; the parsed result, or null when blank. */
        function parse(key, picked) {
            return isBlank(picked.raw) ? null : parseValue(PARAMETERS[key].kind, picked.raw);
        }

        for (key in PARAMETERS) {
            if (!PARAMETERS.hasOwnProperty(key) || !needed[key]) {
                continue;
            }
            if (rows[key] && rows[key].length > 1) {
                duplicates.push(key + ' (' + rows[key].map(function (r) { return r.id; }).join(', ') + ')');
            }
        }

        for (key in PARAMETERS) {
            if (!PARAMETERS.hasOwnProperty(key) || !needed[key]) {
                continue;
            }
            def = PARAMETERS[key];
            if (def.onlyInTestMode) {
                deferred.push(key);
                continue;
            }
            picked = pick(key);
            parsed = parse(key, picked);

            if (parsed && parsed.ok) {
                config[key] = parsed.value;
                sources[key] = picked.source;
                continue;
            }
            if (def.empty === 'throw') {
                missing.push(picked.label + (parsed ? ' (invalid value "' + String(picked.raw) + '")' : ''));
                missingKeys.push(key);
                sources[key] = SOURCES.MISSING;
            } else if (def.empty === 'default') {
                config[key] = def.defaultValue;
                notes.push(picked.label + (parsed ? ' is invalid ("' + String(picked.raw) + '")' : ' is empty') +
                    ': using the default ' + def.defaultValue);
                sources[key] = SOURCES.DEFAULT;
            } else {
                config[key] = emptyValue(def.kind);
                notes.push(picked.label + (parsed ? ' is invalid ("' + String(picked.raw) + '")' : ' is empty') +
                    ': treated as none');
                sources[key] = SOURCES.NONE;
            }
        }

        // Settings that only matter in one digest mode.
        for (i = 0; i < deferred.length; i++) {
            key = deferred[i];
            if (config.DIGEST_MODE !== DIGEST_MODES.TEST) {
                config[key] = emptyValue(PARAMETERS[key].kind);
                sources[key] = SOURCES.UNUSED;
                continue;
            }
            picked = pick(key);
            parsed = parse(key, picked);
            if (parsed && parsed.ok) {
                config[key] = parsed.value;
                sources[key] = picked.source;
            } else {
                missing.push(picked.label + (parsed ? ' (invalid value "' + String(picked.raw) + '")' : '') +
                    ' (required when the digest mode is TEST)');
                missingKeys.push(key);
                sources[key] = SOURCES.MISSING;
            }
        }

        return { config: config, missing: missing, missingKeys: missingKeys, notes: notes, sources: sources,
            duplicates: duplicates };
    }

    /**
     * Pure: reads and validates every parameter for one script column, with no settings record —
     * exactly what 2.x's load() read. Kept for the tests and as the no-record case of resolveSettings().
     *
     * @param {function(string): *} getParameter - returns the raw value for a parameter ID
     * @param {string} column - 'SL', 'MR' or 'SEND'
     * @returns {{config: Object, missing: string[], notes: string[]}}
     */
    function readParameters(getParameter, column) {
        var result = resolveSettings({}, getParameter, keysForColumn(column), column);
        return { config: result.config, missing: result.missing, notes: result.notes };
    }

    /**
     * Pure: parses a JSON object parameter. Never throws.
     * @returns {{status: string, value: Object|null, detail: string}} status 'empty' | 'ok' | 'invalid'
     */
    function parseJsonObject(raw) {
        var parsed;
        if (isBlank(raw)) {
            return { status: 'empty', value: null, detail: '' };
        }
        try {
            parsed = JSON.parse(String(raw));
        } catch (e) {
            return { status: 'invalid', value: null, detail: 'not JSON: ' + (e && e.message ? e.message : String(e)) };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { status: 'invalid', value: null, detail: 'not a JSON object' };
        }
        return { status: 'ok', value: parsed, detail: '' };
    }

    /**
     * Pure: the usable entries of an {"<id>": "<text>"} object — whole-number keys with non-empty
     * string values. Anything else is ignored, not an error.
     * @returns {Object|null} null when obj is not an object
     */
    function idTextMap(obj) {
        var map = {};
        var key;
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return null;
        }
        for (key in obj) {
            if (obj.hasOwnProperty(key) && /^\d+$/.test(key) && typeof obj[key] === 'string' && !isBlank(obj[key])) {
                map[key] = obj[key].replace(/^\s+|\s+$/g, '');
            }
        }
        return map;
    }

    /**
     * Pure: parses custscript_cdb_option_hints. Never throws.
     *
     *   {"vehicle": {"<id>": "<hint>", ...}, "unload": {"<id>": "<hint>", ...}}
     *
     * Either key may be missing, and any ID may be missing: that option shows its title only.
     * Entries whose key is not a whole number or whose value is not a non-empty string are
     * ignored. Anything that is not a JSON object with object-or-absent vehicle/unload is invalid.
     *
     * @param {string} raw
     * @returns {{status: string, hints: {vehicle: Object, unload: Object}, detail: string}}
     *   status 'empty' | 'ok' | 'invalid'
     */
    function parseOptionHints(raw) {
        var json = parseJsonObject(raw);
        var result = { status: json.status, hints: { vehicle: {}, unload: {} }, detail: json.detail };
        var groups = ['vehicle', 'unload'];
        var i;
        var map;

        if (json.status !== 'ok') {
            return result;
        }
        for (i = 0; i < groups.length; i++) {
            if (json.value[groups[i]] === undefined || json.value[groups[i]] === null) {
                continue;
            }
            map = idTextMap(json.value[groups[i]]);
            if (!map) {
                return { status: 'invalid', hints: { vehicle: {}, unload: {} },
                    detail: '"' + groups[i] + '" is not an object' };
            }
            result.hints[groups[i]] = map;
        }
        return result;
    }

    /**
     * Pure: parses custscript_cdb_quote_type_labels, {"<quote type id>": "UFH", ...}, with the same
     * rules as the option hints. Never throws. An unmapped type falls back to its own text.
     * @returns {{status: string, labels: Object, detail: string}}
     */
    function parseTypeLabels(raw) {
        var json = parseJsonObject(raw);
        return { status: json.status, labels: json.status === 'ok' ? idTextMap(json.value) : {},
            detail: json.detail };
    }

    /**
     * Pure (3.1): parses UPD_LOST_STATUS_MAP, {"CUSTOMER": "14", "PROSPECT": "35", "LEAD": "54"}. Never
     * throws. Keys are matched after trimming and upper-casing; only CUSTOMER_STAGES keys are kept. A
     * value must be a whole number (a string or a number); any other entry is ignored, so that stage has
     * no mapping. Anything that is not a JSON object is invalid (the caller logs it once and treats the
     * setting as empty).
     * @returns {{status: string, map: Object, detail: string}} status 'empty' | 'ok' | 'invalid'
     */
    function parseLostStatusMap(raw) {
        var json = parseJsonObject(raw);
        var map = {};
        var key;
        var stage;
        var value;
        if (json.status !== 'ok') {
            return { status: json.status, map: map, detail: json.detail };
        }
        for (key in json.value) {
            if (!json.value.hasOwnProperty(key)) {
                continue;
            }
            stage = String(key).replace(/^\s+|\s+$/g, '').toUpperCase();
            value = json.value[key];
            value = typeof value === 'number' || typeof value === 'string' ? String(value).replace(/^\s+|\s+$/g, '') : '';
            if (CUSTOMER_STAGES.indexOf(stage) >= 0 && /^\d+$/.test(value)) {
                map[stage] = String(parseInt(value, 10));
            }
        }
        return { status: 'ok', map: map, detail: '' };
    }

    /**
     * Pure: the error load() throws when a setting is missing.
     * @param {string[]} missing
     * @param {string[]} [keys] - the setting key of each entry (3.0), named in the message
     * @returns {Error}
     */
    function missingError(missing, keys) {
        var named = [];
        var error;
        var i;
        for (i = 0; i < missing.length; i++) {
            named.push(keys && keys[i] && missing[i].indexOf('setting ' + keys[i]) !== 0 ?
                missing[i] + ' [setting ' + keys[i] + ']' : missing[i]);
        }
        error = new Error('CDB_PARAMETER_MISSING: set these as Customer Dashboard Setting rows (' +
            SETTING_RECORD.TYPE + ', Name = the key) or as script parameters on the deployment: ' + named.join(', '));
        error.name = 'CDB_PARAMETER_MISSING';
        return error;
    }

    /**
     * Pure (3.0): the error load() throws for two active rows of one key.
     * @param {string[]} duplicates - 'KEY (id, id)'
     * @returns {Error}
     */
    function duplicateError(duplicates) {
        var error = new Error('CDB_SETTING_DUPLICATE: ' + duplicates.join('; ') + '. Each key must have exactly ' +
            'one active ' + SETTING_RECORD.TYPE + ' row: make all but one inactive.');
        error.name = 'CDB_SETTING_DUPLICATE';
        return error;
    }

    /**
     * Pure (3.0): the CDB SETTINGS_SOURCE details, 'KEY=source, ...' in PARAMETERS order.
     * @param {Object} sources - resolveSettings().sources
     * @returns {string}
     */
    function sourceLine(sources) {
        var parts = [];
        var key;
        for (key in sources) {
            if (sources.hasOwnProperty(key)) {
                parts.push(key + '=' + sources[key]);
            }
        }
        return parts.join(', ');
    }

    /**
     * 3.0: the settings rows, searched once per script execution and kept in module scope. A failed
     * search is kept too (as no rows), so it is neither retried nor logged twice.
     * @type {{rows: Object, unknown: string[], failed: string}|null}
     */
    var settingsCache = null;

    /** 3.0: what has been logged in this execution, so each line is logged once. */
    var logged = { unavailable: false, unknown: false, sources: false };

    /**
     * The active settings rows: one paged search of customrecord_cdb_setting (~10 units), cached.
     * Never throws: a failed search (no permission, the record type missing) gives no rows and
     * failed = the reason, and every key falls back to its parameter.
     * @returns {{rows: Object, unknown: string[], failed: string}}
     */
    function loadSettings() {
        var list = [];
        var grouped;
        var paged;
        var i;
        if (settingsCache) {
            return settingsCache;
        }
        try {
            paged = search.create({
                type: SETTING_RECORD.TYPE,
                filters: [['isinactive', 'is', 'F']],
                columns: [SETTING_RECORD.NAME, SETTING_RECORD.VALUE]
            }).runPaged({ pageSize: 1000 });
            for (i = 0; i < paged.pageRanges.length; i++) {
                paged.fetch({ index: paged.pageRanges[i].index }).data.forEach(function (r) {
                    list.push({ id: r.id, name: r.getValue({ name: SETTING_RECORD.NAME }),
                        value: r.getValue({ name: SETTING_RECORD.VALUE }) });
                });
            }
            grouped = groupSettingRows(list);
            settingsCache = { rows: grouped.rows, unknown: grouped.unknown, failed: '' };
        } catch (e) {
            settingsCache = { rows: {}, unknown: [], failed: e && e.message ? e.message : String(e) };
        }
        return settingsCache;
    }

    /**
     * Reads the executing script's configuration: each key it needs from the settings record, else
     * its parameter, else the empty rule (see the header).
     *
     * Logged once per execution and never in quiet mode: CDB SETTINGS_UNAVAILABLE, CDB SETTING_UNKNOWN
     * and CDB SETTINGS_SOURCE. The default/none notes, as before, every non-quiet load.
     *
     * @param {Object} log - N/log, for the audit notes
     * @param {boolean} [quiet] - skip the audit lines (the digest's map stage, per customer)
     * @returns {Object} config keyed by logical key
     * @throws {Error} CDB_UNKNOWN_SCRIPT when the executing script is not in SCRIPT_KEYS,
     *                 CDB_SETTING_DUPLICATE naming every key with two active rows, or
     *                 CDB_PARAMETER_MISSING naming every missing setting
     */
    function load(log, quiet) {
        var script = runtime.getCurrentScript();
        var keys = SCRIPT_KEYS[script.id];
        var column = PARAMETER_COLUMNS[script.id] || null;
        var settings;
        var result;
        var i;

        if (!keys) {
            throw new Error('CDB_UNKNOWN_SCRIPT: ' + script.id + ' is not a customer dashboard ' +
                'script. Add it and the settings it needs to SCRIPT_KEYS in cdb_lib_config.js.');
        }

        settings = loadSettings();
        if (!quiet && settings.failed && !logged.unavailable) {
            logged.unavailable = true;
            log.audit({ title: LOG_PREFIX + 'SETTINGS_UNAVAILABLE', details: 'The ' + SETTING_RECORD.TYPE +
                ' search failed, so every setting is read from the script parameters: ' + settings.failed });
        }
        if (!quiet && settings.unknown.length && !logged.unknown) {
            logged.unknown = true;
            log.audit({ title: LOG_PREFIX + 'SETTING_UNKNOWN', details: 'Ignored, not a setting key: ' +
                settings.unknown.join(', ') });
        }

        result = resolveSettings(settings.rows, column ? function (id) {
            return script.getParameter({ name: id });
        } : null, keys, column);

        if (result.duplicates.length) {
            log.error({ title: LOG_PREFIX + 'SETTING_DUPLICATE', details: result.duplicates.join('; ') });
            throw duplicateError(result.duplicates);
        }
        if (!quiet && !logged.sources) {
            logged.sources = true;
            log.audit({ title: LOG_PREFIX + 'SETTINGS_SOURCE', details: sourceLine(result.sources) });
        }
        if (result.missing.length) {
            log.error({ title: LOG_PREFIX + 'PARAMETER_MISSING', details: result.missing.map(function (m, j) {
                return m.indexOf('setting ') === 0 ? m : m + ' [setting ' + result.missingKeys[j] + ']';
            }).join(', ') });
            throw missingError(result.missing, result.missingKeys);
        }
        for (i = 0; !quiet && i < result.notes.length; i++) {
            log.audit({ title: LOG_PREFIX + 'PARAMETER_DEFAULT', details: result.notes[i] });
        }
        return result.config;
    }

    /**
     * @param {string} title - without the prefix
     * @returns {string}
     */
    function logTitle(title) {
        return LOG_PREFIX + title;
    }

    return {
        VERSION: VERSION,
        LOG_PREFIX: LOG_PREFIX,
        SCRIPTS: SCRIPTS,
        SECRET_ID: SECRET_ID,
        SETTING_RECORD: SETTING_RECORD,
        RECORD_TYPES: RECORD_TYPES,
        FIELDS: FIELDS,
        SHIPPABLE_STATUSES: SHIPPABLE_STATUSES,
        DELIVERED_STATUSES: DELIVERED_STATUSES,
        TEXT_LIMITS: TEXT_LIMITS,
        BOOKING_HORIZON_MONTHS: BOOKING_HORIZON_MONTHS,
        DIGEST_MODES: DIGEST_MODES,
        DELIVERY_GUIDANCE: DELIVERY_GUIDANCE,
        DELIVERY_LINK_EMAIL: DELIVERY_LINK_EMAIL,
        EMAIL_STANDARD: EMAIL_STANDARD,
        DIGEST_EMAIL: DIGEST_EMAIL,
        EMAIL_HERO_URL: EMAIL_HERO_URL,
        EMAIL_HERO_WIDTH: EMAIL_HERO_WIDTH,
        EMAIL_HERO_HEIGHT: EMAIL_HERO_HEIGHT,
        EMAIL_ICONS: EMAIL_ICONS,
        SEND_LINK_BANNERS: SEND_LINK_BANNERS,
        SEND_LINK_BANNER_SECONDS: SEND_LINK_BANNER_SECONDS,
        parseOptionHints: parseOptionHints,
        parseTypeLabels: parseTypeLabels,
        parseLostStatusMap: parseLostStatusMap,
        OPPLIB: OPPLIB,
        CUSTOMER_STAGES: CUSTOMER_STAGES,
        CALL_TIMES: CALL_TIMES,
        CALL_TIME_ORDER: CALL_TIME_ORDER,
        PARAMETERS: PARAMETERS,
        SCRIPT_KEYS: SCRIPT_KEYS,
        PARAMETER_COLUMNS: PARAMETER_COLUMNS,
        SOURCES: SOURCES,
        isBlank: isBlank,
        parseIdList: parseIdList,
        readParameters: readParameters,
        keysForColumn: keysForColumn,
        groupSettingRows: groupSettingRows,
        resolveSettings: resolveSettings,
        sourceLine: sourceLine,
        missingError: missingError,
        duplicateError: duplicateError,
        load: load,
        logTitle: logTitle
    };
});
