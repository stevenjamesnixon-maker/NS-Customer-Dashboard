/**
 * cdb_lib_config.js
 *
 * Every script ID, field ID and script parameter of the customer dashboard, and what an empty
 * parameter means. Both scripts read their configuration through load(); neither reads a
 * parameter directly.
 *
 * NO NUMERIC INTERNAL IDS. List values, statuses, employees and quote types all differ between
 * Sandbox and Production, so they come from script parameters. Script and field IDs are the same
 * in every account and are committed here. See docs/context.md section 3.
 *
 * PARAMETER IDS DIFFER BY SCRIPT. A script parameter is a custom field, and custom field IDs are
 * unique across the account, so the Map/Reduce cannot define a parameter with the Suitelet's ID.
 * (NS-Opportunity-SO-Sync tried it and NetSuite refused.) The Map/Reduce therefore carries twins
 * prefixed custscript_cdbmr_ that must hold the SAME value as their custscript_cdb_ original, and
 * (2.0) the internal Send delivery link Suitelet carries more prefixed custscript_cdbsend_.
 * PARAMETERS below names each, explicitly, per script: no derivation and no fallback, because a
 * fallback reads the wrong script's value and hides the misconfiguration. See docs/context.md
 * section 4.
 *
 * load() THROWS ONCE and names every missing parameter, so a half-configured deployment fails with
 * one clear message instead of a trail of confusing ones.
 *
 * The pure part, readParameters(), takes a getter and is node-tested.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 2.0.5
 */
define(['N/runtime'], function (runtime) {

    'use strict';

    var VERSION = '2.0.5';

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

    var RECORD_TYPES = {
        NON_DELIVERY: 'customrecord_cdb_nondelivery',
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
            VALUE_PROPOSITION: 'custbody_value_proposition'
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
        SPECIAL_REQUESTS: 1000
    };

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
     * Parameter kinds:
     *   idlist  comma list of whole numbers -> string[]
     *   id      one whole number (Integer, or a List/Record select) -> string
     *   int     whole number >= 0 -> number
     *   mode    TEST | LIVE
     *   https   an https URL
     *   text    free text
     *
     * empty:
     *   throw    missing -> named in the one error load() throws
     *   default  missing or invalid -> the default, logged at audit
     *   none     missing -> the empty value, logged at audit
     *
     * ids: the parameter's ID on each script. A key a script does not list is not available to
     * it, and asking for it is a programming error, not an empty parameter.
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
            ids: { MR: 'custscript_cdb_digest_cap' } }
    };

    /** Which PARAMETERS column each script reads. */
    var SCRIPT_KEYS = {};
    SCRIPT_KEYS[SCRIPTS.SUITELET] = 'SL';
    SCRIPT_KEYS[SCRIPTS.DIGEST] = 'MR';
    SCRIPT_KEYS[SCRIPTS.SEND_LINK] = 'SEND';

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
     * Pure: reads and validates every parameter for one script column.
     *
     * @param {function(string): *} getParameter - returns the raw value for a parameter ID
     * @param {string} column - 'SL', 'MR' or 'SEND'
     * @returns {{config: Object, missing: string[], notes: string[]}}
     *   config  keyed by logical key
     *   missing parameter IDs that are empty (or invalid) where empty means throw
     *   notes   audit lines for defaults and 'none' values
     */
    function readParameters(getParameter, column) {
        var config = {};
        var missing = [];
        var notes = [];
        var deferred = [];
        var key;
        var def;
        var id;
        var raw;
        var parsed;
        var i;

        for (key in PARAMETERS) {
            if (!PARAMETERS.hasOwnProperty(key)) {
                continue;
            }
            def = PARAMETERS[key];
            id = def.ids[column];
            if (!id) {
                continue;
            }
            if (def.onlyInTestMode) {
                deferred.push(key);
                continue;
            }
            raw = getParameter(id);
            parsed = isBlank(raw) ? null : parseValue(def.kind, raw);

            if (parsed && parsed.ok) {
                config[key] = parsed.value;
                continue;
            }
            if (def.empty === 'throw') {
                missing.push(id + (parsed ? ' (invalid value "' + String(raw) + '")' : ''));
            } else if (def.empty === 'default') {
                config[key] = def.defaultValue;
                notes.push(id + (parsed ? ' is invalid ("' + String(raw) + '")' : ' is empty') +
                    ': using the default ' + def.defaultValue);
            } else {
                config[key] = emptyValue(def.kind);
                notes.push(id + (parsed ? ' is invalid ("' + String(raw) + '")' : ' is empty') +
                    ': treated as none');
            }
        }

        // Parameters that only matter in one digest mode.
        for (i = 0; i < deferred.length; i++) {
            key = deferred[i];
            def = PARAMETERS[key];
            id = def.ids[column];
            if (config.DIGEST_MODE !== DIGEST_MODES.TEST) {
                config[key] = emptyValue(def.kind);
                continue;
            }
            raw = getParameter(id);
            parsed = isBlank(raw) ? null : parseValue(def.kind, raw);
            if (parsed && parsed.ok) {
                config[key] = parsed.value;
            } else {
                missing.push(id + (parsed ? ' (invalid value "' + String(raw) + '")' : '') +
                    ' (required when the digest mode is TEST)');
            }
        }

        return { config: config, missing: missing, notes: notes };
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
     * Pure: the error load() throws.
     * @param {string[]} missing
     * @returns {Error}
     */
    function missingError(missing) {
        var error = new Error('CDB_PARAMETER_MISSING: set these script parameters on the ' +
            'deployment: ' + missing.join(', '));
        error.name = 'CDB_PARAMETER_MISSING';
        return error;
    }

    /**
     * Reads the executing script's configuration.
     *
     * @param {Object} log - N/log, for the audit notes
     * @param {boolean} [quiet] - skip the default/none notes (the digest's map stage, per customer)
     * @returns {Object} config keyed by logical key
     * @throws {Error} CDB_PARAMETER_MISSING naming every missing parameter, or
     *                 CDB_UNKNOWN_SCRIPT when the executing script is not in SCRIPT_KEYS
     */
    function load(log, quiet) {
        var script = runtime.getCurrentScript();
        var column = SCRIPT_KEYS[script.id];
        var result;
        var i;

        if (!column) {
            throw new Error('CDB_UNKNOWN_SCRIPT: ' + script.id + ' is not a customer dashboard ' +
                'script. Add it to SCRIPT_KEYS and PARAMETERS in cdb_lib_config.js.');
        }

        result = readParameters(function (id) {
            return script.getParameter({ name: id });
        }, column);

        if (result.missing.length) {
            log.error({ title: LOG_PREFIX + 'PARAMETER_MISSING', details: result.missing.join(', ') });
            throw missingError(result.missing);
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
        PARAMETERS: PARAMETERS,
        isBlank: isBlank,
        parseIdList: parseIdList,
        readParameters: readParameters,
        missingError: missingError,
        load: load,
        logTitle: logTitle
    };
});
