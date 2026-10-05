/**
 * cdb_lib_render.js
 *
 * HTML strings: the page shell, the dashboard, the delivery form, the confirmations and the digest
 * email. Pure: no NetSuite module of its own (2.0.2: it reads constants from cdb_lib_config). Every value from a record, a parameter or a request goes
 * through esc(), exactly once.
 *
 * THE DESIGN SOURCE is docs/design/canvas/ (release 1.1): Main, Mobile, Delivery, ConfirmBacs,
 * ConfirmCard and Email. Update is built in 2.1 (below); Order is not built yet. Anything the canvas
 * shows that 1.1 has no data or action for is left out — never a button that goes nowhere.
 *
 * PAGES are fluid: the dashboard is centred at max-width 1200px, the delivery form at 1120px, the
 * confirmations at 600px. Below 720px the dashboard grid stacks as the Mobile artboard; below
 * 900px the delivery summary moves under the form. The font is Source Sans 3 from Google Fonts on
 * the PAGES ONLY, falling back to Calibri. The logo URL (a parameter) is the only other external
 * resource.
 *
 * THE CALENDAR works without script: every month renders, stacked, and every allowed day is a real
 * radio input styled as a day button. A little inline script (ES5) shows one month at a time with
 * prev/next, and mirrors the choices into the summary aside. Without it, the aside shows static
 * text and the form still submits.
 *
 * THE EMAILS (2.0.2) follow ONE STANDARD, Send Quote 2.2.0's email card (2026.03-Online-quote,
 * commit 4463cfa, lib 1.1.0): emailShell, emailRepCard, emailButton and the green footer with the
 * five social links. Tables and HTML attributes carry the layout, so an email stays centred and
 * single-column with every style removed (Online-quote AI_AGENT_CONTEXT §9 pitfall 25). Calibri/Arial
 * with no web font, no flex or grid, no display:none outside the preheader and the phone media query,
 * and each button one [if !mso] / [if mso] pair. digestEmail() and deliveryLinkEmail() are built
 * from these blocks.
 *
 * "TELL US WHERE YOU'RE UP TO" (2.1, release 2.1 part B; the customer sees it as "Give us an update" from
 * 2.1.2) follows docs/design/canvas/Update.dc.html
 * and the outline button on Main: updatePage(), updateDone(), lostDone() and unavailablePage(). The
 * page needs no script: the call fields show with a CSS sibling rule when the box is ticked, and the
 * not-going-ahead panel is a closed <details> holding its own form — opening it is one step, its confirm
 * button the second, and the main form never carries the confirm value.
 *
 * RELEASE 2.2: the update page asks first "What do you call this project?" (the opportunity title,
 * prefilled, maxlength 60); the delivery form's address list ends with "Add a new address…", whose five
 * inputs (ids and names addr1, addr2, city, county, zip, with standard autocomplete tokens, so an address
 * lookup can fill them later) show only when it is chosen — and, without script, always, with a hint;
 * the confirmation says a new address is checked first; the digest explains itself, shows the QR number
 * once, and gives quote cards the dashboard's labelled lines.
 *
 * 2.2.1 (PR #8 amendment 1): the first question becomes "Your project details" — "Your reference" (the title)
 * and "Site address" side by side (.g2: stacked on a phone), the site address only when the Suitelet offers
 * it. The delivery form pre-selects the default time (the Suitelet's values.time), says the time is a
 * guide (DELIVERY_TEXT.TIME_NOTE), and shows an unloading option's surcharge under its card, in the hint's
 * place, so it shows without script; the confirmation says the surcharge will be added to the balance.
 *
 * 2.2.2 (PR #8 amendment 2): both "Your project details" inputs always show (showSiteAddress is gone). A
 * ready-to-book order's current forecast date — plannedDate(): the ORDER's custbody_defaultshipdate
 * (order.shipDateKey), today or later, never the opportunity's date — shows on its dashboard row, under
 * the delivery form's heading lines, and as the delivery-link email's "Currently planned" row. The digest
 * is unchanged.
 *
 * 2.3.0 (release 2.3, "Tell us about your property"): designInfoPage() — one multipart form, a card per section
 * with its own Save button, "? Why" toggles (<details>, no script), file inputs with a small size warning (the
 * server checks too), the progress aside, view mode — designInfoMessagePage(); the four design card states on the
 * dashboard (designRow()) and in the digest (projectCard(), digestRows()), used only when the row carries d.design
 * (cdb_lib_data.decorateDesign()), otherwise exactly as before; the request email designInfoRequestEmail(). The
 * canvas mocks are not in the repo yet (amendment 1 §6): built from the brief's descriptions, with the update page
 * and the delivery-link email as the visual reference. emailRepCard() takes an optional role label ("YOUR PROJECT
 * ENGINEER"); headerRight() a 'design' kind ("Design questions? Call …").
 *
 * 2.4.0 (release 2.3b, the stepper): designInfoPage() is replaced by designInfoStep() — one registry section per
 * screen, a step bar (submits that save, by form="diform"; links on Review), the step's intro and minutes, the questions
 * grouped by panel, Back (saves first) / Save and continue / Save and exit (header) — and designInfoReview() — every
 * answer by step with Edit links, the steps still to do, Send. The file control: the files already sent, one input, "+
 * Add another file" (a submit; with script, the next hidden input), "Take a photo" on a phone. The registry's
 * placeholder goes in the box. Phone layout: max-width 600px, CSS only. page() takes headerExtra (empty elsewhere).
 *
 * 2.4.1 (2.3b amendment 1): Review's header link reads "Back to your projects" (STEP_TEXT.EXIT_REVIEW): Review has
 * nothing to save. The step pages keep Save and exit.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 2.4.1
 */
define(['./cdb_lib_dates', './cdb_lib_config'], function (dates, config) {

    'use strict';

    var VERSION = '2.4.1';

    /** The canvas tokens, exactly. */
    var COLORS = {
        PAGE: '#f4f2ef',
        CARD: '#ffffff',
        BORDER: '#e2ded9',
        TEXT: '#2b2a2e',
        MUTED: '#5f5b66',
        PURPLE: '#59315f',
        PURPLE_HOVER: '#3d1f42',
        CTA: '#ffb500',
        CTA_HOVER: '#f0a800',
        CTA_TEXT: '#2b2a2e',
        TIP: '#f4f1f4',
        ERROR: '#a3261b'
    };

    var FONT = "'Source Sans 3', Calibri, sans-serif";
    var EMAIL_FONT = 'Calibri, Arial, sans-serif';

    var FONT_LINKS = '<link rel="preconnect" href="https://fonts.googleapis.com">' +
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&amp;display=swap">';

    /** Badge colours: bg / fg. */
    var BADGES = {
        ready: { bg: '#e6f2ec', fg: '#1f5c3f' },
        need: { bg: '#fdf0d8', fg: '#6e4400' },
        pay: { bg: '#e3edf7', fg: '#1d4f7a' },
        work: { bg: '#efe9f1', fg: '#3d1f42' },
        quote: { bg: '#ecebe9', fg: '#4a4650' }
    };

    var INVALID_LINK_TEXT = 'This link is no longer valid. Please contact your account manager';

    var NOTHING_NEEDED = 'Nothing needed from you';
    var AM_IN_TOUCH = 'Your account manager will be in touch';

    var PHONE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#59315f" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 ' +
        '2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 ' +
        '6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"></path></svg>';

    var MAIL_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#59315f" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<rect x="3" y="5" width="18" height="14" rx="2"></rect><polyline points="3 7 12 13 21 7"></polyline></svg>';

    var TICK_ICON = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1f5c3f" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<polyline points="20 6 9 17 4 12"></polyline></svg>';

    // ---------------------------------------------------------------- text

    /**
     * @param {*} value
     * @returns {string} HTML-escaped text
     */
    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }


    /**
     * An order's main line: its quote description (already cleaned by cdb_lib_data), else its
     * short type label (UFH, HP — 1.2, from custscript_cdb_quote_type_labels), else its quote
     * type's text, else "Your order". The one definition: the pages, the email and the Suitelet's
     * Task title all use it. Shown IN FULL: no clamp (1.2).
     * @param {Object} order
     * @returns {string} plain text, not escaped
     */
    function orderTitle(order) {
        return (order && (order.description || order.typeLabel || order.quoteTypeText)) || 'Your order';
    }

    /** The short type label, else the quote type's text. */
    function typeLabelOf(order) {
        return order.typeLabel || order.quoteTypeText || '';
    }

    /**
     * "Order SO239737 · UFH" — the muted line under an order. The label is left out when the main
     * line already fell back to it, so it never shows twice.
     */
    function orderMeta(order) {
        var label = typeLabelOf(order);
        return 'Order ' + order.tranId + (label && order.description ? ' \u00b7 ' + label : '');
    }

    /**
     * An order's lines for the pages: the description in full, the split reference when set
     * (medium weight, text colour: it says what this part of a split order contains), and the
     * muted "Order SO… · UFH".
     */
    function orderLines(order) {
        return '<span class="soname">' + esc(orderTitle(order)) + '</span>' +
            (order.uniqueRef ? '<span class="soref">' + esc(order.uniqueRef) + '</span>' : '') +
            '<span class="meta">' + esc(orderMeta(order)) + '</span>';
    }

    /**
     * Pure: "£1,234.50" — pound sign, thousands commas, two decimals.
     * @param {number} amount
     * @returns {string}
     */
    function formatMoney(amount) {
        var fixed = (Math.round(Number(amount) * 100) / 100).toFixed(2);
        var parts = fixed.split('.');
        return '\u00a3' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
    }

    var NOTHING_TO_PAY = 'Nothing left to pay on this order';

    /**
     * Pure (2.0.5): THE ONE amount text, used everywhere an amount shows — the dashboard's payment panel,
     * the delivery form and its aside, the BACS and card confirmations, the delivery-link email and the
     * Task. '' when there is none to show (unknown); "Nothing left to pay on this order" at 0; else
     * "£1,234.50 inc VAT", followed by " (£1,028.75 ex VAT)" when the ex-VAT balance is known.
     * @param {{incVat: number, exVat: (number|null)}|null} amount - from data.amountToPay()
     */
    function amountText(amount) {
        if (!amount || typeof amount.incVat !== 'number') {
            return '';
        }
        if (amount.incVat === 0) {
            return NOTHING_TO_PAY;
        }
        return formatMoney(amount.incVat) + ' inc VAT' +
            (typeof amount.exVat === 'number' ? ' (' + formatMoney(amount.exVat) + ' ex VAT)' : '');
    }

    /** A phone number as a tel: href value. */
    function telHref(phone) {
        return 'tel:' + String(phone || '').replace(/[^0-9+]/g, '');
    }

    /**
     * Every customer-facing date (1.3.2): "Fri 30 Oct" this year, "Fri 16 Apr 2027" otherwise, via
     * dates.formatDisplay() against today in Europe/London. '' for a blank or invalid key.
     */
    function shortDate(key) {
        return dates.formatDisplay(key, dates.londonTodayKey(Date.now()));
    }

    /**
     * Pure (2.2.2): a ready-to-book order's current forecast date, as shortDate() shows it — the ORDER's
     * custbody_defaultshipdate (order.shipDateKey, read by the main order search), never the opportunity's
     * date — when it is today or later in Europe/London. '' for a blank, invalid or past date. The caller
     * decides the order is ready to book (the dashboard's row state; the guard, for the form and the email).
     */
    function plannedDate(order) {
        var key = String((order && order.shipDateKey) || '');
        return key && key >= dates.londonTodayKey(Date.now()) ? shortDate(key) : '';
    }

    /** 2.2.2: the forecast date's wording. Plain text: escaped when used. */
    var PLANNED_TEXT = {
        ROW: 'Currently planned for {date}. Choose your date to confirm.',
        FORM: 'We currently have this pencilled in for {date}. Choose the date that suits you below.'
    };

    // ---------------------------------------------------------------- page CSS

    /**
     * The pages' stylesheet. Exported so the tests can assert the responsive rules exist.
     * @returns {string}
     */
    function css() {
        var c = COLORS;
        return [
            '*,*::before,*::after{box-sizing:border-box}',
            'html{-webkit-text-size-adjust:100%}',
            'body{margin:0;font-family:' + FONT + ';background:' + c.PAGE + ';color:' + c.TEXT +
                ';font-size:16px;line-height:1.45;overflow-wrap:break-word}',
            'a{color:' + c.PURPLE + '}a:hover{color:' + c.PURPLE_HOVER + '}',
            '.wrap{width:100%;margin:0 auto;padding:0 24px}',
            '.w1200{max-width:1248px}.w1120{max-width:1168px}.w600{max-width:648px}',
            // header
            'header.top{background:#fff;border-bottom:1px solid ' + c.BORDER + '}',
            'header.top .wrap{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:16px}',
            '.logo img{display:block;max-height:48px;max-width:180px;height:auto}',
            '.brand{font-weight:700;font-size:24px;color:' + c.PURPLE + '}',
            '.am{display:flex;flex-direction:column;text-align:right}',
            '.am-label{font-size:13px;color:' + c.MUTED + '}',
            '.am-name{font-size:15px;font-weight:600}',
            '.hq{font-size:15px;color:#4a4650;text-align:right}',
            '.am-call{display:none;width:44px;height:44px;border:1px solid ' + c.PURPLE +
                ';border-radius:22px;align-items:center;justify-content:center;flex-shrink:0}',
            // main
            'main.wrap{display:flex;flex-direction:column;gap:28px;padding-top:32px;padding-bottom:40px}',
            'h1{margin:0;font-size:32px;font-weight:700;line-height:1.2}',
            '.lead{margin:6px 0 0;font-size:17px;color:#4a4650}',
            '.notice{background:#fdf0d8;color:#6e4400;border-radius:8px;padding:12px 16px;font-size:16px}',
            '.muted,.meta{color:' + c.MUTED + '}',
            '.meta{font-size:14px}',
            // sections
            '.sec{background:#fff;border:1px solid ' + c.BORDER + ';border-radius:10px;overflow:hidden}',
            '.sechead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:18px 24px;background:' +
                c.PURPLE + ';color:#fff}',
            '.sechead h2{margin:0;font-size:20px;font-weight:700}',
            '.count{font-size:14px;font-weight:700;background:#fff;color:' + c.PURPLE + ';border-radius:11px;padding:1px 9px}',
            '.secsub{font-size:15px;color:#e7d9ea}',
            '.colhead,.row,.oprow,.sorow{display:grid;grid-template-columns:minmax(0,1fr) 280px 400px;gap:20px;align-items:center}',
            '.colhead{padding:10px 24px;background:#f7f5f3;border-bottom:1px solid ' + c.BORDER +
                ';font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:' + c.MUTED + '}',
            '.colhead span:last-child{text-align:right}',
            '.row{padding:16px 24px;border-bottom:1px solid #ece8e3}',
            '.row:last-child{border-bottom:0}',
            '.oprow{padding:16px 24px 10px}',
            '.oprow:not(:first-of-type){border-top:1px solid #ece8e3}',
            '.sorow{padding:12px 24px 12px 56px;background:#faf9f7;border-top:1px solid #efece8}',
            '.cell{display:flex;flex-direction:column;gap:3px;min-width:0}',
            '.name{font-size:17px;font-weight:700}',
            '.soname{font-size:16px;font-weight:600}',
            '.soref{font-size:15px;font-weight:600;color:' + c.TEXT + '}',
            '.amt{font-size:16px}',
            '.badge{display:inline-flex;align-self:flex-start;align-items:center;padding:3px 12px;border-radius:12px;font-size:13px;font-weight:600}',
            '.b-ready{background:' + BADGES.ready.bg + ';color:' + BADGES.ready.fg + '}',
            '.b-need{background:' + BADGES.need.bg + ';color:' + BADGES.need.fg + '}',
            '.b-pay{background:' + BADGES.pay.bg + ';color:' + BADGES.pay.fg + '}',
            '.b-work{background:' + BADGES.work.bg + ';color:' + BADGES.work.fg + '}',
            '.b-quote{background:' + BADGES.quote.bg + ';color:' + BADGES.quote.fg + '}',
            '.acts{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:10px;min-width:0}',
            '.acts .meta{text-align:right}',
            '.cta,.out{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:6px;' +
                'font:inherit;font-size:15px;font-weight:700;text-decoration:none;cursor:pointer;text-align:center}',
            '.cta{background:' + c.CTA + ';color:' + c.CTA_TEXT + ';border:0}',
            '.cta:hover,.cta:focus{background:' + c.CTA_HOVER + ';color:' + c.CTA_TEXT + '}',
            '.out{background:#fff;color:' + c.PURPLE + ';border:1px solid ' + c.PURPLE + ';font-weight:600;padding:0 16px}',
            '.out:hover{color:' + c.PURPLE_HOVER + ';border-color:' + c.PURPLE_HOVER + '}',
            ':focus-visible{outline:3px solid ' + c.CTA + ';outline-offset:2px}',
            'details.paydet{width:100%;display:flex;flex-direction:column;align-items:flex-end}',
            'details.paydet summary{list-style:none}',
            'details.paydet summary::-webkit-details-marker{display:none}',
            'details.paydet[open] summary{margin-bottom:8px}',
            '.panel{width:100%;background:' + c.PAGE + ';border-radius:8px;padding:12px 14px;font-size:15px;text-align:left}',
            '.srow{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #ece8e3}',
            '.srow:last-child{border-bottom:0}',
            '.srow > span:first-child{color:' + c.MUTED + '}',
            '.srow > span:last-child{font-weight:600;text-align:right}',
            '.ref{background:#fffaf0;border-radius:6px;padding:10px 12px;margin:4px -12px}',
            '.ref > span:last-child{font-size:18px;font-weight:700}',
            'footer.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 24px;font-size:14px;color:' + c.MUTED + '}',
            // form
            '.layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}',
            '.fcol{display:flex;flex-direction:column;gap:20px;min-width:0}',
            '.card{background:#fff;border:1px solid ' + c.BORDER + ';border-radius:10px;padding:24px;display:flex;flex-direction:column;gap:16px;min-width:0}',
            '.card h2{margin:0;font-size:21px;font-weight:700}',
            '.num{color:' + c.PURPLE + ';margin-right:8px}',
            'fieldset{border:0;margin:0;padding:0;min-width:0}',
            'legend,.lbl{display:block;font-size:14px;font-weight:600;color:#3e3b39;margin:0 0 6px;padding:0}',
            '.hint{font-size:14px;color:' + c.MUTED + '}',
            '.inp{width:100%;min-height:44px;padding:0 12px;border:1px solid #8f8996;border-radius:6px;background:#fff;' +
                'font:inherit;font-size:16px;color:' + c.TEXT + '}',
            'textarea.inp{min-height:104px;padding:10px 12px;resize:vertical}',
            '.err{color:' + c.ERROR + ';font-weight:600;font-size:15px;margin:0 0 6px}',
            '.g2,.g3{display:grid;gap:16px}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}',
            '.sr{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}',
            // calendar
            '.calnav{display:none;align-items:center;justify-content:space-between;gap:12px}',
            '.js .calnav{display:flex}',
            '.navbtn{width:44px;height:44px;border:1px solid #c9c4cf;border-radius:6px;background:#fff;cursor:pointer;' +
                'display:flex;align-items:center;justify-content:center;font:inherit;font-size:20px;color:' + c.TEXT + '}',
            '.navbtn:disabled{opacity:0.4;cursor:default}',
            '.caltitle{font-size:18px;font-weight:700}',
            '.months{display:flex;flex-direction:column;gap:24px}',
            '.js .month{display:none}.js .month.on{display:block}',
            '.month h3{margin:0 0 8px;font-size:18px;font-weight:700}',
            '.js .month h3{display:none}',
            '.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}',
            '.wd{font-size:13px;font-weight:600;color:' + c.MUTED + ';text-align:center;padding:6px 0}',
            '.day{position:relative;display:block;margin:0}',
            '.day .d{display:flex;align-items:center;justify-content:center;height:48px;border-radius:6px;border:1px solid #d9d4ce;' +
                'background:#fff;font-size:16px;color:' + c.TEXT + ';cursor:pointer}',
            '.day input:checked + .d{background:' + c.PURPLE + ';border-color:' + c.PURPLE + ';color:#fff;font-weight:700}',
            '.day input:focus-visible + .d{outline:3px solid ' + c.CTA + ';outline-offset:2px}',
            '.day-off .d{background:#f1efec;border-color:#f1efec;color:#a8a2ad;cursor:not-allowed}',
            // segmented time
            '.segs{display:flex;flex-wrap:wrap}',
            '.seg{position:relative;flex:1 1 auto;margin:0}',
            '.seg .s{display:flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border:1px solid #8f8996;' +
                'margin-left:-1px;background:#fff;font-size:15px;color:#3e3b39;cursor:pointer;white-space:nowrap}',
            '.seg:first-child .s{margin-left:0;border-radius:6px 0 0 6px}',
            '.seg:last-child .s{border-radius:0 6px 6px 0}',
            '.seg input:checked + .s{background:' + c.PURPLE + ';border-color:' + c.PURPLE + ';color:#fff;font-weight:600;position:relative}',
            '.seg input:focus-visible + .s{outline:3px solid ' + c.CTA + ';outline-offset:2px}',
            // option and pay cards
            '.opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}',
            '.optc,.pay{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border:1px solid #c9c4cf;border-radius:8px;cursor:pointer;background:#fff;margin:0}',
            '.pay{padding:18px;gap:14px}',
            '.optc input,.pay input{width:20px;height:20px;margin:2px 0 0;flex-shrink:0;accent-color:' + c.PURPLE + '}',
            '.optc:has(input:checked),.pay:has(input:checked){border:2px solid ' + c.PURPLE + ';background:#faf7fb}',
            '.ot{display:block;font-size:16px;font-weight:700}',
            '.oh{display:block;font-size:14px;color:#4a4650;line-height:1.4;margin-top:4px}',
            '.tip{font-size:15px;color:#3e3b39;background:' + c.TIP + ';border-radius:8px;padding:12px 14px}',
            '.tip p{margin:0}.tip p + p{margin-top:8px}',
            '.submitrow{display:flex;flex-wrap:wrap;align-items:center;gap:20px}',
            '.submitrow .cta{min-height:52px;padding:0 28px;font-size:17px}',
            'aside.card{position:sticky;top:24px;gap:12px}',
            'aside h2{font-size:18px}',
            'aside h3{margin:8px 0 0;font-size:16px;font-weight:700}',
            'ol.next{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px;font-size:15px;color:#3e3b39;line-height:1.4}',
            // confirmations
            '.done{align-items:center;text-align:center;padding:32px;gap:14px}',
            '.done h1{font-size:28px}',
            '.done p{margin:0;font-size:17px;color:#3e3b39;line-height:1.5}',
            '.tick{width:64px;height:64px;border-radius:32px;background:' + BADGES.ready.bg + ';display:flex;align-items:center;justify-content:center}',
            '.bank{border:2px solid ' + c.PURPLE + ';padding:24px 28px;gap:4px}',
            '.bank h2{margin-bottom:8px}',
            '.amcard{flex-direction:row;align-items:center;gap:20px}',
            '.cap{font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:' + c.MUTED + ';font-weight:600}',
            '.amn{font-size:22px;font-weight:700}',
            '.back{align-self:center;font-size:16px}',
            // 2.1: tell us where you're up to
            '.q-help{margin:0;font-size:15px;color:#4a4650;line-height:1.45}',
            // 2.1.2: the labelled facts under Quote sent; each its own line, wrapping on a phone.
            '.fact{display:block;min-width:0;overflow-wrap:anywhere}',
            '.fv{font-weight:600;color:' + c.TEXT + '}',
            '.cbxrow{display:flex;flex-wrap:wrap;align-items:center;gap:10px}',
            '.cbxrow > input{width:20px;height:20px;margin:0;accent-color:' + c.PURPLE + '}',
            '.chk{font-size:16px;font-weight:600;cursor:pointer}',
            '.callfields{display:none;flex-basis:100%;gap:16px;margin-top:6px}',
            '#f-call:checked ~ .callfields{display:grid}',
            'details.ngp{gap:0}',
            'details.ngp[open]{gap:16px}',
            'details.ngp > summary{cursor:pointer;list-style:none;color:' + c.PURPLE + ';font-size:16px;font-weight:600;' +
                'text-decoration:underline}',
            'details.ngp > summary::-webkit-details-marker{display:none}',
            'details.ngp form{display:flex;flex-direction:column;gap:16px;margin-top:16px}',
            '.warnbtn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;' +
                'border-radius:6px;background:#fff;color:' + c.ERROR + ';border:2px solid ' + c.ERROR + ';font:inherit;' +
                'font-size:16px;font-weight:700;cursor:pointer}',
            '.warnbtn:hover,.warnbtn:focus{background:#fbeceb}',
            '.saved{margin:0;padding-left:20px;text-align:left;display:flex;flex-direction:column;gap:6px;font-size:16px}',
            'aside .goes{display:flex;flex-direction:column}',
            // tablet: the delivery summary moves under the form
            '@media (max-width:899px){' +
                '.layout{grid-template-columns:minmax(0,1fr)}' +
                'aside.card{position:static}' +
                '}',
            // phone: the Mobile artboard
            '@media (max-width:719px){' +
                '.wrap{padding:0 16px}' +
                'header.top .wrap{min-height:64px}' +
                '.logo img{max-height:40px;max-width:140px}' +
                '.am,.hq{display:none}' +
                '.am-call{display:flex}' +
                'main.wrap{gap:18px;padding-top:20px;padding-bottom:28px}' +
                'h1{font-size:26px}' +
                '.lead{font-size:16px}' +
                '.sechead{padding:14px 16px}' +
                '.sechead h2{font-size:18px}' +
                '.secsub{flex-basis:100%}' +
                '.colhead{display:none}' +
                '.row,.oprow,.sorow{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:14px 16px}' +
                '.sorow{padding-left:28px}' +
                '.acts{flex-direction:column;align-items:stretch;justify-content:flex-start}' +
                '.acts .meta{text-align:left}' +
                '.cta,.out{display:flex;width:100%;min-height:48px;font-size:16px}' +
                'details.paydet{align-items:stretch}' +
                '.card{padding:18px 16px}' +
                '.g2,.g3{grid-template-columns:minmax(0,1fr)}' +
                '.cal{gap:4px}' +
                '.seg{flex:1 1 30%}' +
                '.seg .s{padding:0 8px}' +
                '.submitrow .cta{width:100%}' +
                '.warnbtn{width:100%}' +
                '.amcard{flex-direction:column;align-items:flex-start}' +
                '.done{padding:24px 16px}' +
                '}'
        ].join('\n');
    }

    // ---------------------------------------------------------------- page shell

    function logoHtml(logoUrl) {
        return '<span class="logo">' + (logoUrl ?
            '<img src="' + esc(logoUrl) + '" alt="Nu-Heat">' : '<span class="brand">Nu-Heat</span>') + '</span>';
    }

    /** The round button the phone layout shows: call with a phone, email without one, else nothing. */
    function callButton(am) {
        var c = contactParts(am);
        if (c.kind === 'phone') {
            return '<a class="am-call" href="' + esc(c.href) + '" aria-label="Call your account manager' +
                (am.name ? ', ' + esc(am.name) : '') + '">' + PHONE_ICON + '</a>';
        }
        // Amendment 2: no phone, so the round button on phones emails instead.
        if (c.kind === 'email') {
            return '<a class="am-call" href="' + esc(c.href) + '" aria-label="Email your account manager' +
                (am.name ? ', ' + esc(am.name) : '') + '">' + MAIL_ICON + '</a>';
        }
        return '';
    }

    /**
     * Pure: how to reach the account manager (amendment 2). Phone first, then email, then nothing.
     * @param {Object} am - { name, phone, email }
     * @returns {{kind: string, text: string, href: string}} kind 'phone' | 'email' | 'none'
     */
    function contactParts(am) {
        if (am && am.phone) {
            return { kind: 'phone', text: am.phone, href: telHref(am.phone) };
        }
        if (am && am.email) {
            return { kind: 'email', text: am.email, href: 'mailto:' + am.email };
        }
        return { kind: 'none', text: '', href: '' };
    }

    /**
     * Pure: the "Questions?" line (amendment 2), escaped HTML, or '' with no name.
     *   phone   "Questions? Call {name} on {phone}"   (tel: link)
     *   email   "Questions? Email {name} at {email}"  (mailto: link)
     *   neither "Questions? Contact {name}"
     */
    function questionsLine(am) {
        var c = contactParts(am);
        var link;
        if (!am || !am.name) {
            return '';
        }
        link = '<a href="' + esc(c.href) + '">' + esc(c.text) + '</a>';
        if (c.kind === 'phone') {
            return 'Questions? Call ' + esc(am.name) + ' on ' + link;
        }
        if (c.kind === 'email') {
            return 'Questions? Email ' + esc(am.name) + ' at ' + link;
        }
        return 'Questions? Contact ' + esc(am.name);
    }

    /**
     * The header right-hand side.
     *   'am'        "Your account manager" over "name · phone" (Main)
     *   'questions' "Questions? Call [name] on [phone]" (Delivery)
     *   'none'      logo only (the confirmations)
     */
    function headerRight(kind, am) {
        var c;
        if (kind === 'none' || !am || !am.name) {
            return '';
        }
        if (kind === 'questions') {
            return '<span class="hq">' + questionsLine(am) + '</span>' + callButton(am);
        }
        // 2.3: the design information page — "Design questions? Call [PE or AM] on [phone]".
        if (kind === 'design') {
            return '<span class="hq">' + designQuestionsLine(am) + '</span>' + callButton(am);
        }
        // Amendment 2: name · phone, else name · email, else the name alone.
        c = contactParts(am);
        return '<div class="am"><span class="am-label">Your account manager</span><span class="am-name">' +
            esc(am.name) + (c.kind !== 'none' ? ' · <a href="' + esc(c.href) + '">' + esc(c.text) + '</a>' : '') +
            '</span></div>' + callButton(am);
    }

    /**
     * The whole page.
     * @param {Object} opts - { title, logoUrl, am, header ('am'|'questions'|'none'), width
     *                          ('w1200'|'w1120'|'w600'), body, script, css (2.2: rules for this page only,
     *                          after the shared ones, so every other page stays byte-identical) }
     */
    function page(opts) {
        var width = opts.width || 'w1200';
        return '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<meta name="robots" content="noindex, nofollow">' +
            '<meta name="referrer" content="no-referrer">' +
            '<title>' + esc(opts.title || 'Your projects') + ' | Nu-Heat</title>' +
            FONT_LINKS +
            '<style>' + css() + (opts.css || '') + '</style>' +
            (opts.script ? '<script>document.documentElement.className+=" js";</script>' : '') +
            '</head><body>' +
            '<header class="top"><div class="wrap ' + width + '">' + logoHtml(opts.logoUrl) +
            headerRight(opts.header || 'am', opts.am) + (opts.headerExtra || '') + '</div></header>' +
            '<main class="wrap ' + width + '">' + opts.body + '</main>' +
            (opts.script ? '<script>' + opts.script + '</script>' : '') +
            '</body></html>';
    }

    /** The one page every link failure shows. No detail, ever. */
    function invalidPage(logoUrl) {
        return page({
            title: 'Link not valid', logoUrl: logoUrl, header: 'none', width: 'w600',
            body: '<div class="card"><p style="margin:0">' + esc(INVALID_LINK_TEXT) + '.</p></div>'
        });
    }

    /** A failure that is ours, not the link's. */
    function errorPage(logoUrl) {
        return page({
            title: 'Something went wrong', logoUrl: logoUrl, header: 'none', width: 'w600',
            body: '<div class="card"><p style="margin:0">Sorry, something went wrong on our side. Please try ' +
                'again later, or contact your account manager.</p></div>'
        });
    }

    // ---------------------------------------------------------------- dashboard (Main, Mobile)

    function badge(kind, text) {
        return '<span class="badge b-' + kind + '">' + esc(text) + '</span>';
    }

    /**
     * The bank rows, reference highlighted, and (1.2) the amount to pay when there is one to show.
     * @param {string} [amountShown] - from amountText(); '' leaves the row out
     */
    function bankRows(bank, reference, amountShown) {
        return '<div class="srow"><span>Bank name</span><span>' + esc(bank.name) + '</span></div>' +
            '<div class="srow"><span>Sort code</span><span>' + esc(bank.sort) + '</span></div>' +
            '<div class="srow"><span>Account number</span><span>' + esc(bank.account) + '</span></div>' +
            '<div class="srow ref"><span>Reference</span><span>' + esc(reference) + '</span></div>' +
            (amountShown ? '<div class="srow"><span>Amount to pay</span><span>' + esc(amountShown) + '</span></div>' : '');
    }

    /**
     * Neutral card wording (amendment 1): it names nobody, because whoever gets the Task makes the
     * call. "We'll call you to take £x. We never ask for card details online."; with no amount,
     * "We'll call you to take payment."; at 0, "Nothing left to pay on this order."
     */
    function cardPaymentText(amountShown) {
        if (amountShown === NOTHING_TO_PAY) {
            return esc(NOTHING_TO_PAY) + '. We\u2019ll be in touch to confirm your delivery.';
        }
        if (amountShown) {
            return 'We\u2019ll call you to take <strong>' + esc(amountShown) + '</strong>. We never ask for card details online.';
        }
        return 'We\u2019ll call you to take payment.';
    }

    /** The number of orders in a delivery-style section (1.3.2: the pill counts orders). */
    function countOrders(projects) {
        var n = 0;
        var i;
        for (i = 0; i < (projects || []).length; i++) {
            n += projects[i].orders.length;
        }
        return n;
    }

    function sectionHead(title, count, sub) {
        return '<div class="sechead"><h2>' + esc(title) + '</h2><span class="count">' + count +
            '</span><span class="secsub">' + esc(sub) + '</span></div>';
    }

    function colHead(first) {
        return '<div class="colhead" aria-hidden="true"><span>' + esc(first) + '</span><span>Where it’s up to</span>' +
            '<span>What you can do</span></div>';
    }

    function projectCell(opp, extraMeta) {
        var meta = [];
        if (opp.siteAddress) {
            meta.push(opp.siteAddress.replace(/\s*\r?\n\s*/g, ', '));
        }
        if (extraMeta) {
            meta.push(extraMeta);
        }
        return '<div class="cell"><span class="name">' + esc(opp.title || opp.tranId || 'Your project') + '</span>' +
            (meta.length ? '<span class="meta">' + esc(meta.join(' · ')) + '</span>' : '') + '</div>';
    }

    /**
     * Pure (2.1.2, PR #7 amendment 2): a build stage as a CUSTOMER sees it — the list's ordering prefix
     * removed: a leading "<digits> - " (or an en dash, with or without the spaces). "7 - Roof, Doors,
     * Windows" -> "Roof, Doors, Windows". Anything else, and anything that would come out empty, stays as
     * stored. The Task and the logs keep the full stored text: staff know the numbering.
     * @param {string} text
     * @returns {string}
     */
    function stageLabel(text) {
        var raw = String(text === null || text === undefined ? '' : text);
        var stripped = raw.replace(/^\s*\d+\s*[-\u2013]\s*/, '');
        return stripped !== raw && stripped.replace(/\s+/g, '') !== '' ? stripped : raw;
    }

    /**
     * Pure (2.1.2, PR #7 amendment 2; replaces 2.1.1's one-line quoteMeta): where an open quote's project is
     * up to, under its Quote sent badge — one labelled line per fact that has a value:
     *   Project stage: <stageLabel(current text)>   (whatever the opportunity holds, not only UPD_BUILD_STAGES)
     *   Expected start: <Mon yyyy>                  (custbody_opp_del_date, month and year, as stored even if past)
     * '' with neither. Label muted, value stronger; every value escaped here.
     * @returns {string} HTML
     */
    function quoteFacts(opp) {
        var stage = stageLabel(opp && opp.buildStageText);
        var when = dates.formatMonthYear(opp && opp.delDateKey);
        var lines = [];
        if (stage) {
            lines.push(['Project stage', stage]);
        }
        if (when) {
            lines.push(['Expected start', when]);
        }
        return lines.map(function (l) {
            return '<span class="meta fact">' + esc(l[0]) + ': <span class="fv">' + esc(l[1]) + '</span></span>';
        }).join('');
    }

    function stateCell(badgeHtml, meta) {
        return '<div class="cell">' + badgeHtml + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</div>';
    }

    /** One sales order row inside "Projects for delivery". */
    function orderRow(row, m) {
        var o = row.order;
        var title = orderTitle(o);
        var name = '<div class="cell">' + orderLines(o) + '</div>';
        var state;
        var acts;

        if (row.state === 'released') {
            // 1.3: paid and released to the warehouse. No payment panel, whatever the checkbox says.
            state = stateCell(badge('ready', 'Being prepared'), o.shipDateKey ? 'We\u2019re preparing your delivery for ' +
                shortDate(o.shipDateKey) + (o.timeText ? ', ' + o.timeText : '') : 'We\u2019re preparing your delivery');
            acts = '<span class="meta">' + NOTHING_NEEDED + '</span>';
        } else if (row.state === 'delivered') {
            // 1.3: "Recently delivered". No actions, no amounts.
            state = stateCell(badge('ready', 'Delivered'), 'Delivered ' + shortDate(o.deliveredKey));
            acts = '<span class="meta">' + NOTHING_NEEDED + '</span>';
        } else if (row.state === 'booked') {
            state = stateCell(badge('ready', 'Delivery booked'), shortDate(o.confirmedDateKey) +
                (o.timeText ? ', ' + o.timeText : ''));
            acts = '<span class="meta">' + NOTHING_NEEDED + '</span>';
        } else if (row.state === 'awaiting_payment') {
            state = stateCell(badge('pay', 'Awaiting payment'), 'Requested ' +
                (shortDate(o.shipDateKey) || 'date to be confirmed') + (o.timeText ? ', ' + o.timeText : ''));
            // The amount whenever it is known, whatever the terms (PR #3 amendment 1).
            acts = '<details class="paydet"><summary class="out">Payment details</summary><div class="panel">' +
                (o.payIntent === String(m.payBacs) ? bankRows(m.bank, o.tranId, amountText(o.amount)) +
                    '<p style="margin:8px 0 0">We’ll book your delivery once payment reaches us.</p>' :
                    cardPaymentText(amountText(o.amount))) + '</div></details>';
        } else if (row.state === 'requested') {
            state = stateCell(badge('work', 'Delivery requested'), 'Requested ' +
                (shortDate(o.shipDateKey) || 'date to be confirmed') + (o.timeText ? ', ' + o.timeText : ''));
            acts = '<span class="meta">' + NOTHING_NEEDED + '</span>';
        } else if (row.state === 'ready') {
            // 2.2.2: the order's current forecast date, today or later.
            state = stateCell(badge('ready', 'Ready to deliver'), plannedDate(o) ?
                PLANNED_TEXT.ROW.replace('{date}', plannedDate(o)) : '');
            acts = '<a class="cta" href="' + esc(m.deliveryUrl(o.id)) + '">Arrange delivery</a>';
        } else {
            state = stateCell(badge('need', 'Needs information'), o.holdReason);
            acts = '<span class="meta">' + AM_IN_TOUCH + '</span>';
        }
        return '<div class="sorow">' + name + state + '<div class="acts">' + acts + '</div></div>';
    }

    /**
     * The dashboard.
     * @param {Object} m - { customerName, greetingName, logoUrl, am, groups, notice,
     *                       deliveryUrl(soId), bank, payBacs, updateUrl(oppId) (2.1; null when the
     *                       update action is unavailable, so no button shows) }
     */
    function dashboard(m) {
        var g = m.groups;
        var body = '<div><h1>Your projects</h1><p class="lead">Hello ' + esc(m.greetingName || m.customerName) +
            '. Each project shows where it’s up to and what you can do next.</p></div>';
        var html;
        var i;
        var j;
        var d;
        var count;
        var designCards = false;

        if (m.notice) {
            body += '<div class="notice" role="status">' + esc(m.notice) + '</div>';
        }

        // Canvas order: to order -> in design -> for delivery.
        if (g.toOrder.length) {
            html = '<section class="sec" aria-label="Projects to order">' +
                sectionHead('Projects to order', g.toOrder.length, 'Quotes we’ve sent you') +
                colHead('Project');
            for (i = 0; i < g.toOrder.length; i++) {
                // 2.1: "Tell us where you're up to" on every open quote (Main.dc.html's outline button),
                // only while the update action is available.
                html += '<div class="row">' + projectCell(g.toOrder[i]) + '<div class="cell">' + badge('quote', 'Quote sent') +
                    quoteFacts(g.toOrder[i]) + '</div>' +
                    '<div class="acts">' + (m.updateUrl ? '<a class="out" href="' + esc(m.updateUrl(g.toOrder[i].id)) +
                        '">' + esc(UPDATE_TEXT.BUTTON) + '</a>' : '') + '</div></div>';
            }
            body += html + '</section>';
        }
        if (g.inDesign.length) {
            html = '<section class="sec" aria-label="Projects in design">' +
                sectionHead('Projects in design', g.inDesign.length, 'Ordered, and being designed by our team') +
                colHead('Project');
            for (i = 0; i < g.inDesign.length; i++) {
                d = g.inDesign[i];
                // 2.3: the card states, when the row carries them (data.decorateDesign()).
                if (d.design) {
                    html += designRow(d, m);
                    designCards = true;
                    continue;
                }
                html += '<div class="row">' + projectCell(d.opp) + (d.badge === 'needs_info' ?
                    stateCell(badge('need', 'We need information'), 'Your design information') +
                        '<div class="acts"><span class="meta">' + AM_IN_TOUCH + '</span></div>' :
                    stateCell(badge('work', 'Designing your system'), '') +
                        '<div class="acts"><span class="meta">' + NOTHING_NEEDED + '</span></div>') + '</div>';
            }
            body += html + '</section>';
        }
        if (g.forDelivery.length) {
            html = '<section class="sec" aria-label="Projects for delivery">' +
                // 1.3.2: the pill counts ORDERS (it counted projects before).
                sectionHead('Projects for delivery', countOrders(g.forDelivery), 'Designed, with orders to deliver') +
                colHead('Project and orders');
            for (i = 0; i < g.forDelivery.length; i++) {
                count = g.forDelivery[i].orders.length;
                html += '<div class="oprow">' + projectCell(g.forDelivery[i].opp, count + (count === 1 ? ' order' : ' orders')) +
                    '<div></div><div></div></div>';
                for (j = 0; j < g.forDelivery[i].orders.length; j++) {
                    html += orderRow(g.forDelivery[i].orders[j], m);
                }
            }
            body += html + '</section>';
        }
        // 1.3.2: "Booked deliveries", last — everything in hand (released, booked, recently delivered),
        // in data.arrangeSections() order. Left out when empty. The pill counts orders.
        if ((g.booked || []).length) {
            html = '<section class="sec" aria-label="Booked deliveries">' +
                sectionHead('Booked deliveries', countOrders(g.booked), 'Nothing needed from you. Delivered orders stay here for ' +
                    m.recentDays + ' days.') +
                colHead('Project and orders');
            for (i = 0; i < g.booked.length; i++) {
                count = g.booked[i].orders.length;
                html += '<div class="oprow">' + projectCell(g.booked[i].opp, count + (count === 1 ? ' order' : ' orders')) +
                    '<div></div><div></div></div>';
                for (j = 0; j < g.booked[i].orders.length; j++) {
                    html += orderRow(g.booked[i].orders[j], m);
                }
            }
            body += html + '</section>';
        }
        // A customer whose only items are booked or recent deliveries is not "nothing to show".
        if (g.isEmpty && !(g.booked || []).length) {
            body += '<div class="card"><p style="margin:0">There is nothing to show at the moment. If you think ' +
                'that’s wrong, please contact your account manager.</p></div>';
        }

        body += '<footer class="foot">' + (questionsLine(m.am) ? '<span>' + questionsLine(m.am) + '.</span>' : '<span></span>') +
            '<span>This link is personal to you. Please don’t share it.</span></footer>';

        return page({ title: 'Your projects', logoUrl: m.logoUrl, am: m.am, header: 'am', width: 'w1200', body: body,
            css: designCards ? DESIGN_ROW_CSS : '' });
    }

    // ---------------------------------------------------------------- delivery form (Delivery)

    function fieldError(errors, name) {
        return errors && errors[name] ? '<p class="err" id="err-' + esc(name) + '" role="alert">' +
            esc(errors[name]) + '</p>' : '';
    }

    function describedBy(errors, name) {
        return errors && errors[name] ? ' aria-describedby="err-' + esc(name) + '" aria-invalid="true"' : '';
    }

    /**
     * The calendar. Every month of the window renders; every allowed day is a radio input inside
     * the form. Script shows one month at a time.
     */
    function calendar(months, allowedSet, selected) {
        var html = '<div class="calnav"><button type="button" class="navbtn" id="cal-prev" aria-label="Previous month">' +
            '‹</button><div class="caltitle" id="cal-title" aria-live="polite"></div>' +
            '<button type="button" class="navbtn" id="cal-next" aria-label="Next month">›</button></div>' +
            '<div class="months">';
        var dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        var i;
        var w;
        var d;
        var key;
        var day;

        for (i = 0; i < months.length; i++) {
            html += '<div class="month" data-title="' + esc(months[i].title) + '"><h3>' + esc(months[i].title) +
                '</h3><div class="cal">';
            for (d = 0; d < 7; d++) {
                html += '<div class="wd" aria-hidden="true">' + dow[d] + '</div>';
            }
            for (w = 0; w < months[i].weeks.length; w++) {
                for (d = 0; d < 7; d++) {
                    key = months[i].weeks[w][d];
                    if (!key) {
                        html += '<div></div>';
                        continue;
                    }
                    day = String(parseInt(key.slice(8), 10));
                    if (allowedSet[key]) {
                        html += '<label class="day"><input class="sr" type="radio" name="date" value="' + esc(key) + '"' +
                            (selected === key ? ' checked' : '') + ' required data-label="' + esc(shortDate(key)) +
                            '" aria-label="' + esc(shortDate(key)) + '"><span class="d">' + day + '</span></label>';
                    } else {
                        html += '<span class="day day-off" aria-hidden="true"><span class="d">' + day + '</span></span>';
                    }
                }
            }
            html += '</div></div>';
        }
        return html + '</div>';
    }

    function segments(name, options, selected) {
        var html = '<div class="segs">';
        var i;
        for (i = 0; i < options.length; i++) {
            html += '<label class="seg"><input class="sr" type="radio" name="' + esc(name) + '" value="' + esc(options[i].id) +
                '"' + (String(selected) === String(options[i].id) ? ' checked' : '') + ' required data-label="' +
                esc(options[i].text) + '"><span class="s">' + esc(options[i].text) + '</span></label>';
        }
        return html + '</div>';
    }

    /** 2.2.1: the delivery form's customer-facing additions. Plain text: escaped when used. */
    var DELIVERY_TEXT = {
        TIME_NOTE: 'We\u2019ll always aim for your preferred time, but we can\u2019t control the traffic on the day, so ' +
            'please treat it as a guide rather than a guaranteed slot.',
        SURCHARGE_HINT: 'A surcharge of {amount} applies for this unloading option.',
        SURCHARGE_CONFIRM: 'Your {option} unloading surcharge of {amount} will be added to your balance. ' +
            'We\u2019ll confirm the new total.'
    };

    /** Pure (2.2.1): "A surcharge of £45 + VAT applies for this unloading option." */
    function surchargeHint(amount) {
        return DELIVERY_TEXT.SURCHARGE_HINT.replace('{amount}', amount);
    }

    /**
     * Radio cards: the list text as the title, an optional hint under it.
     * @param {Object} hints - id -> hint text (from custscript_cdb_option_hints); may be empty
     * @param {Object} [notes] - 2.2.1: id -> a second line in the hint's place (the unloading surcharge);
     *   always shown under that card, script or not
     */
    function optionCards(name, options, selected, hints, notes) {
        var html = '<div class="opts">';
        var i;
        var hint;
        var note;
        for (i = 0; i < options.length; i++) {
            hint = hints && hints.hasOwnProperty(options[i].id) ? hints[options[i].id] : '';
            note = notes && notes.hasOwnProperty(options[i].id) ? notes[options[i].id] : '';
            html += '<label class="optc"><input type="radio" name="' + esc(name) + '" value="' + esc(options[i].id) + '"' +
                (String(selected) === String(options[i].id) ? ' checked' : '') + ' required data-label="' +
                esc(options[i].text) + '"><span><span class="ot">' + esc(options[i].text) + '</span>' +
                (hint ? '<span class="oh">' + esc(hint) + '</span>' : '') +
                (note ? '<span class="oh">' + esc(note) + '</span>' : '') + '</span></label>';
        }
        return html + '</div>';
    }

    function textInput(type, name, label, value, maxLength, errors, required, autocomplete) {
        return '<div><label class="lbl" for="f-' + esc(name) + '">' + esc(label) + (required ? '' : ' (optional)') +
            '</label>' + fieldError(errors, name) + '<input class="inp" type="' + type + '" id="f-' + esc(name) +
            '" name="' + esc(name) + '" value="' + esc(value) + '" maxlength="' + maxLength + '"' +
            (autocomplete ? ' autocomplete="' + autocomplete + '"' : '') + (required ? ' required' : '') +
            describedBy(errors, name) + '></div>';
    }

    function textOf(options, id) {
        var i;
        for (i = 0; i < (options || []).length; i++) {
            if (String(options[i].id) === String(id)) {
                return options[i].text;
            }
        }
        return '';
    }

    /** The guidance panel above the vehicle and unloading options. */
    function guidance(paragraphs) {
        var html = '<div class="tip">';
        var i;
        for (i = 0; i < (paragraphs || []).length; i++) {
            html += '<p><strong>' + esc(paragraphs[i][0]) + '</strong>' + esc(paragraphs[i][1]) + '</p>';
        }
        return html + '</div>';
    }

    var PAYMENT_LABELS = { BACS: 'Bank transfer', CARD: 'Card', ACCOUNT: 'Add to my account' };

    /** The radio card for each payment option (1.2: Account replaces Card for account orders). */
    var PAYMENT_CARDS = {
        BACS: { title: 'Bank transfer (BACS)',
            hint: 'We\u2019ll show you our bank details next. Use your order number as the reference.' },
        CARD: { title: 'Card', hint: 'Your account manager will call you to take payment.' },
        ACCOUNT: { title: 'Add to my account', hint: 'We\u2019ll add this order to your account. No payment is needed now.' }
    };

    function paymentCards(options, selected) {
        var html = '<div class="g2">';
        var i;
        var key;
        for (i = 0; i < options.length; i++) {
            key = options[i];
            html += '<label class="pay"><input type="radio" name="payment" value="' + esc(key) + '"' +
                (selected === key ? ' checked' : '') + ' required data-label="' + esc(PAYMENT_LABELS[key]) + '">' +
                '<span><span class="ot">' + esc(PAYMENT_CARDS[key].title) + '</span><span class="oh">' +
                esc(PAYMENT_CARDS[key].hint) + '</span></span></label>';
        }
        return html + '</div>';
    }

    /** "What happens next" for the aside: account orders have no payment step. */
    function nextSteps(prepay) {
        return prepay ?
            '<li>We receive your request straight away.</li>' +
            '<li>You pay by bank transfer, or we call you to take card payment.</li>' +
            '<li>Once payment arrives we book your delivery and confirm the date by email.</li>' :
            '<li>We receive your request straight away.</li>' +
            '<li>We book your delivery and confirm the date by email.</li>';
    }

    /**
     * The inline script for the form: month switching and the live summary. ES5, no library. 2.2: the
     * new address's fields show, and line 1, town and postcode become required, only while "Add a new
     * address…" is chosen.
     */
    var FORM_SCRIPT = [
        '(function(){',
        'var d=document;',
        'function init(){',
        'var sel=d.getElementById("f-address"),box=d.getElementById("newaddr");',
        'function addr(){var on=sel.value==="' + config.NEW_ADDRESS.VALUE + '",req=["addr1","city","zip"],k,el;',
        'box.className="newaddr"+(on?" on":"");',
        'for(k=0;k<req.length;k++){el=d.getElementById(req[k]);if(el){el.required=on;}}}',
        'if(sel&&box){sel.addEventListener("change",addr);addr();}',
        'var months=d.querySelectorAll(".month"),title=d.getElementById("cal-title"),',
        'prev=d.getElementById("cal-prev"),next=d.getElementById("cal-next"),cur=0,i;',
        'function show(n){var j;cur=n;for(j=0;j<months.length;j++){',
        'months[j].className="month"+(j===n?" on":"");}',
        'title.textContent=months[n].getAttribute("data-title");',
        'prev.disabled=n===0;next.disabled=n===months.length-1;}',
        'if(months.length&&title&&prev&&next){',
        'cur=-1;for(i=0;i<months.length;i++){if(months[i].querySelector("input:checked")){cur=i;break;}}',
        'if(cur<0){for(i=0;i<months.length;i++){if(months[i].querySelector("input")){cur=i;break;}}}',
        'if(cur<0){cur=0;}',
        'prev.onclick=function(){if(cur>0){show(cur-1);}};',
        'next.onclick=function(){if(cur<months.length-1){show(cur+1);}};',
        'show(cur);}',
        'var form=d.getElementById("dform");',
        'function sync(){var outs=d.querySelectorAll("[data-sum]"),k,el,picked;',
        'for(k=0;k<outs.length;k++){el=outs[k];',
        'picked=form.querySelector("input[name=\\""+el.getAttribute("data-sum")+"\\"]:checked");',
        'el.textContent=picked?picked.getAttribute("data-label"):el.getAttribute("data-empty");}}',
        'if(form){form.addEventListener("change",sync);sync();}',
        '}',
        'if(d.readyState==="loading"){d.addEventListener("DOMContentLoaded",init);}else{init();}',
        '})();'
    ].join('');

    /**
     * 2.2: one input of the new address. The id and name are the plain field name and never change: an
     * address lookup will fill them later. Never `required` in the markup (the script adds it while the
     * option is chosen; the server requires them only when address=new was posted).
     */
    function addressInput(name, label, value, maxLength, errors, optional, autocomplete) {
        return '<div><label class="lbl" for="' + name + '">' + esc(label) + (optional ? ' (optional)' : '') + '</label>' +
            fieldError(errors, name) + '<input class="inp" type="text" id="' + name + '" name="' + name + '" value="' +
            esc(value) + '" maxlength="' + maxLength + '" autocomplete="' + autocomplete + '"' + describedBy(errors, name) +
            '></div>';
    }

    /** 2.2: "Add a new address…": its fields, the no-script hint first. */
    function newAddressFields(v, e, limits, on) {
        return '<div class="newaddr' + (on ? ' on' : '') + '" id="newaddr">' +
            '<p class="hint newaddr-nojs" style="margin:0">Only if you chose \u2018Add a new address\u2019</p>' +
            addressInput('addr1', 'Address line 1', v.addr1, limits.ADDR_LINE, e, false, 'address-line1') +
            addressInput('addr2', 'Address line 2', v.addr2, limits.ADDR_LINE, e, true, 'address-line2') +
            '<div class="g2">' +
            addressInput('city', 'Town or city', v.city, limits.ADDR_CITY, e, false, 'address-level2') +
            addressInput('county', 'County', v.county, limits.ADDR_COUNTY, e, true, 'address-level1') + '</div>' +
            '<div class="g2">' + addressInput('zip', 'Postcode', v.zip, limits.ADDR_ZIP, e, false, 'postal-code') +
            '<div></div></div></div>';
    }

    /**
     * 2.2: the delivery form's own rules — the new address shows without script (with its hint); with
     * script, only when "Add a new address…" is chosen.
     */
    var NEW_ADDRESS_CSS = '\n.newaddr{display:flex;flex-direction:column;gap:12px}\n' +
        '.js .newaddr{display:none}.js .newaddr.on{display:flex}.js .newaddr-nojs{display:none}';

    /** One summary row; live when the script runs, static text otherwise. */
    function summaryRow(label, name, staticText) {
        return '<div class="srow"><span>' + esc(label) + '</span><span data-sum="' + esc(name) + '" data-empty="Not chosen yet">' +
            esc(staticText || 'Not chosen yet') + '</span></div>';
    }

    /**
     * The delivery form.
     * @param {Object} m - { logoUrl, am, order, opp, actionUrl, backUrl, token, months, allowedSet,
     *                       values, errors, options: {time, vehicle, unload, address}, hints:
     *                       {vehicle, unload}, guidance, noticeDays, limits, hasErrors,
     *                       paymentOptions (1.2: ['BACS','CARD'] or ['BACS','ACCOUNT']), surcharges (2.2.1:
     *                       unload option id -> amount text; {} none) }
     */
    function deliveryForm(m) {
        var v = m.values || {};
        var e = m.errors || {};
        var o = m.order;
        var title = orderTitle(o);
        var surchargeNotes = {};
        var key;
        var prepay = o.prepay !== false;
        // Amendment 1: shown to every customer when known. Account customers are told it only
        // applies to a bank transfer.
        var amountShown = amountText(o.amount);
        var i;
        var addressOptions = '';
        var notice = '';
        var body;

        for (i = 0; i < m.options.address.length; i++) {
            addressOptions += '<option value="' + esc(m.options.address[i].id) + '"' +
                (String(v.address) === String(m.options.address[i].id) ? ' selected' : '') + '>' +
                esc(m.options.address[i].text || m.options.address[i].label || 'Address') + '</option>';
        }
        // 2.2: always last.
        addressOptions += '<option value="' + esc(config.NEW_ADDRESS.VALUE) + '"' +
            (String(v.address) === config.NEW_ADDRESS.VALUE ? ' selected' : '') + '>' + esc(config.NEW_ADDRESS.OPTION) +
            '</option>';
        for (key in (m.surcharges || {})) {
            if (m.surcharges.hasOwnProperty(key)) {
                surchargeNotes[key] = surchargeHint(m.surcharges[key]);
            }
        }
        if (m.noticeDays > 0) {
            notice = 'We need at least ' + m.noticeDays + ' working day' + (m.noticeDays === 1 ? '' : 's') +
                '’ notice. ';
        }

        body = '<div style="display:flex;flex-direction:column;gap:8px">' +
            '<a href="' + esc(m.backUrl) + '" style="font-size:15px;text-decoration:none">← Your projects</a>' +
            '<h1>Arrange delivery</h1>' +
            '<p class="lead" style="margin:0">' + esc([m.opp && m.opp.title, title, 'Order ' + o.tranId]
                .filter(function (x) { return !!x; }).join(' · ')) + '</p>' +
            (o.uniqueRef ? '<p class="soref" style="margin:0">' + esc(o.uniqueRef) + '</p>' : '') +
            // 2.2.2: the guard only lets a ready-to-book order here.
            (plannedDate(o) ? '<p class="hint" style="margin:0">' + esc(PLANNED_TEXT.FORM.replace('{date}', plannedDate(o))) +
                '</p>' : '') + '</div>' +
            (m.hasErrors ? '<div class="notice" role="alert">Please check the highlighted answers below.</div>' : '') +
            '<div class="layout"><form class="fcol" id="dform" method="post" action="' + esc(m.actionUrl) +
            '" accept-charset="utf-8">' +
            '<input type="hidden" name="t" value="' + esc(m.token) + '">' +
            '<input type="hidden" name="a" value="delivery">' +
            '<input type="hidden" name="so" value="' + esc(o.id) + '">' +

            '<section class="card"><h2><span class="num">1</span>When would you like it?</h2>' +
            '<fieldset><legend>Delivery date</legend>' + fieldError(e, 'date') +
            calendar(m.months, m.allowedSet, v.date) + '</fieldset>' +
            '<p class="hint" style="margin:0">' + esc(notice) + 'Weekends, bank holidays and our closure days ' +
            'can’t be chosen.</p>' +
            '<fieldset><legend>Time of day</legend>' + fieldError(e, 'time') + segments('time', m.options.time, v.time) +
            '</fieldset><p class="hint" style="margin:0">' + esc(DELIVERY_TEXT.TIME_NOTE) + '</p></section>' +

            '<section class="card"><h2><span class="num">2</span>Where should we deliver?</h2><div>' +
            '<label class="lbl" for="f-address">Delivery address</label>' + fieldError(e, 'address') +
            '<select class="inp" id="f-address" name="address" required' + describedBy(e, 'address') + '>' +
            addressOptions + '</select><p class="hint" style="margin:6px 0 0">Not in the list? Choose \u201c' +
            esc(config.NEW_ADDRESS.OPTION) + '\u201d and type it in.</p></div>' +
            newAddressFields(v, e, m.limits, String(v.address) === config.NEW_ADDRESS.VALUE) + '</section>' +

            '<section class="card"><h2><span class="num">3</span>Access and unloading</h2>' +
            guidance(m.guidance) +
            '<fieldset><legend>Largest vehicle that can reach the property</legend>' + fieldError(e, 'vehicle') +
            optionCards('vehicle', m.options.vehicle, v.vehicle, m.hints && m.hints.vehicle) + '</fieldset>' +
            '<fieldset><legend>Unloading</legend>' + fieldError(e, 'unload') +
            optionCards('unload', m.options.unload, v.unload, m.hints && m.hints.unload, surchargeNotes) +
            '</fieldset></section>' +

            '<section class="card"><h2><span class="num">4</span>Who should the driver contact on site?</h2><div class="g3">' +
            textInput('text', 'contactName', 'Name', v.contactName, m.limits.CONTACT_NAME, e, true, 'name') +
            textInput('tel', 'contactPhone', 'Phone', v.contactPhone, m.limits.CONTACT_PHONE, e, true, 'tel') +
            textInput('email', 'contactEmail', 'Email', v.contactEmail, m.limits.CONTACT_EMAIL, e, false, 'email') +
            '</div></section>' +

            '<section class="card"><h2><span class="num">5</span>Anything else we should know?</h2><div>' +
            '<label class="lbl" for="f-requests">Special requests (optional)</label>' + fieldError(e, 'requests') +
            '<textarea class="inp" id="f-requests" name="requests" maxlength="' + m.limits.SPECIAL_REQUESTS + '"' +
            ' placeholder="For example: narrow lane, gate code, where to leave the pallet"' + describedBy(e, 'requests') +
            '>' + esc(v.requests) + '</textarea><p class="hint" style="margin:6px 0 0">Up to ' +
            m.limits.SPECIAL_REQUESTS + ' characters.</p></div></section>' +

            '<section class="card"><h2><span class="num">6</span>How would you like to pay?</h2>' +
            (amountShown ? '<p class="amt" style="margin:0">' + (amountShown === NOTHING_TO_PAY ? esc(amountShown) + '.' :
                'Amount to pay: <strong>' + esc(amountShown) + '</strong>') + '</p>' +
                (prepay ? '' : '<p class="hint" style="margin:0">Only if you\u2019re paying by bank transfer. Choose ' +
                    '\u2018Add to my account\u2019 and nothing is due now.</p>') : '') +
            '<fieldset><legend class="sr" style="position:absolute">Payment</legend>' + fieldError(e, 'payment') +
            paymentCards(m.paymentOptions || ['BACS', 'CARD'], v.payment) + '</fieldset>' +
            '<div class="tip">' + (prepay ? 'Your delivery is booked once we’ve received payment. We’ll email you to ' +
                'confirm the date.' : 'If you pay by bank transfer, we book your delivery once payment reaches us. ' +
                'Either way, we’ll email you to confirm the date.') + '</div></section>' +

            '<div class="submitrow"><button type="submit" class="cta">Request delivery</button>' +
            '<a href="' + esc(m.backUrl) + '" style="font-size:16px">Cancel</a></div>' +
            '</form>' +

            '<aside class="card" aria-label="Your delivery"><h2>Your delivery</h2><div>' +
            '<div class="srow"><span>Order</span><span>' + esc(o.tranId) + '</span></div>' +
            '<div class="srow"><span>System</span><span>' + esc(title) + '</span></div>' +
            (o.uniqueRef ? '<div class="srow"><span>Contains</span><span>' + esc(o.uniqueRef) + '</span></div>' : '') +
            (amountShown ? '<div class="srow"><span>Amount to pay</span><span>' + esc(amountShown) + '</span></div>' : '') +
            summaryRow('Date', 'date', v.date ? shortDate(v.date) : '') +
            summaryRow('Time', 'time', textOf(m.options.time, v.time)) +
            summaryRow('Payment', 'payment', PAYMENT_LABELS[v.payment] || '') +
            '</div><h3>What happens next</h3><ol class="next">' + nextSteps(prepay) + '</ol></aside></div>';

        return page({ title: 'Arrange delivery', logoUrl: m.logoUrl, am: m.am, header: 'questions',
            width: 'w1120', body: body, script: FORM_SCRIPT, css: NEW_ADDRESS_CSS });
    }

    // ---------------------------------------------------------------- confirmations

    /** 2.2: the confirmation's new-address wording. Plain text: escaped when used. */
    var CONFIRM_TEXT = {
        NEW_ADDRESS: 'As this is a new address, we\u2019ll check access and any delivery charge before we confirm your date.',
        AMOUNT_NOTE: 'This may change if delivery to the new address costs more. We\u2019ll tell you before you pay.'
    };

    /** 2.2: the note that goes with the amount to pay, with a new address only. */
    function amountNote() {
        return '<p class="hint" style="margin:8px 0 0">' + esc(CONFIRM_TEXT.AMOUNT_NOTE) + '</p>';
    }

    /**
     * The page after a successful request (ConfirmBacs / ConfirmCard, and 1.2's account page styled
     * like the card one).
     * @param {Object} m - { logoUrl, am, payment ('BACS'|'CARD'|'ACCOUNT'), bank, tranId, orderTitle,
     *                       uniqueRef, backUrl, dateKey, timeText, amount (pay-up-front only), newAddress
     *                       (2.2: true when the customer added a new delivery address), surcharge (2.2.1:
     *                       null, or { optionName, amount } for the unloading option chosen) }
     */
    function confirmation(m) {
        var noted = (m.dateKey ? shortDate(m.dateKey) : 'your date') + (m.timeText ? ', ' + m.timeText : '');
        var what = (m.orderTitle || 'your order') + (m.uniqueRef ? ', ' + m.uniqueRef : '') + ' (order ' + m.tranId + ')';
        var amountShown = m.payment === 'ACCOUNT' ? '' : amountText(m.amount);
        // 2.2.1: under the amount to pay — in the bank card for BACS, else on the main card.
        var surcharge = m.surcharge ? '<p class="hint" style="margin:8px 0 0">' + esc(DELIVERY_TEXT.SURCHARGE_CONFIRM
            .replace('{option}', m.surcharge.optionName).replace('{amount}', m.surcharge.amount)) + '</p>' : '';
        var body = '<div class="card done"><div class="tick">' + TICK_ICON + '</div><h1>Delivery requested</h1><p>' +
            (m.payment === 'ACCOUNT' ? esc('Delivery requested. We’ll add order ' + m.tranId + ' to your account and ' +
                'email you to confirm the date.') :
                esc('Thanks. We’ve noted ' + noted + ', for ' + what + '. ') +
                (m.payment === 'BACS' ? 'We’ll book it as soon as your payment reaches us.' :
                    cardPaymentText(amountShown) + ' Once payment is taken, we’ll book your delivery.')) +
            '</p>' +
            // 2.2: only with a new delivery address; the same page whether or not it reached the address book.
            (m.newAddress ? '<p>' + esc(CONFIRM_TEXT.NEW_ADDRESS) + '</p>' +
                (amountShown && m.payment !== 'BACS' ? amountNote() : '') : '') +
            (m.payment !== 'BACS' ? surcharge : '') +
            '</div>';

        if (m.payment === 'BACS') {
            body += '<div class="card bank"><h2>Pay by bank transfer</h2>' + bankRows(m.bank, m.tranId, amountShown) +
                (m.newAddress && amountShown ? amountNote() : '') + surcharge +
                '<p style="margin:8px 0 0;font-size:15px;color:#4a4650">Please use the reference exactly as shown so ' +
                'we can match your payment. We’ll book your delivery once payment reaches us.</p></div>' +
                '<div class="card"><h2 style="font-size:18px">What happens next</h2><ol class="next" style="font-size:16px">' +
                '<li>Your account manager has your request.</li>' +
                '<li>When your payment arrives, we book the delivery.</li>' +
                '<li>We email you to confirm the date.</li></ol></div>';
        } else {
            // The account page names the customer's rep; the card page names nobody (amendment 1).
            if (m.payment === 'ACCOUNT' && m.am && m.am.name) {
                body += '<div class="card amcard"><div class="cell"><span class="cap">Your account manager</span>' +
                    '<span class="amn">' + esc(m.am.name) + '</span><span style="font-size:16px;color:#4a4650">' +
                    [m.am.phone ? '<a href="' + esc(telHref(m.am.phone)) + '">' + esc(m.am.phone) + '</a>' : '',
                        m.am.email ? '<a href="mailto:' + esc(m.am.email) + '">' + esc(m.am.email) + '</a>' : '']
                        .filter(function (x) { return !!x; }).join(' · ') + '</span></div></div>';
            }
            body += '<div class="card"><h2 style="font-size:18px">What happens next</h2><ol class="next" style="font-size:16px">' +
                (m.payment === 'ACCOUNT' ?
                    '<li>Your account manager has your request.</li>' +
                    '<li>We add the order to your account and book the delivery.</li>' +
                    '<li>We email you to confirm the date.</li>' :
                    '<li>We call you to take payment. We never ask for card details online.</li>' +
                    '<li>Once payment is taken, we book the delivery.</li>' +
                    '<li>We email you to confirm the date.</li>') + '</ol></div>';
        }
        body += '<a class="back" href="' + esc(m.backUrl) + '">Back to your projects</a>';
        return page({ title: 'Delivery requested', logoUrl: m.logoUrl, am: m.am, header: 'none', width: 'w600', body: body });
    }

    // ---------------------------------------------------------------- 2.1: tell us where you're up to (Update)

    /** 2.1: the customer-facing wording of the update action, in one place. Plain text: escaped when used. */
    var UPDATE_TEXT = {
        BUTTON: 'Give us an update',
        TITLE: 'Give us an update',
        // 2.2.1: the first question, the opportunity's title and (when offered) its site address.
        Q_DETAILS: 'Your project details',
        NAME_LABEL: 'Your reference',
        NAME_HINT: 'A name that makes this project easy for you to spot, e.g. \u2018Barn conversion\u2019.',
        SITE_LABEL: 'Site address',
        SITE_HINT: 'Where the work is happening. It\u2019s optional, but it helps us plan your design and delivery.',
        Q_STAGE: 'What stage is your project at?',
        Q_DATE: 'When do you expect to begin work?',
        DATE_LABEL: 'Approximate date',
        DATE_HINT: 'Approximate is fine. It helps us know when you may need us.',
        Q_NOTE: 'Anything else we should know, or is there any information you need from us?',
        Q_CALL: 'Would you like us to call you?',
        CALL_BOX: 'Yes, please call me',
        CALL_PHONE: 'Phone',
        CALL_TIME: 'Best time to call',
        GOES_TO_LEAD: 'Keeping your project details up to date means we can be ready whenever you need us.',
        SEND: 'Send update',
        NOT_GOING: 'Not going ahead? Let us know',
        WHY_NOT: 'Why not?',
        COMMENT: 'Anything you\u2019d like to add? (optional)',
        // 2.2: was "Yes, we're not going ahead". The posted value is still confirm=yes.
        CONFIRM: 'Confirm: we\u2019ve decided not to go ahead',
        CONFIRM_HELP: 'This tells us you\u2019ve decided not to go ahead with this project. It will no longer show on ' +
            'your projects page.',
        NOTHING: 'Nothing to update: you haven\u2019t changed anything, added a note or asked for a call.',
        DONE: 'Thanks, we\u2019ve updated your project',
        DONE_NOT_SAVED: 'Thanks, we\u2019ve passed your update on',
        LOST_DONE: 'Thanks for letting us know.',
        UNAVAILABLE: 'This isn\u2019t available right now'
    };

    /** Radio cards without `required` (2.1): every update question is optional. */
    function choiceCards(name, options, selected, errors, textFor) {
        var html = '<div class="opts">';
        var i;
        for (i = 0; i < options.length; i++) {
            html += '<label class="optc"><input type="radio" name="' + esc(name) + '" value="' + esc(options[i].id) + '"' +
                (String(selected) === String(options[i].id) ? ' checked' : '') + describedBy(errors, name) +
                '><span><span class="ot">' + esc(textFor ? textFor(options[i].text) : options[i].text) + '</span></span></label>';
        }
        return html + '</div>';
    }

    /** "title · QR · site": the update page's lead line, plain text. */
    function oppLine(opp) {
        return [opp.title, opp.tranId, String(opp.siteAddress || '').replace(/\s*\r?\n\s*/g, ', ')]
            .filter(function (x) { return !!x; }).join(' \u00b7 ');
    }

    /** 2.2.1: one "Your project details" input — label, error, the single-line input, the hint under it. */
    function detailInput(name, label, hint, value, maxLength, e) {
        return '<div><label class="lbl" for="f-' + name + '">' + esc(label) + '</label>' + fieldError(e, name) +
            '<input class="inp" type="text" id="f-' + name + '" name="' + name + '" value="' + esc(value) +
            '" maxlength="' + maxLength + '"' + describedBy(e, name) + '>' +
            '<p class="hint" style="margin:6px 0 0">' + esc(hint) + '</p></div>';
    }

    /**
     * The "Tell us where you're up to" page (Update.dc.html, with the questions of release 2.1 part B).
     * @param {Object} m - { logoUrl, am (header), assignee ({ name }, the "Goes to" card), opp,
     *   actionUrl, backUrl, token, stages ([{id, text}]; [] hides the question), showDate, values (2.2:
     *   projectName, prefilled with the title; 2.2.1: siteAddress, prefilled with data.siteAddressLine()),
     *   errors, notice, reasons ([{id, text}]; [] no list), notGoingOpen, limits, callTimes
     *   ([{id, text}]) }
     */
    function updatePage(m) {
        var v = m.values || {};
        var e = m.errors || {};
        var t = UPDATE_TEXT;
        var n = 0;
        var hasErrors = false;
        var updErrors = false;
        var body;
        var key;

        for (key in e) {
            if (e.hasOwnProperty(key)) {
                hasErrors = true;
                if (['reason', 'comment', 'confirm'].indexOf(key) < 0) {
                    updErrors = true;
                }
            }
        }

        function num() {
            n += 1;
            return '<span class="num">' + n + '</span>';
        }

        function hidden(mode) {
            return '<input type="hidden" name="t" value="' + esc(m.token) + '">' +
                '<input type="hidden" name="a" value="update">' +
                '<input type="hidden" name="opp" value="' + esc(m.opp.id) + '">' +
                '<input type="hidden" name="mode" value="' + esc(mode) + '">';
        }

        body = '<div style="display:flex;flex-direction:column;gap:8px">' +
            '<a href="' + esc(m.backUrl) + '" style="font-size:15px;text-decoration:none">\u2190 Your projects</a>' +
            '<h1>' + esc(t.TITLE) + '</h1>' +
            '<p class="lead" style="margin:0">' + esc(oppLine(m.opp)) + '</p></div>' +
            (m.notice ? '<div class="notice" role="status">' + esc(m.notice) + '</div>' : '') +
            (hasErrors ? '<div class="notice" role="alert">Please check the highlighted answers below.</div>' : '') +
            '<div class="layout"><div class="fcol">' +
            '<form class="fcol" id="uform" method="post" action="' + esc(m.actionUrl) + '" accept-charset="utf-8">' +
            hidden('update');

        // 2.2: always first. Optional like the rest: blank or unchanged writes nothing. 2.2.1: the reference and
        // the site address side by side, one line each (.g2 stacks them on a phone); 2.2.2: both, always.
        body += '<section class="card"><h2>' + num() + esc(t.Q_DETAILS) + '</h2><div class="g2">' +
            detailInput('projectName', t.NAME_LABEL, t.NAME_HINT, v.projectName, m.limits.PROJECT_NAME, e) +
            detailInput('siteAddress', t.SITE_LABEL, t.SITE_HINT, v.siteAddress, m.limits.SITE_ADDRESS, e) +
            '</div></section>';

        if ((m.stages || []).length) {
            body += '<section class="card"><h2>' + num() + esc(t.Q_STAGE) + '</h2>' +
                '<fieldset><legend class="sr" style="position:absolute">' + esc(t.Q_STAGE) + '</legend>' +
                fieldError(e, 'buildStage') + choiceCards('buildStage', m.stages, v.buildStage, e, stageLabel) + '</fieldset></section>';
        }
        if (m.showDate) {
            body += '<section class="card"><h2>' + num() + esc(t.Q_DATE) + '</h2><div>' +
                '<label class="lbl" for="f-delDate">' + esc(t.DATE_LABEL) + '</label>' + fieldError(e, 'delDate') +
                '<input class="inp" type="date" id="f-delDate" name="delDate" value="' + esc(v.delDate) + '"' +
                describedBy(e, 'delDate') + ' style="max-width:260px">' +
                '<p class="hint" style="margin:6px 0 0">' + esc(t.DATE_HINT) + '</p></div></section>';
        }
        body += '<section class="card"><h2>' + num() + esc(t.Q_NOTE) + '</h2><div>' +
            '<label class="lbl" for="f-note">Your note (optional)</label>' + fieldError(e, 'note') +
            '<textarea class="inp" id="f-note" name="note" maxlength="' + m.limits.UPDATE_NOTE + '"' +
            ' placeholder="For example: the slab goes down in March, or we\u2019re waiting for planning"' +
            describedBy(e, 'note') + '>' + esc(v.note) + '</textarea><p class="hint" style="margin:6px 0 0">Up to ' +
            m.limits.UPDATE_NOTE + ' characters.</p></div></section>' +

            '<section class="card"><h2>' + num() + esc(t.Q_CALL) + '</h2>' +
            '<div class="cbxrow"><input type="checkbox" id="f-call" name="call" value="T"' + (v.call ? ' checked' : '') + '>' +
            '<label class="chk" for="f-call">' + esc(t.CALL_BOX) + '</label>' +
            '<div class="callfields g2">' +
            '<div><label class="lbl" for="f-phone">' + esc(t.CALL_PHONE) + '</label>' + fieldError(e, 'phone') +
            '<input class="inp" type="tel" id="f-phone" name="phone" value="' + esc(v.phone) + '" maxlength="' +
            m.limits.CONTACT_PHONE + '" autocomplete="tel"' + describedBy(e, 'phone') + '></div>' +
            '<fieldset><legend>' + esc(t.CALL_TIME) + '</legend>' + fieldError(e, 'callTime') +
            choiceCards('callTime', m.callTimes, v.callTime, e) + '</fieldset>' +
            '</div></div></section>' +

            '<div class="submitrow"><button type="submit" class="cta">' + esc(t.SEND) + '</button>' +
            '<a href="' + esc(m.backUrl) + '" style="font-size:16px">Cancel</a></div>' +
            '</form>' +

            // The not-going-ahead panel: closed unless its own POST came back with an error. Its form is
            // separate, so the update form above can never send the confirm value.
            '<details class="card ngp"' + (m.notGoingOpen && !updErrors ? ' open' : '') + '><summary>' +
            esc(t.NOT_GOING) + '</summary>' +
            '<form method="post" action="' + esc(m.actionUrl) + '" accept-charset="utf-8">' + hidden('notgoing') +
            ((m.reasons || []).length ? '<fieldset><legend>' + esc(t.WHY_NOT) + '</legend>' + fieldError(e, 'reason') +
                choiceCards('reason', m.reasons, v.reason, e) + '</fieldset>' : '') +
            '<div><label class="lbl" for="f-comment">' + esc(t.COMMENT) + '</label>' + fieldError(e, 'comment') +
            '<textarea class="inp" id="f-comment" name="comment" maxlength="' + m.limits.UPDATE_COMMENT + '"' +
            describedBy(e, 'comment') + '>' + esc(v.comment) + '</textarea></div>' +
            '<p class="q-help">' + esc(t.CONFIRM_HELP) + '</p>' + fieldError(e, 'confirm') +
            '<div class="submitrow"><button type="submit" class="warnbtn" name="confirm" value="yes">' + esc(t.CONFIRM) +
            '</button></div></form></details>' +
            '</div>' +

            '<aside class="card" aria-label="Who gets your update"><div class="goes"><span class="cap">Goes to</span>' +
            '<span class="amn">' + esc((m.assignee && m.assignee.name) || 'Your account manager') + '</span></div>' +
            '<p class="q-help">' + esc(UPDATE_TEXT.GOES_TO_LEAD) + '</p>' +
            '<p class="q-help">It takes about a minute. Every question is optional.</p></aside></div>';

        return page({ title: t.TITLE, logoUrl: m.logoUrl, am: m.am, header: 'questions', width: 'w1120', body: body });
    }

    /**
     * 2.1: after an update. saved: [{label, text}] — what was saved on the opportunity; notSaved: the
     * write failed (the Task still went to the account manager); callText: "Ray will call you in the
     * morning." or ''.
     * @param {Object} m - { logoUrl, am, saved, notSaved, callText, backUrl }
     */
    function updateDone(m) {
        var saved = m.saved || [];
        var body = '<div class="card done"><div class="tick">' + TICK_ICON + '</div><h1>' +
            esc(m.notSaved ? UPDATE_TEXT.DONE_NOT_SAVED : UPDATE_TEXT.DONE) + '</h1>';
        var i;
        if (m.notSaved) {
            body += '<p>' + esc('Your account manager has your update and will make the change.') + '</p>';
        } else if (saved.length) {
            body += '<p>We\u2019ve saved:</p><ul class="saved">';
            for (i = 0; i < saved.length; i++) {
                body += '<li>' + esc(saved[i].label) + ': <strong>' + esc(saved[i].text) + '</strong></li>';
            }
            body += '</ul>';
        } else {
            body += '<p>' + esc('Your account manager has your message.') + '</p>';
        }
        if (m.callText) {
            body += '<p>' + esc(m.callText) + '</p>';
        }
        body += '</div><a class="back" href="' + esc(m.backUrl) + '">Back to your projects</a>';
        return page({ title: 'Update sent', logoUrl: m.logoUrl, am: m.am, header: 'none', width: 'w600', body: body });
    }

    /** 2.1: after "not going ahead". */
    function lostDone(m) {
        var body = '<div class="card done"><div class="tick">' + TICK_ICON + '</div><h1>' + esc(UPDATE_TEXT.LOST_DONE) +
            '</h1><p>' + esc('We\u2019ve told your account manager. If anything changes, just get in touch.') +
            '</p></div><a class="back" href="' + esc(m.backUrl) + '">Back to your projects</a>';
        return page({ title: 'Thanks for letting us know', logoUrl: m.logoUrl, am: m.am, header: 'none', width: 'w600',
            body: body });
    }

    /**
     * 2.1: the update action is unavailable (the Online-quote library is missing or older than 1.2.0):
     * "This isn't available right now; please call {AM}" — by phone, else email, else by name.
     * @param {Object} m - { logoUrl, am, backUrl }
     */
    function unavailablePage(m) {
        var c = contactParts(m.am);
        var how;
        if (m.am && m.am.name && c.kind === 'phone') {
            how = 'please call ' + esc(m.am.name) + ' on <a href="' + esc(c.href) + '">' + esc(c.text) + '</a>';
        } else if (m.am && m.am.name && c.kind === 'email') {
            how = 'please email ' + esc(m.am.name) + ' at <a href="' + esc(c.href) + '">' + esc(c.text) + '</a>';
        } else if (m.am && m.am.name) {
            how = 'please contact ' + esc(m.am.name);
        } else {
            how = 'please contact your account manager';
        }
        return page({ title: 'Not available', logoUrl: m.logoUrl, am: m.am, header: 'none', width: 'w600',
            body: '<div class="card"><p style="margin:0">' + esc(UPDATE_TEXT.UNAVAILABLE) + '; ' + how + '.</p></div>' +
                '<a class="back" href="' + esc(m.backUrl) + '">Back to your projects</a>' });
    }

    // ---------------------------------------------------------------- email (Email)

    /**
     * One line per project for the digest, as the Email artboard: delivery projects one line per
     * order (each order has its own state), then design, then quotes. Pure.
     * @returns {Array<{title: string, sub: string, badgeKind: string, badgeText: string}>}
     */
    function digestRows(groups, payBacs) {
        var rows = [];
        var i;
        var j;
        var opp;

        // "For delivery": what needs the customer (after data.arrangeSections()).
        for (i = 0; i < groups.forDelivery.length; i++) {
            for (j = 0; j < groups.forDelivery[i].orders.length; j++) {
                rows.push(emailOrderRow(groups.forDelivery[i].opp, groups.forDelivery[i].orders[j], payBacs));
            }
        }
        for (i = 0; i < groups.inDesign.length; i++) {
            opp = groups.inDesign[i].opp;
            // 2.3: the card states, when the row carries them.
            if (groups.inDesign[i].design) {
                rows.push(designDigestRow(groups.inDesign[i]));
                continue;
            }
            rows.push(groups.inDesign[i].badge === 'needs_info' ?
                { title: opp.title || opp.tranId, sub: 'We need some information from you for the design',
                    badgeKind: 'need', badgeText: 'We need information' } :
                { title: opp.title || opp.tranId, sub: 'Our design team is working on it',
                    badgeKind: 'work', badgeText: 'In design' });
        }
        for (i = 0; i < groups.toOrder.length; i++) {
            opp = groups.toOrder[i];
            rows.push({ title: opp.title || opp.tranId, sub: 'Quote sent', badgeKind: 'quote', badgeText: 'Quote stage' });
        }
        // 1.3.2: "Booked deliveries", a headed group at the end, after "For delivery" as on the page.
        // Never in the callout.
        for (i = 0; i < (groups.booked || []).length; i++) {
            for (j = 0; j < groups.booked[i].orders.length; j++) {
                rows.push(emailOrderRow(groups.booked[i].opp, groups.booked[i].orders[j], payBacs));
                if (i === 0 && j === 0) {
                    rows[rows.length - 1].heading = 'Booked deliveries';
                }
            }
        }
        return rows;
    }

    /** 2.3: a design row's digest line, from its card. */
    function designDigestRow(d) {
        var t = DESIGN_TEXT;
        var k = d.design.key;
        return { title: d.opp.title || d.opp.tranId, sub: designCardLines(d).join(' ') || config.DIGEST_EMAIL.DESIGNING,
            badgeKind: k === 'needs_info' || k === 'info_partial' ? 'need' : 'work',
            badgeText: k === 'needs_info' ? t.BADGE_NEEDS_INFO : k === 'info_partial' ? t.BADGE_PARTIAL :
                k === 'info_sent' ? t.BADGE_SENT : 'In design' };
    }

    /**
     * One order's email row, as on the page: description in full, split reference, then
     * "Order SO… · UFH · <where it's up to>".
     */
    function emailOrderRow(opp, st, payBacs) {
        var o = st.order;
        var row = { title: opp.title || opp.tranId, line1: orderTitle(o), ref: o.uniqueRef || '', sub: orderMeta(o) };
        var when = (shortDate(o.shipDateKey) || 'date to be confirmed') + (o.timeText ? ', ' + o.timeText : '');
        if (st.state === 'ready') {
            row.sub += ' \u00b7 ready to arrange delivery';
            row.badgeKind = 'ready'; row.badgeText = 'Action needed';
        } else if (st.state === 'awaiting_payment') {
            // 2.0.3 (digest v2): "ref SO… for payment" for BACS.
            row.sub += ' \u00b7 ' + (o.payIntent === String(payBacs) ? 'ref ' + o.tranId + ' for payment' :
                'your account manager will call to take payment');
            row.badgeKind = 'pay'; row.badgeText = 'Awaiting payment';
        } else if (st.state === 'requested') {
            row.sub += ' \u00b7 requested ' + when;
            row.badgeKind = 'work'; row.badgeText = 'Delivery requested';
        } else if (st.state === 'released') {
            row.sub += ' \u00b7 we\u2019re preparing your delivery' + (o.shipDateKey ? ' for ' + when : '');
            row.badgeKind = 'ready'; row.badgeText = 'Being prepared';
        } else if (st.state === 'booked') {
            row.sub += ' \u00b7 Delivery booked \u00b7 ' + shortDate(o.confirmedDateKey);
            row.badgeKind = 'ready'; row.badgeText = 'Delivery booked';
        } else if (st.state === 'delivered') {
            row.sub += ' \u00b7 delivered ' + shortDate(o.deliveredKey);
            row.badgeKind = 'ready'; row.badgeText = 'Delivered';
        } else {
            row.sub += ' \u00b7 ' + (o.holdReason ? o.holdReason : 'your account manager will be in touch');
            row.badgeKind = 'need'; row.badgeText = 'Needs information';
        }
        return row;
    }

    /**
     * The action callout's sentences, or '' when there is nothing to do. Pure.
     * @returns {string} HTML (escaped)
     */
    function digestCallout(groups, payBacs) {
        var ready = 0;
        var bacs = 0;
        var i;
        var j;
        var st;
        var parts = [];
        for (i = 0; i < groups.forDelivery.length; i++) {
            for (j = 0; j < groups.forDelivery[i].orders.length; j++) {
                st = groups.forDelivery[i].orders[j];
                if (st.state === 'ready') {
                    ready++;
                } else if (st.state === 'awaiting_payment' && st.order.payIntent === String(payBacs)) {
                    bacs++;
                }
            }
        }
        if (ready) {
            parts.push('<strong>' + ready + (ready === 1 ? ' order is' : ' orders are') +
                ' ready to arrange delivery.</strong> Choose a date that suits you.');
        }
        if (bacs) {
            parts.push((ready ? '' : '<strong>') + bacs + (bacs === 1 ? ' order is' : ' orders are') +
                ' awaiting your bank transfer.' + (ready ? '' : '</strong>'));
        }
        return parts.join(' ');
    }

    /**
     * Pure: the end of the email footer's opt-out sentence (amendment 2): " or call {name} on {phone}",
     * " or email {name} at {email}", " or contact {name}", or '' with no name.
     */
    function emailFooterContact(am) {
        var c = contactParts(am);
        if (!am || !am.name) {
            return '';
        }
        if (c.kind === 'phone') {
            return ' or call ' + esc(am.name) + ' on ' + esc(c.text);
        }
        if (c.kind === 'email') {
            // 2.0.3: in the teal footer, so the link is in the footer's text colour.
            return ' or email ' + esc(am.name) + ' at <a href="mailto:' + esc(c.text) + '" style="color:' +
                config.EMAIL_STANDARD.FOOTER_TEXT + ';"><font color="' + config.EMAIL_STANDARD.FOOTER_TEXT + '">' +
                esc(c.text) + '</font></a>';
        }
        return ' or contact ' + esc(am.name);
    }

    /** "every 2 weeks" for 14, "every 7 days" otherwise. */
    function everyText(days) {
        var n = parseInt(days, 10) || 14;
        return n % 7 === 0 ? (n === 7 ? 'every week' : 'every ' + (n / 7) + ' weeks') : 'every ' + n + ' days';
    }

    // ---------------------------------------------------------------- the customer email standard (2.0.2)
    //
    // Send Quote 2.2.0's email card, copied from 2026.03-Online-quote (lib 1.1.0 / Send Quote SL 2.3.1,
    // commit 4463cfa): emailShell, emailRepCard and emailButton, with their constants in
    // config.EMAIL_STANDARD. Pitfall 25: the email must stay centred and single-column with every style
    // attribute and every <style> block removed (NetSuite's Communication tab view), so layout, width,
    // alignment and colour are HTML attributes (align, width, bgcolor, valign, <font color>); CSS only
    // polishes and stacks two-up cells on phones. No floats, no percentage-width side-by-side tables,
    // no display:none wrappers (the preheader span excepted); each button is one [if !mso] / [if mso]
    // pair, so exactly one visible link per button in every client.
    //
    // 2.0.3 (amendment 3, "customer emails v2"): both emails are built to the approved designs
    // docs/design/canvas/EmailDeliveryLink.dc.html and EmailDigestV2.dc.html, in the same standard. Where
    // the drawings use flex or grid, these use table cells. The AM card's buttons are purple (CALL filled,
    // EMAIL outlined), with Send Quote's contact fallback; the footer is teal with its line inside it.

    /** The email's inline font declaration and <font face>. */
    var EF = 'font-family:' + EMAIL_FONT + ';';
    var FACE = EMAIL_FONT;

    /** Text in a colour that survives stripped styles. html must be escaped already. */
    function fontHtml(color, html) {
        return '<font face="' + FACE + '" color="' + color + '">' + html + '</font>';
    }

    /** True for an absolute https URL an email can use (no spaces, quotes or angle brackets). */
    function isHttpsUrl(value) {
        return /^https:\/\/[^\s"'<>]+$/i.test(String(value === null || value === undefined ? '' : value));
    }

    /**
     * The whole email document (Send Quote's emailShell): head, the phone media query, the Outlook
     * blocks, the hidden preheader, the centred 600px column, the caller's rows, the account manager
     * card, the rows after it, and the teal footer (logo, five social links, this email's line).
     *
     * @param {Object} s - every value already escaped HTML:
     *   title, preheader, rows (<tr>…</tr>), card (emailRepCard() or ''), cardIntro (HTML above the card,
     *   optional), after (<tr>…</tr> after the card, optional), footerLine
     * @returns {string}
     */
    function emailShell(s) {
        var std = config.EMAIL_STANDARD;
        var social = std.SOCIAL_LINKS.map(function (sl) {
            return '<td align="center" valign="middle" width="42" style="padding:0 10px;"><a href="' + esc(sl[0]) +
                '" target="_blank"><img src="' + esc(std.IMG_BASE + sl[1]) + '" width="22" height="22" alt="" border="0" style="display:block;width:22px;height:22px;"></a></td>\n';
        }).join('');

        return '' +
            '<!DOCTYPE html>\n' +
            '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n' +
            '<head>\n' +
            '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
            '<meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
            '<meta name="x-apple-disable-message-reformatting">\n' +
            '<meta name="format-detection" content="telephone=no">\n' +
            '<title>' + s.title + '</title>\n' +
            '<!--[if gte mso 16]>\n' +
            '<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>\n' +
            '<![endif]-->\n' +
            '<style>\n' +
            'body { margin:0; padding:0; -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }\n' +
            'table { border-spacing:0; mso-table-lspace:0pt; mso-table-rspace:0pt; }\n' +
            'td { border-collapse:collapse; }\n' +
            'img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }\n' +
            'a[x-apple-data-detectors=true] { color:inherit !important; text-decoration:inherit !important; }\n' +
            '@media all and (max-width: 599px) {\n' +
            '.main-container { width:100% !important; }\n' +
            '.fluid { width:100% !important; height:auto !important; }\n' +
            '.stack { display:block !important; width:100% !important; box-sizing:border-box; }\n' +
            '.btn-full { width:100% !important; }\n' +
            '.cl-sep { display:none !important; }\n' +
            '.cl-line { display:block !important; }\n' +
            '.h1 { font-size:26px !important; line-height:32px !important; }\n' +
            '.pad { padding-left:20px !important; padding-right:20px !important; }\n' +
            '}\n' +
            '</style>\n' +
            '<!--[if mso]>\n' +
            '<style>h1, h2, p, td, a, span, font { font-family:Arial, sans-serif !important; }</style>\n' +
            '<![endif]-->\n' +
            '</head>\n' +
            '<body id="body" bgcolor="#ffffff" style="margin:0;padding:0;background-color:#ffffff;">\n' +
            '<span style="display:none;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">' +
            s.preheader + '</span>\n' +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;">\n' +
            '<tr><td align="center" valign="top">\n' +
            '<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="top"><![endif]-->\n' +
            '<table role="presentation" class="width600 main-container" width="600" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;">\n' +

            s.rows +

            (s.card ? '<tr><td align="center" valign="top" class="pad" style="padding:28px 40px 8px 40px;">\n' + (s.cardIntro || '') +
                s.card + '</td></tr>\n' : '') +

            (s.after || '') +

            // The footer: teal, logo, the five social links, and this email's line.
            '<tr><td align="center" valign="top" bgcolor="' + std.FOOTER_BG + '" class="pad" style="background-color:' + std.FOOTER_BG +
            ';padding:28px 40px;">\n' +
            '<img src="' + esc(std.IMG_BASE + std.FOOTER_LOGO) + '" width="167" height="94" alt="Nu-Heat Underfloor Heating &amp; Renewables" border="0" style="display:block;margin:0 auto 10px auto;width:167px;height:auto;">\n' +
            '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0">\n' +
            '<tr>\n' + social + '</tr>\n' +
            '</table>\n' +
            '<p style="margin:16px 0 0 0;' + EF + 'font-size:13px;line-height:20px;color:' + std.FOOTER_TEXT + ';">' +
            fontHtml(std.FOOTER_TEXT, s.footerLine) + '</p>\n' +
            '</td></tr>\n' +

            '</table>\n' +
            '<!--[if mso]></td></tr></table><![endif]-->\n' +
            '</td></tr>\n' +
            '</table>\n' +
            '</body>\n' +
            '</html>\n';
    }

    /** The logo row: the image when there is a URL, else "Nu-Heat" in purple. */
    function emailLogo(logoUrl) {
        return '<tr><td align="center" valign="top" style="padding:24px 16px;">' +
            (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="Nu-Heat" height="60" border="0" style="display:block;height:60px;' +
                'max-height:60px;width:auto;max-width:100%;border:0;margin:0 auto;">' :
                fontHtml(COLORS.PURPLE, '<span style="' + EF + 'font-size:24px;font-weight:bold;color:' + COLORS.PURPLE +
                    ';">Nu-Heat</span>')) +
            '</td></tr>\n';
    }

    /**
     * The purple band. Every argument is plain text, escaped here.
     * @param {string} eyebrow - e.g. "YOUR PROJECTS UPDATE"
     * @param {string} heading
     * @param {string} sub - the line under the heading, e.g. "Hello Sam"
     */
    function emailBand(eyebrow, heading, sub) {
        return '<tr><td align="center" valign="top" bgcolor="' + COLORS.PURPLE + '" class="pad" style="background-color:' + COLORS.PURPLE +
            ';padding:36px 48px 40px 48px;' + EF + 'color:#ffffff;">' +
            '<p style="margin:0 0 10px;' + EF + 'font-size:14px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;' +
            'color:#e7d9ea;">' + fontHtml('#e7d9ea', '<b>' + esc(eyebrow) + '</b>') + '</p>' +
            '<h1 class="h1" style="margin:0 0 10px;' + EF + 'font-size:32px;line-height:37px;font-weight:bold;color:#ffffff;">' +
            fontHtml('#ffffff', esc(heading)) + '</h1>' +
            '<p style="margin:0;' + EF + 'font-size:17px;line-height:25px;color:#f3ecf4;">' + fontHtml('#f3ecf4', esc(sub)) +
            '</p></td></tr>\n';
    }

    /**
     * The button kinds: yellow (Send Quote's main button), yellowSmall (CHOOSE DATE), purple (VIEW ALL
     * YOUR PROJECTS), call (the AM card's filled CALL) and outline (the AM card's EMAIL: a purple
     * frame made by an outer bgcolor cell, so it survives stripped styles).
     */
    function buttonKind(kind) {
        var std = config.EMAIL_STANDARD;
        var kinds = {
            yellow: { bg: std.BUTTON_BG, fg: std.BUTTON_TEXT, size: 18, pad: '15px 28px' },
            yellowSmall: { bg: std.BUTTON_BG, fg: std.BUTTON_TEXT, size: 14, pad: '12px 18px' },
            purple: { bg: std.PURPLE, fg: '#ffffff', size: 17, pad: '15px 34px' },
            call: { bg: std.PURPLE, fg: '#ffffff', size: 15, pad: '12px 22px' },
            outline: { bg: '#ffffff', fg: std.PURPLE, size: 15, pad: '10px 20px', frame: std.PURPLE }
        };
        return kinds[kind] || kinds.yellow;
    }

    /**
     * Send Quote's bulletproof button: one [if !mso] / [if mso] pair, never a display:none wrapper.
     * Colour by bgcolor and <font color>, padding by cellpadding, so it survives stripped styles.
     * @param {string} href - plain; escaped here
     * @param {string} label - plain; escaped here
     * @param {string} [kind] - see buttonKind(); default yellow
     */
    function emailButton(href, label, kind) {
        var k = buttonKind(kind);
        var text = EF + 'font-size:' + k.size + 'px;line-height:' + (k.size + 4) + 'px;font-weight:bold;color:' + k.fg +
            ';text-decoration:none;letter-spacing:0.5px;';
        var h = esc(href);
        var l = esc(label);
        var link = '<a href="' + h + '" target="_blank" style="display:block;padding:' + k.pad + ';' + text + '"><font face="' +
            FACE + '" color="' + k.fg + '"><b>' + l + '</b></font></a>';
        var inner = '<table role="presentation" class="btn-full" align="center" cellpadding="14" cellspacing="0" border="0" bgcolor="' +
            k.bg + '" style="background-color:' + k.bg + ';border-radius:' + (k.frame ? '4' : '6') + 'px;border-collapse:separate;' +
            (k.frame ? 'width:100%;' : '') + '">\n' +
            '<tr><td align="center" valign="middle" bgcolor="' + k.bg + '" style="padding:0;border-radius:' + (k.frame ? '4' : '6') +
            'px;">' + link + '</td></tr>\n' +
            '</table>\n';
        return '' +
            '<!--[if !mso]><!-- -->\n' +
            (k.frame ? '<table role="presentation" class="btn-full" align="center" cellpadding="2" cellspacing="0" border="0" bgcolor="' +
                k.frame + '" style="background-color:' + k.frame + ';border-radius:6px;border-collapse:separate;">\n' +
                '<tr><td align="center" valign="middle" bgcolor="' + k.frame + '" style="padding:2px;border-radius:6px;">\n' + inner +
                '</td></tr>\n</table>\n' : inner) +
            '<!--<![endif]-->\n' +
            '<!--[if mso]>\n' +
            '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="' + k.bg + '">\n' +
            '<tr><td align="center" valign="middle" bgcolor="' + k.bg + '" style="padding:' + k.pad + ';' +
            (k.frame ? 'border:2px solid ' + k.frame + ';' : '') + '"><a href="' + h + '" target="_blank" style="' + text +
            '"><font face="Arial, sans-serif" color="' + k.fg + '"><b>' + l + '</b></font></a></td></tr>\n' +
            '</table>\n' +
            '<![endif]-->\n';
    }

    /** A centred row holding one button. */
    function emailButtonRow(link, label, kind, padding) {
        return '<tr><td align="center" valign="top" style="padding:' + (padding || '16px 32px 8px') + ';">\n' +
            emailButton(link, label, kind) + '</td></tr>\n';
    }

    /**
     * Pure (Send Quote's resolveFirstName): the first name for the CALL / EMAIL buttons — the
     * employee's firstname, else the first word of the name, else ''.
     */
    function resolveFirstName(firstName, fullName) {
        var first = String(firstName === null || firstName === undefined ? '' : firstName).replace(/^\s+|\s+$/g, '');
        var name = String(fullName === null || fullName === undefined ? '' : fullName).replace(/^\s+|\s+$/g, '');
        if (first) {
            return first;
        }
        if (!name || name === config.EMAIL_STANDARD.GENERIC_AM_NAME) {
            return '';
        }
        return name.split(/\s+/)[0];
    }

    /**
     * Pure (2.0.3): the AM's contact values with Send Quote's fallback — no phone -> 01404 540604, no
     * email -> info@nu-heat.co.uk (config.EMAIL_STANDARD). tel is digits and + only.
     * @returns {{name: string, first: string, phone: string, tel: string, email: string}}
     */
    function amContact(am) {
        var a = am || {};
        var std = config.EMAIL_STANDARD;
        var phone = String(a.phone || '').replace(/^\s+|\s+$/g, '') || std.FALLBACK_PHONE;
        return {
            name: a.name || std.GENERIC_AM_NAME,
            first: resolveFirstName(a.firstName, a.name),
            phone: phone,
            tel: phone.replace(/[^\d+]/g, ''),
            email: String(a.email || '').replace(/^\s+|\s+$/g, '') || std.FALLBACK_EMAIL
        };
    }

    /**
     * The account manager card (Send Quote 2.2.0's emailRepCard): the photo (a 96px circle, only for an
     * https:// URL, else no photo row at all), YOUR ACCOUNT MANAGER, the name, phone · email (two lines
     * on phones), then CALL {FIRST} (purple, filled) and EMAIL {FIRST} (purple outline) side by side,
     * stacked full width on phones. 2.0.3: Send Quote's contact fallback fills a missing phone or email,
     * so both buttons always show.
     *
     * @param {Object} am - { name, phone, email, firstName, photoUrl }, plain text
     * @param {string} [roleLabel] - 2.3: the label over the name; default YOUR ACCOUNT MANAGER
     * @returns {string}
     */
    function emailRepCard(am, roleLabel) {
        var a = am || {};
        var c = amContact(a);
        var first = c.first.toUpperCase();
        var photo = isHttpsUrl(a.photoUrl) ? String(a.photoUrl) : '';
        var buttons = [
            emailButton('tel:' + c.tel, first ? 'CALL ' + first : 'CLICK TO CALL', 'call'),
            emailButton('mailto:' + c.email, first ? 'EMAIL ' + first : 'SEND AN EMAIL', 'outline')
        ];
        return '' +
            '<table role="presentation" class="main-card" width="440" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f2f7" style="width:100%;max-width:440px;background-color:#f6f2f7;border-radius:12px;">\n' +
            (photo ? '<tr><td align="center" valign="top" style="padding:24px 20px 0 20px;"><img src="' + esc(photo) +
                '" width="96" height="96" alt="' + esc(c.name) + '" border="0" style="display:block;margin:0 auto;width:96px;height:96px;border-radius:48px;object-fit:cover;"></td></tr>\n' : '') +
            '<tr><td align="center" valign="top" style="padding:' + (photo ? '14px' : '24px') + ' 20px 0 20px;">\n' +
            '<p style="margin:0 0 4px 0;' + EF + 'font-size:13px;line-height:16px;letter-spacing:2px;color:#59315f;">' +
            fontHtml('#59315f', '<b>' + esc(roleLabel || 'YOUR ACCOUNT MANAGER') + '</b>') + '</p>\n' +
            '<p style="margin:0 0 6px 0;' + EF + 'font-size:24px;line-height:28px;font-weight:bold;color:#000000;">' +
            fontHtml('#000000', '<b>' + esc(c.name) + '</b>') + '</p>\n' +
            '<p style="margin:0;' + EF + 'font-size:17px;line-height:23px;color:#131313;">' +
            fontHtml('#131313', '<span class="cl-line">' + esc(c.phone) + '</span><span class="cl-sep"> · </span><span class="cl-line">' +
                esc(c.email) + '</span>') + '</p>\n' +
            '</td></tr>\n' +
            '<tr><td align="center" valign="top" style="padding:16px 14px 20px 14px;">\n' +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n' +
            '<tr>\n' +
            buttons.map(function (b) {
                return '<td class="stack" width="50%" align="center" valign="top" style="padding:6px;">\n' + b + '</td>\n';
            }).join('') +
            '</tr>\n' +
            '</table>\n' +
            '</td></tr>\n' +
            '</table>\n';
    }

    /** The muted "This link is personal to you…" row, after the card. text is plain. */
    function emailPersonal(text) {
        return '<tr><td align="center" valign="top" class="pad" style="padding:8px 40px 28px;' + EF + 'font-size:13px;color:' +
            COLORS.MUTED + ';">' + fontHtml(COLORS.MUTED, esc(text)) + '</td></tr>\n';
    }

    /** A badge: a small table, colour by bgcolor and <font color>. */
    function emailBadge(kind, text) {
        var b = BADGES[kind] || BADGES.quote;
        return '<table role="presentation" align="right" cellpadding="3" cellspacing="0" border="0" bgcolor="' + b.bg +
            '" style="background-color:' + b.bg + ';border-radius:12px;border-collapse:separate;"><tr>' +
            '<td align="center" valign="middle" bgcolor="' + b.bg + '" style="padding:3px 12px;border-radius:12px;white-space:nowrap;">' +
            fontHtml(b.fg, '<span style="' + EF + 'font-size:13px;font-weight:bold;color:' + b.fg + ';white-space:nowrap;">' +
                esc(text) + '</span>') + '</td></tr></table>';
    }

    /** A paragraph in a colour: plain text, escaped here. */
    function emailP(margin, size, color, text, bold, align) {
        return '<p style="margin:' + margin + ';' + EF + 'font-size:' + size + 'px;line-height:' + Math.round(size * 1.4) + 'px;' +
            (bold ? 'font-weight:bold;' : '') + 'color:' + color + ';' + (align ? 'text-align:' + align + ';' : '') + '"' +
            (align ? ' align="' + align + '"' : '') + '>' + fontHtml(color, bold ? '<b>' + esc(text) + '</b>' : esc(text)) + '</p>';
    }

    /** A section heading (22px), centred. */
    function emailH2(text, color, margin) {
        return '<h2 align="center" style="margin:' + (margin || '0 0 16px 0') + ';' + EF + 'font-size:22px;line-height:27px;' +
            'font-weight:bold;color:' + color + ';text-align:center;">' + fontHtml(color, esc(text)) + '</h2>\n';
    }

    // ---------------------------------------------------------------- "Book your delivery" (2.0.3)

    /** One fact row of the "Your order" box: label left, value right. valueHtml is escaped already. */
    function factRow(label, valueHtml) {
        return '<tr><td align="left" valign="top" style="padding:10px 12px 10px 0;border-top:1px solid #ece8e3;' + EF +
            'font-size:16px;line-height:22px;color:' + COLORS.MUTED + ';white-space:nowrap;">' + fontHtml(COLORS.MUTED, esc(label)) +
            '</td><td align="right" valign="top" style="padding:10px 0;border-top:1px solid #ece8e3;' + EF +
            'font-size:16px;line-height:22px;color:' + COLORS.TEXT + ';text-align:right;">' + fontHtml(COLORS.TEXT, valueHtml) +
            '</td></tr>\n';
    }

    /** One numbered step of "How it works". extraHtml goes under the text (the "need it sooner" line). */
    function stepRow(n, title, text, extraHtml) {
        var teal = config.EMAIL_STANDARD.TEAL;
        return '<tr><td width="36" align="center" valign="top" style="padding:0 14px 16px 0;">' +
            '<table role="presentation" width="36" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="' + teal +
            '" style="background-color:' + teal + ';border-radius:18px;"><tr><td width="36" height="36" align="center" valign="middle" bgcolor="' +
            teal + '" style="' + EF + 'font-size:17px;font-weight:bold;color:#ffffff;border-radius:18px;">' + fontHtml('#ffffff', '<b>' + n + '</b>') +
            '</td></tr></table></td>' +
            '<td align="left" valign="top" style="padding:0 0 16px 0;">' +
            emailP('0 0 2px 0', 17, COLORS.TEXT, title, true) +
            emailP('0', 15, '#4a4650', text) + (extraHtml || '') + '</td></tr>\n';
    }

    /**
     * The "Need it sooner?" line: the AM's first name (else "us") and their phone, or Send Quote's
     * fallback number, as a tel: link. The template is escaped first, then the values go in.
     */
    function soonerHtml(t, am) {
        var c = amContact(am);
        var link = '<a href="tel:' + esc(c.tel) + '" style="color:' + COLORS.PURPLE + ';text-decoration:underline;"><font color="' +
            COLORS.PURPLE + '">' + esc(c.phone) + '</font></a>';
        return esc(t.SOONER).replace('{first}', esc(c.first || t.SOONER_NO_NAME)).replace('{phone}', link);
    }

    /**
     * Pure (2.0.3): what the email's "Amount to pay" row shows — '' when it is left out: unknown amount,
     * or not a pay-up-front order (account customers). 2.0.5: the one amountText(), as everywhere else.
     */
    function amountToPayText(order) {
        return order && order.prepay ? amountText(order.amount) : '';
    }

    /**
     * 2.0, Pure: the subject of the "Send delivery link" email.
     * @param {Object} text - config.DELIVERY_LINK_EMAIL
     * @param {string} tranId
     */
    function deliveryLinkSubject(text, tranId) {
        return String(text.SUBJECT).replace('{SO}', String(tranId || ''));
    }

    /**
     * The "Send delivery link" email (2.0.3: EmailDeliveryLink.dc.html) — one order, one button to its
     * direct delivery link. Pure, snapshot-tested. No opt-out wording: it is not the digest.
     *
     * @param {Object} m - {
     *     text        config.DELIVERY_LINK_EMAIL (defaults to it)
     *     customerName, greetingName, logoUrl
     *     opp         { title, tranId, siteAddress }
     *     order       decorated: id, tranId, description, uniqueRef, typeLabel, quoteTypeText, prepay, amount
     *     earliestKey the form's first allowed date ('' -> no row)
     *     noticeDays  for step 1
     *     link        the direct delivery link;  dashboardLink
     *     am          { name, phone, email, firstName, photoUrl } }
     * @returns {string}
     */
    function deliveryLinkEmail(m) {
        var t = m.text || config.DELIVERY_LINK_EMAIL;
        var o = m.order;
        var std = config.EMAIL_STANDARD;
        var hero = config.EMAIL_HERO_URL;
        var name = m.greetingName || m.customerName || '';
        var project = [m.opp && m.opp.tranId, m.opp && m.opp.siteAddress].filter(function (x) { return !!x; }).join(' · ');
        var amount = amountToPayText(o);
        var earliest = m.earliestKey ? shortDate(m.earliestKey) : '';
        // 2.2.2: the order's current forecast date (the Send link Suitelet's guard only passes a ready order).
        var planned = plannedDate(o);
        var icons = config.EMAIL_ICONS;
        var html = '';
        var facts = '';

        html += emailLogo(m.logoUrl);
        html += emailBand(t.EYEBROW, name ? t.HEADING.replace('{name}', name) : t.HEADING_NO_NAME, t.SUB);

        // The hero: full width, only for an https address.
        if (isHttpsUrl(hero)) {
            html += '<tr><td align="center" valign="top"><img src="' + esc(hero) + '" width="' + config.EMAIL_HERO_WIDTH +
                '" height="' + config.EMAIL_HERO_HEIGHT + '" alt="" border="0" class="fluid" style="display:block;width:100%;' +
                'max-width:600px;height:auto;"></td></tr>\n';
        }

        // "Your order": the label, the order title, the fact rows.
        facts += factRow(t.FACT_ORDER, '<b>' + esc(orderMeta(o).replace(/^Order /, '')) + '</b>');
        if (project) {
            facts += factRow(t.FACT_PROJECT, '<b>' + esc(project) + '</b>');
        }
        if (o.uniqueRef) {
            facts += factRow(t.FACT_THIS_ORDER, '<b>' + esc(o.uniqueRef) + '</b>');
        }
        if (planned) {
            facts += factRow(t.FACT_PLANNED, '<b>' + esc(planned) + '</b>');
        }
        if (earliest) {
            facts += factRow(t.FACT_EARLIEST, '<b>' + esc(earliest) + '</b> ' + fontHtml(COLORS.MUTED, esc(t.EARLIEST_SOONER)));
        }
        if (amount) {
            facts += factRow(t.FACT_AMOUNT, '<b>' + esc(amount) + '</b>');
        }
        html += '<tr><td align="center" valign="top" class="pad" style="padding:32px 48px 8px 48px;">\n' +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" ' +
            'style="background-color:#ffffff;border:1px solid #e2ded9;border-radius:10px;border-collapse:separate;">\n' +
            '<tr><td align="left" valign="top" style="padding:20px 22px 12px 22px;">\n' +
            emailP('0 0 6px 0', 12, std.TEAL, t.ORDER_LABEL, true) +
            emailP('0 0 8px 0', 19, COLORS.TEXT, orderTitle(o), true) +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n' + facts + '</table>\n' +
            '</td></tr>\n</table>\n</td></tr>\n';

        // The button and the dashboard link under it.
        html += emailButtonRow(m.link, t.BUTTON, 'yellow', '24px 32px 8px');
        html += '<tr><td align="center" valign="top" style="padding:4px 32px 8px;' + EF + 'font-size:15px;">' +
            '<a href="' + esc(m.dashboardLink) + '" target="_blank" style="' + EF + 'font-size:15px;color:' + COLORS.PURPLE +
            ';text-decoration:underline;">' + fontHtml(COLORS.PURPLE, esc(t.DASHBOARD_LINK)) + '</a></td></tr>\n';

        // How it works: three numbered steps; step 1 carries the "need it sooner" line.
        html += '<tr><td align="center" valign="top" class="pad" style="padding:24px 48px 8px 48px;">\n' +
            emailH2(t.HOW_HEADING, std.PURPLE) +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n' +
            stepRow(1, t.STEP1_TITLE, t.STEP1_TEXT.replace('{n}', String(parseInt(m.noticeDays, 10) || 0)),
                '<table role="presentation" width="100%" align="left" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff5dc" ' +
                'style="background-color:#fff5dc;border-radius:6px;margin-top:6px;"><tr><td align="left" valign="top" bgcolor="#fff5dc" ' +
                'style="padding:8px 12px;' + EF + 'font-size:15px;line-height:21px;color:' + COLORS.TEXT + ';">' +
                fontHtml(COLORS.TEXT, soonerHtml(t, m.am)) + '</td></tr></table>') +
            stepRow(2, t.STEP2_TITLE, t.STEP2_TEXT) +
            stepRow(3, t.STEP3_TITLE, o.prepay === false ? t.STEP3_ACCOUNT : t.STEP3_PREPAY) +
            '</table>\n</td></tr>\n';

        // Before you book: the grey panel with three tips, three across (stacked on phones). 2.0.4: each
        // icon is a config.EMAIL_ICONS constant, 48 x 48 above its tip; blank or not https -> text only.
        html += '<tr><td align="center" valign="top" bgcolor="' + std.PANEL + '" class="pad" style="background-color:' + std.PANEL +
            ';padding:28px 30px;">\n' + emailH2(t.TIPS_HEADING, std.MAGENTA, '0 0 18px 0') +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n<tr>\n' +
            t.TIPS.map(function (tip) {
                var icon = icons[tip[2]];
                return '<td class="stack" width="33%" align="center" valign="top" style="padding:0 10px 12px 10px;">\n' +
                    (isHttpsUrl(icon) ? '<img src="' + esc(icon) + '" width="48" height="48" alt="" border="0" ' +
                        'style="display:block;margin:0 auto 8px auto;width:48px;height:48px;">\n' : '') +
                    emailP('0 0 6px 0', 16, COLORS.TEXT, tip[0], true, 'center') +
                    emailP('0', 14, '#4a4650', tip[1], false, 'center') + '</td>\n';
            }).join('') +
            '</tr>\n</table>\n</td></tr>\n';

        return emailShell({
            title: esc(deliveryLinkSubject(t, o.tranId)),
            preheader: esc(t.PREHEADER),
            rows: html,
            cardIntro: emailH2(t.QUESTIONS, std.PURPLE, '4px 0 16px 0'),
            card: emailRepCard(m.am),
            after: emailPersonal(t.PERSONAL),
            footerLine: esc(t.FOOTER)
        });
    }

    // ---------------------------------------------------------------- the projects update (2.0.3)

    var STAGE_INDEX = { quote: 0, ordered: 1, design: 2, delivery: 3, booked: 4, delivered: 4 };

    /** The order states that need the customer: the project is at Delivery. */
    var DELIVERY_STATES = ['ready', 'awaiting_payment', 'requested', 'needs_info'];

    /**
     * Pure (2.0.3): a project's stage on the progress bar.
     *   quote-only                                          -> 'quote'
     *   in design, or needs design information              -> 'design'
     *   any order ready / awaiting payment / requested / needs info -> 'delivery'
     *   every order not yet delivered is released or booked -> 'booked'
     *   only delivered orders                               -> 'delivered'
     * "Ordered" is never current today: no data says an order is placed but not yet in design.
     *
     * @param {Object} project - { kind: 'quote' | 'design' | 'delivery', orders: [{ state }] }
     * @returns {string}
     */
    function projectStage(project) {
        var orders = (project && project.orders) || [];
        var open = [];
        var i;
        if (!project || project.kind === 'quote') {
            return 'quote';
        }
        if (project.kind === 'design') {
            return 'design';
        }
        for (i = 0; i < orders.length; i++) {
            if (DELIVERY_STATES.indexOf(orders[i].state) >= 0) {
                return 'delivery';
            }
            if (orders[i].state !== 'delivered') {
                open.push(orders[i]);
            }
        }
        if (open.length) {
            return 'booked';
        }
        return orders.length ? 'delivered' : 'design';
    }

    /** The last segment's label: "Booked" when the furthest order is booked or released (2.0.3). */
    function lastStageLabel(stage, project) {
        var orders = (project && project.orders) || [];
        var i;
        if (stage === 'booked') {
            return config.DIGEST_EMAIL.STAGE_BOOKED;
        }
        if (stage === 'delivery') {
            for (i = 0; i < orders.length; i++) {
                if (orders[i].state === 'booked' || orders[i].state === 'released') {
                    return config.DIGEST_EMAIL.STAGE_BOOKED;
                }
            }
        }
        return config.DIGEST_EMAIL.STAGES[4];
    }

    /**
     * Pure (2.0.3): one card per project, in the existing section order — "For delivery" (what needs the
     * customer), then design, then quotes, then "Booked deliveries". A project in more than one section
     * is one card, with all its orders, where it first appears.
     * @returns {Array<{opp: Object, kind: string, needsInfo: boolean, orders: Array<{order, state}>, design: Object}>}
     */
    function digestProjects(groups) {
        var cards = [];
        var byId = {};
        function card(opp, kind) {
            var key = String(opp.id);
            if (!byId[key]) {
                byId[key] = { opp: opp, kind: kind, needsInfo: false, orders: [] };
                cards.push(byId[key]);
            }
            return byId[key];
        }
        (groups.forDelivery || []).forEach(function (p) {
            card(p.opp, 'delivery').orders = card(p.opp, 'delivery').orders.concat(p.orders);
        });
        (groups.inDesign || []).forEach(function (p) {
            var c = card(p.opp, 'design');
            c.needsInfo = p.badge === 'needs_info';
            // 2.3: the card state, when the row carries one.
            c.design = p.design || null;
        });
        (groups.toOrder || []).forEach(function (opp) {
            card(opp, 'quote');
        });
        (groups.booked || []).forEach(function (p) {
            var c = card(p.opp, 'delivery');
            c.orders = c.orders.concat(p.orders);
        });
        return cards;
    }

    /**
     * Pure (2.0.3): the summary tile counts. ready / awaiting payment: orders that need the customer;
     * design: projects in design; booked: open orders released or booked (not delivered).
     * @returns {{ready: number, pay: number, design: number, booked: number}}
     */
    function digestCounts(groups) {
        var c = { ready: 0, pay: 0, design: (groups.inDesign || []).length, booked: 0 };
        (groups.forDelivery || []).forEach(function (p) {
            p.orders.forEach(function (st) {
                if (st.state === 'ready') {
                    c.ready++;
                } else if (st.state === 'awaiting_payment') {
                    c.pay++;
                }
            });
        });
        (groups.booked || []).forEach(function (p) {
            p.orders.forEach(function (st) {
                if (st.state === 'booked' || st.state === 'released') {
                    c.booked++;
                }
            });
        });
        return c;
    }

    /** The tile row: one equal cell per non-zero count; '' when every count is zero. */
    function digestTiles(counts) {
        var T = config.DIGEST_EMAIL.TILES;
        var tiles = [[counts.ready, T.READY, '#fff5dc'], [counts.pay, T.PAY, '#e3edf7'], [counts.design, T.DESIGN, '#efe9f1'],
            [counts.booked, T.BOOKED, '#e6f2ec']].filter(function (x) { return x[0] > 0; });
        var width = tiles.length ? Math.floor(100 / tiles.length) : 0;
        if (!tiles.length) {
            return '';
        }
        return '<table role="presentation" class="tiles" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n<tr>\n' +
            tiles.map(function (x) {
                return '<td width="' + width + '%" align="center" valign="top" style="padding:0 6px;">' +
                    '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="' + x[2] +
                    '" style="background-color:' + x[2] + ';border-radius:10px;"><tr><td align="center" valign="top" bgcolor="' + x[2] +
                    '" style="padding:14px 8px;border-radius:10px;">' +
                    emailP('0', 28, COLORS.TEXT, String(x[0]), true, 'center') +
                    emailP('2px 0 0 0', 14, COLORS.TEXT, x[1], true, 'center') + '</td></tr></table></td>\n';
            }).join('') +
            '</tr>\n</table>\n';
    }

    /** "{project} · Order SO… · UFH · {split reference}" */
    function actionSub(opp, o) {
        return [opp.title || opp.tranId, orderMeta(o), o.uniqueRef].filter(function (x) { return !!x; }).join(' · ');
    }

    /**
     * The action box: the ready orders (at most config.DIGEST_EMAIL.ACTION_MAX), each with CHOOSE DATE to
     * its own direct link, and "and {n} more on your projects page" beyond that. '' when nothing is ready.
     */
    function digestActionBox(groups, link, orderLink) {
        var D = config.DIGEST_EMAIL;
        var ready = [];
        var rows = '';
        var i;
        (groups.forDelivery || []).forEach(function (p) {
            p.orders.forEach(function (st) {
                if (st.state === 'ready') {
                    ready.push({ opp: p.opp, order: st.order });
                }
            });
        });
        if (!ready.length) {
            return '';
        }
        for (i = 0; i < ready.length && i < D.ACTION_MAX; i++) {
            rows += '<tr><td align="left" valign="middle" style="padding:12px 12px 12px 0;border-top:1px solid #f3dfae;">' +
                emailP('0 0 2px 0', 15, COLORS.TEXT, orderTitle(ready[i].order), true) +
                emailP('0', 13, COLORS.MUTED, actionSub(ready[i].opp, ready[i].order)) + '</td>' +
                '<td width="150" align="right" valign="middle" style="padding:12px 0;border-top:1px solid #f3dfae;">\n' +
                emailButton(orderLink ? orderLink(ready[i].order.id) : link, D.ACTION_BUTTON, 'yellowSmall') + '</td></tr>\n';
        }
        return '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#fffaf0" ' +
            'style="background-color:#fffaf0;border:2px solid ' + COLORS.CTA + ';border-radius:10px;border-collapse:separate;">\n' +
            '<tr><td align="center" valign="top" bgcolor="#fffaf0" style="padding:18px 20px 8px 20px;">\n' +
            emailP('0 0 8px 0', 18, COLORS.TEXT, ready.length === 1 ? D.ACTION_ONE : D.ACTION_MANY.replace('{n}', ready.length), true, 'center') +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n' + rows + '</table>\n' +
            (ready.length > D.ACTION_MAX ? '<p align="center" style="margin:6px 0 4px 0;' + EF + 'font-size:13px;text-align:center;">' +
                '<a href="' + esc(link) + '" target="_blank" style="color:' + COLORS.PURPLE + ';">' + fontHtml(COLORS.PURPLE,
                    esc(D.ACTION_MORE.replace('{n}', ready.length - D.ACTION_MAX))) + '</a></p>\n' : '') +
            '</td></tr>\n</table>\n';
    }

    /** The progress bar: five equal cells, each a 6px bar (bgcolor) and its label. */
    function progressBar(project) {
        var D = config.DIGEST_EMAIL;
        var std = config.EMAIL_STANDARD;
        var stage = projectStage(project);
        var current = STAGE_INDEX[stage];
        var labels = D.STAGES.slice(0, 4).concat([lastStageLabel(stage, project)]);
        return '<table role="presentation" class="track" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n<tr>\n' +
            labels.map(function (label, i) {
                var color = i === current ? std.BUTTON_BG : i < current ? std.TEAL : '#e2ded9';
                var now = i === current;
                return '<td width="20%" align="center" valign="top" style="padding:0 2px;" data-stage="' +
                    (now ? 'now' : i < current ? 'done' : 'todo') + '">' +
                    '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0"><tr>' +
                    '<td height="6" align="center" valign="top" bgcolor="' + color + '" style="background-color:' + color +
                    ';height:6px;font-size:1px;line-height:1px;border-radius:3px;"><font size="1">&nbsp;</font></td></tr></table>' +
                    '<p align="center" style="margin:6px 0 0 0;' + EF + 'font-size:12px;line-height:15px;text-align:center;color:' +
                    (now ? COLORS.TEXT : COLORS.MUTED) + ';' + (now ? 'font-weight:bold;' : '') + '">' +
                    fontHtml(now ? COLORS.TEXT : COLORS.MUTED, now ? '<b>' + esc(label) + '</b>' : esc(label)) + '</p></td>\n';
            }).join('') +
            '</tr>\n</table>\n';
    }

    /**
     * 2.2: a quote card's labelled lines — the dashboard's quoteFacts() in email markup: "Project stage: …"
     * (stageLabel) and "Expected start: …" (formatMonthYear), only the ones with a value. '' with neither.
     */
    function emailQuoteFacts(opp) {
        var D = config.DIGEST_EMAIL;
        var lines = [];
        var stage = stageLabel(opp && opp.buildStageText);
        var when = dates.formatMonthYear(opp && opp.delDateKey);
        if (stage) {
            lines.push([D.FACT_STAGE, stage]);
        }
        if (when) {
            lines.push([D.FACT_START, when]);
        }
        return lines.map(function (l) {
            return '<p style="margin:2px 0 0 0;' + EF + 'font-size:14px;line-height:20px;color:' + COLORS.MUTED + ';">' +
                fontHtml(COLORS.MUTED, esc(l[0] + ': ')) + fontHtml(COLORS.TEXT, '<b>' + esc(l[1]) + '</b>') + '</p>';
        }).join('');
    }

    /**
     * A project card: the name, the sub-line, the progress bar, then its order rows. 2.2: with no title the
     * heading is the QR number, so the sub-line leaves it out; a quote card adds its labelled lines.
     */
    function projectCard(p, payBacs, designLink) {
        var D = config.DIGEST_EMAIL;
        var T = DESIGN_TEXT;
        var opp = p.opp;
        // 2.3: a design card with a state shows the state's line (an FC-none card: "In design", as before).
        var lines = p.kind === 'design' && p.design && p.design.key !== 'fc_none' ? designCardLines(p) : null;
        var stageText = lines ? lines.join(' ') : p.kind === 'design' ? (p.needsInfo ? D.NEEDS_INFO : D.DESIGNING) :
            p.kind === 'quote' ? D.QUOTE_SENT : opp.siteAddress;
        var k = lines ? p.design.key : '';
        var link = lines && designLink ? designLink(opp.id) : '';
        var designHtml = (k === 'info_partial' && p.design.progress ? emailProgress(p.design.progress) : '') +
            (link && (k === 'needs_info' || k === 'info_partial' || k === 'info_sent') ?
                '<table role="presentation" align="left" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr><td>\n' +
                emailButton(link, (k === 'needs_info' ? T.BUTTON_START : k === 'info_partial' ? T.BUTTON_CONTINUE :
                    T.BUTTON_VIEW).toUpperCase(), k === 'info_sent' ? 'outline' : 'yellowSmall') + '</td></tr></table>\n' : '');
        var sub = [opp.title ? opp.tranId : '', stageText].filter(function (x) { return !!x; }).join(' · ');
        var rows = p.orders.map(function (st) {
            var r = emailOrderRow(opp, st, payBacs);
            return '<tr><td align="left" valign="top" bgcolor="#faf9f7" style="background-color:#faf9f7;padding:12px 20px;' +
                'border-top:1px solid #ece8e3;"><table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0"><tr>' +
                '<td align="left" valign="middle">' + emailP('0', 15, COLORS.TEXT, r.line1, true) +
                (r.ref ? emailP('2px 0 0', 13, COLORS.TEXT, r.ref, true) : '') +
                emailP('2px 0 0', 13, COLORS.MUTED, r.sub) + '</td>' +
                '<td align="right" valign="middle" style="padding-left:12px;white-space:nowrap;">' + emailBadge(r.badgeKind, r.badgeText) +
                '</td></tr></table></td></tr>\n';
        }).join('');
        return '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" ' +
            'style="background-color:#ffffff;border:1px solid #e2ded9;border-radius:10px;border-collapse:separate;">\n' +
            '<tr><td align="left" valign="top" style="padding:16px 20px 12px 20px;">' +
            emailP('0', 18, COLORS.TEXT, opp.title || opp.tranId, true) +
            (sub ? emailP('2px 0 0 0', 14, COLORS.MUTED, sub) : '') + (p.kind === 'quote' ? emailQuoteFacts(opp) : '') +
            designHtml + '</td></tr>\n' +
            '<tr><td align="center" valign="top" style="padding:4px 18px 16px 18px;">\n' + progressBar(p) + '</td></tr>\n' +
            rows + '</table>\n';
    }

    /**
     * 2.2: the explainer paragraph — what the digest is, and, with at least one open quote, where to tell
     * us if a quoted project has changed (the button name in bold).
     */
    function digestExplainer(groups) {
        var D = config.DIGEST_EMAIL;
        var q = D.EXPLAINER_QUOTES;
        return '<p style="margin:0;' + EF + 'font-size:16px;line-height:23px;color:' + COLORS.TEXT + ';">' +
            fontHtml(COLORS.TEXT, esc(D.EXPLAINER) + ((groups.toOrder || []).length ?
                ' ' + esc(q[0]) + '<b>' + esc(q[1]) + '</b>' + esc(q[2]) : '')) + '</p>';
    }

    /**
     * The digest email (2.0.3: EmailDigestV2.dc.html). Pure, snapshot-tested.
     * @param {Object} m - { customerName, greetingName, logoUrl, groups (after data.arrangeSections()), payBacs,
     *                       link (the dashboard), orderLink (function(soId) -> that order's direct delivery
     *                       link; defaults to link), title (the subject), am {name, phone, email, firstName,
     *                       photoUrl}, digestDays, designLink (2.3: function(oppId) -> that project's design
     *                       information link; optional) }
     * @returns {string}
     */
    function digestEmail(m) {
        var groups = m.groups;
        var tiles = digestTiles(digestCounts(groups));
        var action = digestActionBox(groups, m.link, m.orderLink);
        var cards = digestProjects(groups);
        var html = '';
        var body = '';

        html += emailLogo(m.logoUrl);
        html += emailBand('YOUR PROJECTS UPDATE', 'Here’s where everything stands', 'Hello ' + (m.greetingName || m.customerName || ''));

        // 2.2: what this email is, before the tiles; the update button named when there is an open quote.
        body += '<tr><td align="left" valign="top" style="padding:0 0 22px 0;">' + digestExplainer(groups) + '</td></tr>\n';
        if (tiles) {
            body += '<tr><td align="center" valign="top" style="padding:0 0 22px 0;">\n' + tiles + '</td></tr>\n';
        }
        if (action) {
            body += '<tr><td align="center" valign="top" style="padding:0 0 22px 0;">\n' + action + '</td></tr>\n';
        }
        if (cards.length) {
            body += '<tr><td align="left" valign="top" style="padding:6px 0 12px 0;">' +
                '<h2 style="margin:0;' + EF + 'font-size:22px;line-height:27px;font-weight:bold;color:' + COLORS.PURPLE + ';">' +
                fontHtml(COLORS.PURPLE, esc(config.DIGEST_EMAIL.PROJECTS_HEADING)) + '</h2></td></tr>\n';
            body += cards.map(function (p) {
                return '<tr><td align="center" valign="top" style="padding:0 0 16px 0;">\n' + projectCard(p, m.payBacs, m.designLink) +
                    '</td></tr>\n';
            }).join('');
        }
        html += '<tr><td align="center" valign="top" class="pad" style="padding:28px 40px 8px 40px;">\n' +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n' + body +
            '</table>\n</td></tr>\n';

        html += emailButtonRow(m.link, config.DIGEST_EMAIL.BUTTON, 'purple', '6px 32px 4px');

        return emailShell({
            title: esc(m.title || 'Your Nu-Heat projects'),
            preheader: esc(config.EMAIL_STANDARD.DIGEST_PREHEADER),
            rows: html,
            card: emailRepCard(m.am),
            after: emailPersonal('This link is personal to you. Please don’t forward this email.'),
            footerLine: 'You get this update ' + everyText(m.digestDays) +
                ' while you have an open project or order with us.<br>To stop these updates, reply to this email' +
                emailFooterContact(m.am) + '.'
        });
    }

    // ---------------------------------------------------------------- 2.3: "Tell us about your property"

    /**
     * 2.3: the design information wording — the page, and the project cards on the dashboard and in the digest.
     * Plain text: escaped when used. {x} placeholders are filled before escaping.
     */
    var DESIGN_TEXT = {
        TITLE: 'Tell us about your property',
        PROJECT_HEADING: 'Your project, as we have it',
        F_PROJECT: 'Project',
        F_SITE: 'Site address',
        F_REFERENCE: 'Reference',
        F_HAVING: 'You’re having',
        F_THERMOSTATS: 'Thermostats',
        F_NEO_HUB: 'with a Neo hub',
        F_SERVICE: 'Design service',
        F_DESIGNER: 'Your design is with',
        F_CALL: 'Design call',
        CHIP_CHECKED: 'Checked',
        CHIP_TODO: 'Needed to start',
        CHIP_DONE: 'Done',
        CHIP_OPTIONAL: 'Optional',
        REQUIRED: 'Needed',
        WHY: '? Why',
        READ_ONLY: '(we’ll cover this on your call)',
        GOODS_HAVE: 'We currently have: {date}',
        GOODS_ASK: 'Has this changed? Tell us the new date',
        NOTED: 'You sent us this on {date}. Anything new? Add it here.',
        NOTED_NO_DATE: 'You’ve sent us this already. Anything new? Add it here.',
        YES: 'Yes',
        NO: 'No',
        FILES_HAVE: 'Already sent:',
        FILE_N: 'File {n}',
        UPLOADS_OFF: 'We can’t take files here at the moment. Please email them to your Project Engineer instead.',
        BIG_FILE: 'These files are bigger than 10 MB: {names}. Remove them and tick “I have files bigger than 10 MB”, ' +
            'and we’ll send you a secure way to send them.',
        SAVE_SECTION: 'Save this section',
        STILL_TO_DO: 'Still to do before your design can start: {list}.',
        ALL_HERE: 'Everything we need is here. Send it when you’re ready.',
        SEND_PE: 'Send to my Project Engineer',
        SEND_AM: 'Send to my account manager',
        SAVE_LATER: 'Save and finish later',
        GOES_TO: 'Goes to',
        ROLE_PE: 'Your Project Engineer',
        ROLE_AM: 'Your account manager',
        PROGRESS: 'Your progress',
        SERVICES_HEADING: 'What each design service needs',
        SERVICES: [
            ['UFH Design', 'Your plans, and where the manifolds go.'],
            ['UFH Design +', 'As UFH Design, plus how well the property is insulated, for a room-by-room heat loss calculation.'],
            ['HP Design', 'As UFH Design +, plus where the heat pump, cylinder and buffer tank go, and the noise check.']
        ],
        WHY_HEADING: 'Why do we ask?',
        WHY_TEXT: 'Press “? Why” beside a question to see what we use the answer for. We only ask about what’s on ' +
            'your quote.',
        DRAWINGS_HEADING: 'Understanding your drawings',
        DRAWINGS_LINK: 'How to read your installation drawings',
        VIEW_BANNER: 'Your design is being prepared. Need to change something?',
        SAVED: 'Saved.',
        SENT: 'Sent to {name}.',
        SENT_NEXT: '{first} will read it all before your design call.',
        SENT_NEXT_NO_NAME: 'We’ll read it all before your design call.',
        NOT_AVAILABLE: 'This isn’t available right now',
        NOTHING_NEEDED: 'Nothing is needed from you for this project.',
        NOT_HERE: 'That project isn’t waiting for design information.',
        // The project cards (brief §6).
        CARD_NEEDS_INFO: 'We need some information about your property to start your design. Plans are the main thing. ' +
            'It takes about 10 minutes, and you can do it in stages.',
        CARD_HAVE: 'Thanks, we have: {list}.',
        CARD_HAVE_NONE: 'Thanks for what you’ve sent so far.',
        CARD_TODO: 'Still to do: {list}.',
        CARD_TODO_FALLBACK: 'Still to do: a few more details.',
        CARD_READY: 'Everything’s here: press Send when you’re ready.',
        CARD_SENT: 'Information received, {date}. {first} is reviewing it and will go through any questions on your design call.',
        CARD_SENT_NO_NAME: 'Information received, {date}. We’re reviewing it and will go through any questions on your ' +
            'design call.',
        CARD_DESIGNING: 'Your design is being prepared. We’ll email you when your installation drawings are ready.',
        CARD_CALL: 'Design call: {date}',
        BADGE_NEEDS_INFO: 'We need information',
        BADGE_PARTIAL: 'In progress',
        BADGE_SENT: 'Information received',
        BADGE_DESIGNING: 'Designing your system',
        BUTTON_START: 'Tell us about your property',
        BUTTON_CONTINUE: 'Continue',
        BUTTON_VIEW: 'View or add to what you sent',
        BUTTON_VIEW_ONLY: 'View what you sent'
    };

    /** Pure: "{x}" placeholders filled from vals (plain text in, plain text out). */
    function fill(template, vals) {
        return String(template).replace(/\{(\w+)\}/g, function (whole, k) {
            return vals && vals.hasOwnProperty(k) ? String(vals[k]) : whole;
        });
    }

    /** The page's own rules (page({ css })), so every other page stays byte-identical. */
    function designCss() {
        var c = COLORS;
        return [
            '.chip{display:inline-flex;align-items:center;padding:2px 10px;border-radius:11px;font-size:13px;font-weight:600;' +
                'vertical-align:middle;margin-left:8px}',
            '.chip-done{background:' + BADGES.ready.bg + ';color:' + BADGES.ready.fg + '}',
            '.chip-todo{background:' + BADGES.need.bg + ';color:' + BADGES.need.fg + '}',
            '.chip-optional,.chip-checked{background:' + BADGES.quote.bg + ';color:' + BADGES.quote.fg + '}',
            '.dq{display:flex;flex-direction:column;gap:6px;padding-top:14px;border-top:1px solid #ece8e3}',
            '.dq:first-of-type{border-top:0;padding-top:0}',
            '.req{font-size:12px;font-weight:700;color:' + BADGES.need.fg + ';background:' + BADGES.need.bg +
                ';border-radius:8px;padding:1px 7px;margin-left:6px}',
            'details.why{font-size:15px}',
            'details.why > summary{cursor:pointer;color:' + c.PURPLE + ';font-weight:600;display:inline}',
            'details.why > p{margin:6px 0 0;background:' + c.TIP + ';border-radius:8px;padding:10px 12px;color:#3e3b39}',
            '.ro{margin:0;font-size:16px}',
            '.facts{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;font-size:15px}',
            '.facts dt{color:' + c.MUTED + '}.facts dd{margin:0;font-weight:600}',
            '.files{margin:0;padding-left:18px;font-size:14px;color:#3e3b39}',
            '.fin{font:inherit;font-size:15px;max-width:100%}',
            '.prog{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;font-size:15px}',
            '.prog li{display:flex;justify-content:space-between;gap:12px}',
            '.donep{background:' + BADGES.ready.bg + ';color:' + BADGES.ready.fg + ';border-radius:8px;padding:14px 16px}',
            '.donep p{margin:0}.donep p + p{margin-top:6px}',
            '#di-big{display:none}',
            '.secsave{display:flex;justify-content:flex-end}'
        ].join('\n');
    }

    /** A status chip. */
    function chip(kind, text) {
        return '<span class="chip chip-' + esc(kind) + '">' + esc(text) + '</span>';
    }

    function chipFor(status, first) {
        var t = DESIGN_TEXT;
        if (first) {
            return chip('checked', t.CHIP_CHECKED);
        }
        return status === 'done' ? chip('done', t.CHIP_DONE) : status === 'todo' ? chip('todo', t.CHIP_TODO) :
            chip('optional', t.CHIP_OPTIONAL);
    }

    /** 2.4.0: the registry's placeholder, as an attribute ('' when none). */
    function placeholder(q) {
        return q.placeholder ? ' placeholder="' + esc(q.placeholder) + '"' : '';
    }

    /** The "? Why" toggle: HTML/CSS only. */
    function whyToggle(q) {
        return q.why ? '<details class="why"><summary>' + esc(DESIGN_TEXT.WHY) + '</summary><p>' + esc(q.why) + '</p></details>' : '';
    }

    /**
     * One question. qm: { q, value, readOnly, readOnlyText, options ([{value, text}]: @field ids, or the literal
     * labels' indexes), uploaded ([{name, dateText}]), goodsHave ('' or the opportunity's date as shown), notedText }.
     */
    function designQuestion(qm, m) {
        var q = qm.q;
        var t = DESIGN_TEXT;
        var e = m.errors || {};
        var name = 'q_' + q.qid;
        var id = 'di-' + q.qid;
        var off = m.mode === 'view' ? ' disabled' : '';
        var label = esc(q.label) + (q.required && !qm.readOnly ? '<span class="req">' + esc(t.REQUIRED) + '</span>' : '');
        var hint = q.hint ? '<p class="hint" style="margin:0">' + esc(q.hint) + '</p>' : '';
        var html = '<div class="dq" id="q-' + esc(q.qid) + '">';
        var n;
        var i;

        if (q.type === 'info') {
            return html + '<p style="margin:0;font-weight:600">' + esc(q.label) + '</p>' + hint + whyToggle(q) + '</div>';
        }
        if (qm.readOnly) {
            return html + '<p class="lbl" style="margin:0">' + esc(q.label) + '</p>' + whyToggle(q) +
                '<p class="ro">' + esc(qm.readOnlyText || '—') + ' <span class="muted">' + esc(t.READ_ONLY) + '</span></p></div>';
        }
        if (q.type === 'yesno' || q.type === 'choice') {
            html += '<fieldset><legend>' + label + '</legend>' + whyToggle(q) + fieldError(e, q.qid);
            if (q.type === 'yesno') {
                html += '<div class="segs">' + [['yes', t.YES], ['no', t.NO]].map(function (o) {
                    return '<label class="seg"><input class="sr" type="radio" name="' + esc(name) + '" value="' + o[0] + '"' +
                        (qm.value === o[0] ? ' checked' : '') + off + describedBy(e, q.qid) + '><span class="s">' + esc(o[1]) +
                        '</span></label>';
                }).join('') + '</div>';
            } else {
                html += '<div class="opts">' + (qm.options || []).map(function (o) {
                    return '<label class="optc"><input type="radio" name="' + esc(name) + '" value="' + esc(o.value) + '"' +
                        (String(qm.value) === String(o.value) ? ' checked' : '') + off + describedBy(e, q.qid) +
                        '><span><span class="ot">' + esc(o.text) + '</span></span></label>';
                }).join('') + '</div>';
            }
            return html + hint + '</fieldset></div>';
        }
        html += '<label class="lbl" for="' + esc(id) + (q.type === 'files' ? '-1' : '') + '">' + label + '</label>' + whyToggle(q);
        if (qm.goodsHave) {
            html += '<p style="margin:0">' + esc(fill(t.GOODS_HAVE, { date: qm.goodsHave })) + '</p>' +
                '<p class="hint" style="margin:0">' + esc(t.GOODS_ASK) + '</p>';
        }
        if (qm.notedText) {
            html += '<p class="hint" style="margin:0">' + esc(qm.notedText) + '</p>';
        }
        html += fieldError(e, q.qid);
        if (q.type === 'text') {
            html += '<input class="inp" type="text" id="' + esc(id) + '" name="' + esc(name) + '" value="' + esc(qm.value) +
                '" maxlength="300"' + placeholder(q) + off + describedBy(e, q.qid) + '>';
        } else if (q.type === 'long') {
            html += '<textarea class="inp" id="' + esc(id) + '" name="' + esc(name) + '" maxlength="4000"' + placeholder(q) + off +
                describedBy(e, q.qid) + '>' + esc(qm.value) + '</textarea>';
        } else if (q.type === 'date') {
            html += '<input class="inp" type="date" id="' + esc(id) + '" name="' + esc(name) + '" value="' + esc(qm.value) + '"' +
                off + describedBy(e, q.qid) + ' style="max-width:260px">';
        } else if (q.type === 'files') {
            if (!m.uploadsEnabled) {
                html += '<p class="hint" style="margin:0">' + esc(t.UPLOADS_OFF) + '</p>';
            } else {
                n = parseInt(m.maxFiles, 10) || 6;
                for (i = 1; i <= n; i++) {
                    html += '<input class="fin" type="file" id="' + esc(id) + '-' + i + '" name="f_' + esc(q.qid) + '_' + i + '" ' +
                        'accept="' + esc(m.accept) + '" aria-label="' + esc(q.label + ', ' + fill(t.FILE_N, { n: i })) + '"' + off + '>';
                }
            }
            if ((qm.uploaded || []).length) {
                html += '<p class="hint" style="margin:0">' + esc(t.FILES_HAVE) + '</p><ul class="files">' +
                    qm.uploaded.map(function (f) {
                        return '<li>' + esc(f.name) + (f.dateText ? ' <span class="muted">' + esc(f.dateText) + '</span>' : '') + '</li>';
                    }).join('') + '</ul>';
            }
        }
        return html + hint + '</div>';
    }

    /** "Design questions? Call [name] on [phone]" — the page header's contact line. */
    function designQuestionsLine(r) {
        var c = contactParts(r);
        if (!r || !r.name) {
            return '';
        }
        if (c.kind === 'phone') {
            return 'Design questions? Call ' + esc(r.name) + ' on <a href="' + esc(c.href) + '">' + esc(c.text) + '</a>';
        }
        if (c.kind === 'email') {
            return 'Design questions? Email ' + esc(r.name) + ' at <a href="' + esc(c.href) + '">' + esc(c.text) + '</a>';
        }
        return 'Design questions? Contact ' + esc(r.name);
    }

    /** The file-size warning: the server checks too, so it works without script. */
    var DESIGN_SCRIPT = [
        '(function(){var f=document.getElementById("diform"),m=document.getElementById("di-big");if(!f||!m||!f.addEventListener)return;',
        'f.addEventListener("submit",function(e){var ins=f.querySelectorAll("input[type=file]"),big=[],i,j,fs;',
        'for(i=0;i<ins.length;i++){fs=ins[i].files||[];for(j=0;j<fs.length;j++){if(fs[j].size>10485760){big.push(fs[j].name);}}}',
        'if(big.length){e.preventDefault();m.textContent=m.getAttribute("data-msg").replace("{names}",big.join(", "));',
        'm.style.display="block";m.focus();}});})();'
    ].join('');

    // ---------------------------------------------------------------- 2.4.0: the stepper (release 2.3b)

    /** 2.4.0: the stepper's wording. Plain text: escaped when used. */
    var STEP_TEXT = {
        STEP_OF: 'Step {n} of {total}',
        ABOUT_ONE: 'about 1 minute',
        ABOUT: 'about {m} minutes',
        BACK: '← Back: {title}',
        BACK_FIRST: '← Your projects',
        AUTO: 'Saved automatically when you continue',
        NEXT: 'Save and continue →',
        NEXT_LAST: 'Review and send →',
        SAVE_EXIT: 'Save and exit',
        EXIT_REVIEW: 'Back to your projects',
        STUCK: 'Stuck on anything? It’s fine to skip it.',
        STUCK_CALL: '{first} will go through it on your design call on {date}.',
        STUCK_NO_DATE: '{first} will go through it on your design call.',
        STUCK_PHONE: 'Call {phone} if you’d rather talk now.',
        REVIEW_TITLE: 'Review and send',
        REVIEW_INTRO: 'Here’s everything you’ve told us. Check it, change anything with Edit, then send it.',
        NEARLY_ONE: 'Nearly there. One step still needs you: {title}.',
        NEARLY_MANY: 'Nearly there. {n} steps still need you: {list}.',
        SEND_LATER: 'You can send now and finish later, or on your design call.',
        GO_TO: 'Go to {title}',
        EDIT: 'Edit',
        CHIP_CHECKED: 'Checked',
        CHIP_DONE: 'Done',
        CHIP_TODO: 'Still to do',
        NOT_ANSWERED: 'Not answered yet',
        NOTHING_YET: 'Nothing added.',
        GIVEN: 'Given',
        GOES_CALL: 'Your design call is on {date}.',
        SEND_TO: 'Send to {first}',
        SEND_TO_NO_NAME: 'Send it',
        SEND_SUB: 'Sends what you’ve done so far',
        VIEW_REVIEW: 'Your design is being prepared.',
        ADD_FILE: '+ Add another file',
        TAKE_PHOTO: 'Take a photo',
        UPLOADED: 'uploaded {date}',
        SAVED: 'Saved.',
        W_FILES: 'We couldn’t save one of your files. Please try again, or email it to {name}.',
        W_PARTIAL: 'Some answers couldn’t be saved to your project just now, but {name} has them.'
    };

    /** 2.4.0: the stepper's own rules, after designCss(); the phone layout at max-width 600px, CSS only. */
    function stepperCss() {
        var c = COLORS;
        var teal = config.EMAIL_STANDARD.TEAL;
        return [
            '.sbar{list-style:none;margin:0;padding:0;display:flex;align-items:flex-start;gap:0;overflow-x:auto}',
            '.sbar li{flex:1 1 0;display:flex;flex-direction:column;align-items:center;position:relative;min-width:64px}',
            '.sbar li + li::before{content:"";position:absolute;top:15px;right:50%;width:100%;height:3px;background:' + c.BORDER +
                ';z-index:0}',
            '.sbar li.sdone + li::before,.sbar li.sdone::before{background:' + teal + '}',
            '.sstop{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;' +
                'color:' + c.TEXT + ';background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:center}',
            '.scirc{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:16px;border:2px solid ' +
                c.BORDER + ';background:#fff;font-weight:700;font-size:15px}',
            '.sdone .scirc{background:' + teal + ';border-color:' + teal + ';color:#fff}',
            '.scur .scirc{border-color:' + c.PURPLE + ';background:' + c.PURPLE + ';color:#fff}',
            '.stitle{font-size:13px;line-height:1.3;max-width:120px}',
            '.scur .stitle{font-weight:700}',
            '.scurt{display:none;font-weight:700;font-size:15px}',
            '.eyebrow{margin:0;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:' + teal + '}',
            '.navrow{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}',
            '.navrow .auto{font-size:14px;color:' + c.MUTED + '}',
            '.stuck{margin:0;font-size:15px;color:#3e3b39}',
            '.frow{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #ece8e3;border-radius:8px;font-size:14px}',
            '.ftype{flex-shrink:0;font-size:11px;font-weight:700;text-transform:uppercase;background:' + c.TIP + ';border-radius:4px;' +
                'padding:2px 6px}',
            '.fname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.fwhen{flex-shrink:0;color:' + c.MUTED + '}',
            '.fphoto{display:none}',
            '.addf{align-self:flex-start}',
            '.rv{margin:0;display:flex;flex-direction:column;gap:6px;font-size:15px}',
            '.rv dt{color:' + c.MUTED + '}.rv dd{margin:0 0 6px;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}',
            '.rvhead{display:flex;align-items:center;justify-content:space-between;gap:12px}',
            '.rvhead h2{margin:0}',
            '.amber{background:#fdf0d8;color:#6e4400;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}',
            '.amber p{margin:0}',
            '.hdrx{display:flex;align-items:center;gap:16px}',
            '@media (max-width:600px){' +
                '.sbar li{min-width:0}.sbar li .stitle{display:none}' +
                '.scurt{display:block;margin-bottom:6px}' +
                '.navrow{flex-direction:column;align-items:stretch}' +
                '.navrow .cta,.navrow .out,.addf{width:100%}' +
                '.fphoto{display:flex}' +
                '.facts{grid-template-columns:minmax(0,1fr)}' +
                '}'
        ].join('\n');
    }

    /** "about 2 minutes" ('' with none). */
    function aboutText(minutes) {
        var n = parseInt(minutes, 10) || 0;
        return n <= 0 ? '' : n === 1 ? STEP_TEXT.ABOUT_ONE : fill(STEP_TEXT.ABOUT, { m: n });
    }

    /** The extension badge text: "PDF", "DWG", ... ("FILE" without one). */
    function fileBadge(name) {
        var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
        return m ? m[1].toUpperCase() : 'FILE';
    }

    /**
     * 2.4.0 (brief §4): the file control — the files already sent as rows (no Remove: they are the PE's record), ONE
     * input by default, more revealed by "+ Add another file" (a submit, more=<qid>: the server saves and re-renders with
     * one more; with script the next hidden input is shown instead), and on a phone a "Take a photo" input (camera). Every
     * input is one of f_<qid>_1..max, so the server is unchanged: f_<qid>_1..max-1 are the files, f_<qid>_<max> the photo.
     */
    function fileControl(qm, m, off) {
        var q = qm.q;
        var t = STEP_TEXT;
        var max = parseInt(m.maxFiles, 10) || 6;
        var regular = max > 1 ? max - 1 : 1;
        var shown = Math.max(1, Math.min(regular, parseInt((m.more || {})[q.qid], 10) || 1));
        var id = 'di-' + q.qid;
        var html = '';
        var i;
        if ((qm.uploaded || []).length) {
            html += qm.uploaded.map(function (f) {
                return '<div class="frow"><span class="ftype">' + esc(fileBadge(f.name)) + '</span><span class="fname" title="' +
                    esc(f.name) + '">' + esc(f.name) + '</span>' + (f.dateText ? '<span class="fwhen">' +
                    esc(fill(t.UPLOADED, { date: f.dateText })) + '</span>' : '') + '</div>';
            }).join('');
        }
        if (!m.uploadsEnabled) {
            return html + '<p class="hint" style="margin:0">' + esc(DESIGN_TEXT.UPLOADS_OFF) + '</p>';
        }
        html += '<input type="hidden" name="more_' + esc(q.qid) + '" value="' + shown + '">';
        for (i = 1; i <= regular; i++) {
            html += '<input class="fin" type="file" id="' + esc(id) + '-' + i + '" name="f_' + esc(q.qid) + '_' + i + '" accept="' +
                esc(m.accept) + '" aria-label="' + esc(q.label + ', ' + fill(DESIGN_TEXT.FILE_N, { n: i })) + '"' +
                (i > shown ? ' hidden' : '') + off + '>';
        }
        if (shown < regular) {
            html += '<button type="submit" class="out addf" name="more" value="' + esc(q.qid) + '" data-qid="' + esc(q.qid) + '"' +
                off + '>' + esc(t.ADD_FILE) + '</button>';
        }
        if (max > 1) {
            html += '<label class="out addf fphoto" for="' + esc(id) + '-photo">' + esc(t.TAKE_PHOTO) + '</label>' +
                '<input class="sr" type="file" id="' + esc(id) + '-photo" name="f_' + esc(q.qid) + '_' + max + '" accept="image/*" ' +
                'capture="environment"' + off + '>';
        }
        return html;
    }

    /**
     * 2.4.0: the script — the 10 MB warning (2.3) and "+ Add another file" without a round trip: the next hidden input is
     * shown and the button hidden when none is left. Without script both still work (the server checks; the button posts).
     */
    var STEPPER_SCRIPT = DESIGN_SCRIPT + [
        '(function(){if(!document.querySelectorAll)return;var bs=document.querySelectorAll("button[data-qid]"),i;',
        'for(i=0;i<bs.length;i++){bs[i].addEventListener("click",function(e){var q=this.getAttribute("data-qid"),',
        'ins=document.querySelectorAll("input[name^=\\"f_"+q+"_\\"][hidden]");if(!ins.length)return;e.preventDefault();',
        'ins[0].hidden=false;ins[0].focus();var h=document.querySelector("input[name=\\"more_"+q+"\\"]");',
        'if(h){h.value=String((parseInt(h.value,10)||1)+1);}if(ins.length<2){this.hidden=true;}});}})();'
    ].join('');

    /**
     * The step bar: every step, then Review. In a step's form each stop is a submit (goto=<id>, form="diform"), so
     * moving on saves what was typed; on Review (no form fields) each is a link. Done steps tick and turn teal.
     */
    function stepBar(m, inForm) {
        var stops = (m.steps || []).concat([{ id: 'review', title: STEP_TEXT.REVIEW_TITLE, status: '', href: m.reviewHref }]);
        var current = '';
        var html = stops.map(function (s, i) {
            var cls = (s.status === 'done' ? 'sdone' : '') + (s.id === m.currentId ? ' scur' : '');
            var inner = '<span class="scirc" aria-hidden="true">' + (s.status === 'done' ? '✓' : (i + 1)) + '</span>' +
                '<span class="stitle">' + esc(s.title) + '</span>';
            var label = esc(fill(STEP_TEXT.STEP_OF, { n: i + 1, total: stops.length }) + ': ' + s.title +
                (s.status === 'done' ? ', done' : ''));
            if (s.id === m.currentId) {
                current = s.title;
            }
            return '<li class="' + cls + '">' + (inForm ? '<button type="submit" class="sstop" form="diform" name="goto" value="' +
                esc(s.id) + '" aria-label="' + label + '"' + (s.id === m.currentId ? ' aria-current="step"' : '') + '>' + inner +
                '</button>' : '<a class="sstop" href="' + esc(s.href) + '" aria-label="' + label + '"' +
                (s.id === m.currentId ? ' aria-current="step"' : '') + '>' + inner + '</a>') + '</li>';
        }).join('');
        return '<nav aria-label="Steps"><p class="scurt">' + esc(current) + '</p><ol class="sbar">' + html + '</ol></nav>';
    }

    /** The read-only facts of step 1 (2.3's "Your project, as we have it"). */
    function projectFacts(m) {
        var t = DESIGN_TEXT;
        var r = m.recipient || {};
        function row(label, value) {
            return value ? '<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>' : '';
        }
        return '<section class="card" aria-labelledby="h-facts"><h2 id="h-facts">' + esc(t.PROJECT_HEADING) + '</h2><dl class="facts">' +
            row(t.F_PROJECT, m.opp.title || m.opp.tranId) + row(t.F_REFERENCE, m.opp.title ? m.opp.tranId : '') +
            row(t.F_SITE, String(m.opp.siteAddress || '').replace(/\s*\r?\n\s*/g, ', ')) + row(t.F_HAVING, m.project.havingText) +
            row(t.F_THERMOSTATS, [m.project.thermostatsText, m.project.neoHub ? t.F_NEO_HUB : ''].filter(function (x) {
                return !!x;
            }).join(' ')) + row(t.F_SERVICE, m.project.serviceText) + row(t.F_DESIGNER, r.name) +
            row(t.F_CALL, m.project.callKey ? shortDate(m.project.callKey) : '') + '</dl></section>';
    }

    /** The banners shared by the step and the review: saved, warnings, errors. */
    function stepNotices(m) {
        var html = '';
        if (m.confirmation) {
            html += '<div class="donep" role="status">' + m.confirmation.lines.map(function (l) {
                return '<p>' + esc(l) + '</p>';
            }).join('') + '</div>';
        }
        if (m.notice) {
            html += '<div class="notice" role="status">' + esc(m.notice) + '</div>';
        }
        if (m.errors && Object.keys(m.errors).length) {
            html += '<div class="notice" role="alert">Please check the highlighted answers below. Nothing has been saved yet.</div>';
        }
        return html;
    }

    /** "Save and exit" in the header (a submit of the step's form, by its form attribute). */
    function saveExit(m) {
        // The form's default button (Enter in a text box) is its first submit button in document order: a hidden "next"
        // ahead of Save and exit, so Enter continues rather than leaving.
        return m.mode === 'view' ? '' : '<button type="submit" class="sr" form="diform" name="nav" value="next" tabindex="-1" ' +
            'aria-hidden="true">' + esc(STEP_TEXT.NEXT) + '</button><button type="submit" class="out" form="diform" name="nav" ' +
            'value="exit">' + esc(STEP_TEXT.SAVE_EXIT) + '</button>';
    }

    /**
     * 2.4.0 (brief §3.3): one step of the design information page.
     * @param {Object} m - { logoUrl, recipient ({ name, firstName, phone, email, role }), opp ({ id, tranId, title,
     *   siteAddress }), project ({ havingText, thermostatsText, neoHub, serviceText, callKey }), token, actionUrl, backUrl,
     *   mode, errors, notice, confirmation, maxFiles, accept, uploadsEnabled, steps: [{ id, title, status, href }],
     *   currentId, firstId, reviewHref, step: { id, title, intro, minutes, n (1-based), questions: [qm],
     *   prev: { id, title }|null, last: boolean }, more (qid -> file inputs shown), callKey }
     */
    function designInfoStep(m) {
        var t = STEP_TEXT;
        var st = m.step;
        var total = (m.steps || []).length + 1;
        var r = m.recipient || {};
        var off = '';
        var panels = [];
        var byPanel = {};
        var body;
        var about = aboutText(st.minutes);
        var stuck;

        st.questions.forEach(function (qm) {
            var p = qm.q.panel || 'main';
            if (!byPanel[p]) {
                byPanel[p] = [];
                panels.push(p);
            }
            byPanel[p].push(qm);
        });

        body = stepBar(m, true) + stepNotices(m) +
            '<p id="di-big" class="notice" role="alert" tabindex="-1" data-msg="' + esc(DESIGN_TEXT.BIG_FILE) + '"></p>' +
            '<section class="card" aria-labelledby="h-step"><p class="eyebrow">' +
            esc(fill(t.STEP_OF, { n: st.n, total: total }) + (about ? ' · ' + about : '')) + '</p>' +
            '<h1 id="h-step">' + esc(st.title) + '</h1>' + (st.intro ? '<p class="lead" style="margin:0">' + esc(st.intro) + '</p>' : '') +
            '</section>' + (st.id === m.firstId ? projectFacts(m) : '') +
            '<form id="diform" class="fcol" method="post" enctype="multipart/form-data" action="' + esc(m.actionUrl) +
            '" accept-charset="utf-8">' +
            '<input type="hidden" name="t" value="' + esc(m.token) + '">' +
            '<input type="hidden" name="a" value="designinfo">' +
            '<input type="hidden" name="opp" value="' + esc(m.opp.id) + '">' +
            '<input type="hidden" name="step" value="' + esc(st.id) + '">';
        panels.forEach(function (p) {
            body += '<section class="card">' + byPanel[p].map(function (qm) {
                return qm.q.type === 'files' ? designFileQuestion(qm, m, off) : designQuestion(qm, m);
            }).join('') + '</section>';
        });
        // The nav row: Back saves first; on the first step it is a link to the dashboard.
        body += '<div class="navrow">' + (st.prev ? '<button type="submit" class="out" name="nav" value="back">' +
            esc(fill(t.BACK, { title: st.prev.title })) + '</button>' : '<a class="out" href="' + esc(m.backUrl) + '">' +
            esc(t.BACK_FIRST) + '</a>') + '<span class="auto">' + esc(t.AUTO) + '</span>' +
            '<button type="submit" class="cta" name="nav" value="next">' + esc(st.last ? t.NEXT_LAST : t.NEXT) + '</button></div>';
        stuck = t.STUCK + (r.firstName ? ' ' + fill(m.callKey ? t.STUCK_CALL : t.STUCK_NO_DATE, { first: r.firstName,
            date: m.callKey ? shortDate(m.callKey) : '' }) : '') + (r.phone ? ' ' + fill(t.STUCK_PHONE, { phone: r.phone }) : '');
        body += '<p class="stuck">' + esc(stuck) + '</p></form>';

        return page({ title: st.title + ' · ' + DESIGN_TEXT.TITLE, logoUrl: m.logoUrl, am: r, header: 'design', width: 'w1120',
            body: body, css: '\n' + designCss() + '\n' + stepperCss(), script: STEPPER_SCRIPT, headerExtra: saveExit(m) });
    }

    /** A files question in the stepper: label, why, hint, then the file control. */
    function designFileQuestion(qm, m, off) {
        var q = qm.q;
        return '<div class="dq" id="q-' + esc(q.qid) + '"><label class="lbl" for="di-' + esc(q.qid) + '-1">' + esc(q.label) +
            (q.required ? '<span class="req">' + esc(DESIGN_TEXT.REQUIRED) + '</span>' : '') + '</label>' + whyToggle(q) +
            (q.hint ? '<p class="hint" style="margin:0">' + esc(q.hint) + '</p>' : '') + fieldError(m.errors || {}, q.qid) +
            fileControl(qm, m, off) + '</div>';
    }

    /** Review: a section's rows in question order; the unanswered ones only in a step still to do. */
    function rowsOf(s) {
        return (s.rows || []).filter(function (x) { return !!x.value || s.status === 'todo'; });
    }

    /**
     * 2.4.0 (brief §3.4): Review and send. Every shown step with its answers and an Edit link; the steps still to do
     * flagged at the top; Send (send=1) at the foot. View mode: no Edit, no Send, "Your design is being prepared".
     * @param {Object} m - { ..., steps, reviewHref, review: [{ id, title, status, href, rows: [{label, value}]
     *   in question order, value '' when unanswered }], todo: [{ id, title, href }], callKey, drawingsUrl, confirmation }
     */
    function designInfoReview(m) {
        var t = STEP_TEXT;
        var r = m.recipient || {};
        var view = m.mode === 'view';
        var first = r.firstName || '';
        var how;
        var body = stepBar(m, false) + stepNotices(m) +
            '<section class="card"><h1>' + esc(t.REVIEW_TITLE) + '</h1><p class="lead" style="margin:0">' + esc(oppLine(m.opp)) +
            '</p>' + (view ? '' : '<p class="q-help">' + esc(t.REVIEW_INTRO) + '</p>') + '</section>';

        if (view) {
            how = r.email ? 'Send a note to <a href="mailto:' + esc(r.email) + '">' + esc(r.name || r.email) + '</a>' : '';
            if (r.phone) {
                how += (how ? ' or call ' : 'Call ') + esc(r.name || 'us') + ' on <a href="' + esc(telHref(r.phone)) + '">' +
                    esc(r.phone) + '</a>';
            }
            body += '<div class="notice" role="status">' + esc(t.VIEW_REVIEW) + (how ? ' Need to change something? ' + how + '.' : '') +
                '</div>';
        } else if ((m.todo || []).length) {
            body += '<div class="amber" role="status"><p><strong>' + esc(m.todo.length === 1 ? fill(t.NEARLY_ONE, { title: m.todo[0].title }) :
                fill(t.NEARLY_MANY, { n: m.todo.length, list: m.todo.map(function (x) { return x.title; }).join(', ') })) +
                '</strong></p><p>' + esc(t.SEND_LATER) + '</p><p><a class="out" href="' + esc(m.todo[0].href) + '">' +
                esc(fill(t.GO_TO, { title: m.todo[0].title })) + '</a></p></div>';
        }

        (m.review || []).forEach(function (s) {
            var chipHtml = s.status === 'done' ? chip('done', t.CHIP_DONE) : s.status === 'todo' ? chip('todo', t.CHIP_TODO) :
                chip('checked', t.CHIP_CHECKED);
            body += '<section class="card" aria-labelledby="rv-' + esc(s.id) + '"><div class="rvhead"><h2 id="rv-' + esc(s.id) + '">' +
                esc(s.title) + chipHtml + '</h2>' + (view ? '' : '<a href="' + esc(s.href) + '">' + esc(t.EDIT) +
                '<span class="sr" style="position:absolute"> ' + esc(s.title) + '</span></a>') + '</div>' +
                (rowsOf(s).length ? '<dl class="rv">' + rowsOf(s).map(function (x) {
                    return x.value ? '<dt>' + esc(x.label) + '</dt><dd>' + esc(x.value) + '</dd>' : '<dt>' + esc(x.label) +
                        '</dt><dd class="muted" style="font-weight:400">' + esc(t.NOT_ANSWERED) + '</dd>';
                }).join('') + '</dl>' : '<p class="muted" style="margin:0">' + esc(t.NOTHING_YET) + '</p>') + '</section>';
        });

        body += '<section class="card"><div class="goes"><span class="cap">' + esc(DESIGN_TEXT.GOES_TO) + '</span><span class="amn">' +
            esc(r.name || (r.role === 'pe' ? DESIGN_TEXT.ROLE_PE : DESIGN_TEXT.ROLE_AM)) + '</span></div>' +
            (m.callKey ? '<p class="q-help">' + esc(fill(t.GOES_CALL, { date: shortDate(m.callKey) })) + '</p>' : '') +
            (view ? '' : '<form id="diform" method="post" enctype="multipart/form-data" action="' + esc(m.actionUrl) +
                '" accept-charset="utf-8"><input type="hidden" name="t" value="' + esc(m.token) + '">' +
                '<input type="hidden" name="a" value="designinfo"><input type="hidden" name="opp" value="' + esc(m.opp.id) + '">' +
                '<input type="hidden" name="step" value="review"><div class="submitrow"><button type="submit" class="cta" name="send" ' +
                'value="1">' + esc(first ? fill(t.SEND_TO, { first: first }) : t.SEND_TO_NO_NAME) + '</button><span class="meta">' +
                esc(t.SEND_SUB) + '</span></div></form>') +
            (m.drawingsUrl ? '<p class="q-help"><a href="' + esc(m.drawingsUrl) + '" target="_blank" rel="noopener">' +
                esc(DESIGN_TEXT.DRAWINGS_LINK) + '</a></p>' : '') + '</section>';

        return page({ title: t.REVIEW_TITLE + ' · ' + DESIGN_TEXT.TITLE, logoUrl: m.logoUrl, am: r, header: 'design',
            width: 'w1120', body: body, css: '\n' + designCss() + '\n' + stepperCss(),
            headerExtra: view ? '' : '<a class="out" href="' + esc(m.backUrl) + '">' + esc(STEP_TEXT.EXIT_REVIEW) + '</a>' });
    }

    /**
     * 2.3: the design information action cannot run (no registry, or the project is not waiting for information).
     * @param {Object} m - { logoUrl, am, backUrl, text }
     */
    function designInfoMessagePage(m) {
        return page({ title: DESIGN_TEXT.TITLE, logoUrl: m.logoUrl, am: m.am, header: 'none', width: 'w600',
            body: '<div class="card"><p style="margin:0">' + esc(m.text) + (questionsLine(m.am) ? ' ' + questionsLine(m.am) + '.' : '') +
                '</p></div><a class="back" href="' + esc(m.backUrl) + '">Back to your projects</a>' });
    }

    // ---------------------------------------------------------------- 2.3: the design cards (brief §6)

    /** Pure: the card's text lines for a design row with d.design. Plain text. */
    function designCardLines(d) {
        var t = DESIGN_TEXT;
        var g = d.design;
        var lines = [];
        var p = g.progress;
        if (g.key === 'needs_info') {
            lines.push(t.CARD_NEEDS_INFO);
        } else if (g.key === 'info_partial') {
            lines.push((p && p.done.length ? fill(t.CARD_HAVE, { list: p.done.join(', ') }) : t.CARD_HAVE_NONE) + ' ' +
                (!p ? t.CARD_TODO_FALLBACK : p.missing.length ? fill(t.CARD_TODO, { list: p.missing.join(', ') }) : t.CARD_READY));
        } else if (g.key === 'info_sent') {
            lines.push(fill(g.peFirst ? t.CARD_SENT : t.CARD_SENT_NO_NAME, { date: shortDate(g.sentKey) || 'recently',
                first: g.peFirst }));
        } else if (g.key === 'designing') {
            lines.push(t.CARD_DESIGNING);
        }
        if (g.callKey && g.key !== 'fc_none') {
            lines.push(fill(t.CARD_CALL, { date: shortDate(g.callKey) }));
        }
        return lines;
    }

    /** The page's progress bar: decorative, the text says it. */
    function pageProgress(p) {
        return p ? '<span class="pbar" aria-hidden="true"><span style="width:' + Math.max(0, Math.min(100, p.pct)) +
            '%"></span></span>' : '';
    }

    /** The dashboard row of a project in design (2.3: the four card states; FC none as before). */
    function designRow(d, m) {
        var t = DESIGN_TEXT;
        var g = d.design;
        var url = m.designInfoUrl ? m.designInfoUrl(d.opp.id) : '';
        var lines = designCardLines(d);
        var meta = lines.map(function (l) { return '<span class="meta">' + esc(l) + '</span>'; }).join('');
        var badgeHtml;
        var acts;
        if (g.key === 'needs_info') {
            badgeHtml = badge('need', t.BADGE_NEEDS_INFO);
            acts = url ? '<a class="cta" href="' + esc(url) + '">' + esc(t.BUTTON_START) + '</a>' :
                '<span class="meta">' + AM_IN_TOUCH + '</span>';
        } else if (g.key === 'info_partial') {
            badgeHtml = badge('need', t.BADGE_PARTIAL);
            meta += pageProgress(g.progress);
            acts = url ? '<a class="cta" href="' + esc(url) + '">' + esc(t.BUTTON_CONTINUE) + '</a>' :
                '<span class="meta">' + AM_IN_TOUCH + '</span>';
        } else if (g.key === 'info_sent') {
            badgeHtml = badge('work', t.BADGE_SENT);
            acts = url ? '<a class="out" href="' + esc(url) + '">' + esc(t.BUTTON_VIEW) + '</a>' :
                '<span class="meta">' + NOTHING_NEEDED + '</span>';
        } else {
            badgeHtml = badge('work', t.BADGE_DESIGNING);
            acts = '<span class="meta">' + NOTHING_NEEDED + '</span>' + (g.key === 'designing' && g.anySaved && url ?
                '<a class="out" href="' + esc(url) + '">' + esc(t.BUTTON_VIEW_ONLY) + '</a>' : '');
        }
        return '<div class="row">' + projectCell(d.opp) + '<div class="cell">' + badgeHtml + meta + '</div>' +
            '<div class="acts">' + acts + '</div></div>';
    }

    /** The dashboard's extra rules when a design row has a card (page({ css })). */
    var DESIGN_ROW_CSS = '\n.pbar{display:block;height:6px;border-radius:3px;background:#e2ded9;overflow:hidden;margin-top:4px;max-width:240px}' +
        '\n.pbar > span{display:block;height:6px;background:' + COLORS.CTA + '}';

    /** The email-safe progress bar: two bgcolor cells. */
    function emailProgress(p) {
        var pct = Math.max(0, Math.min(100, p.pct));
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>' +
            (pct > 0 ? '<td width="' + pct + '%" height="6" bgcolor="' + COLORS.CTA + '" style="background-color:' + COLORS.CTA +
                ';height:6px;font-size:1px;line-height:1px;"><font size="1">&nbsp;</font></td>' : '') +
            (pct < 100 ? '<td height="6" bgcolor="#e2ded9" style="background-color:#e2ded9;height:6px;font-size:1px;line-height:1px;">' +
                '<font size="1">&nbsp;</font></td>' : '') + '</tr></table>';
    }

    // ---------------------------------------------------------------- 2.3: the request email (brief §7.3)

    /** Pure: the request email's subject. */
    function designInfoRequestSubject(text) {
        return String((text || config.DESIGNINFO_EMAIL).SUBJECT);
    }

    /**
     * 2.3 (brief §7.3): "Tell us about your property" — composed from the email shell, as the delivery-link email.
     * Pure.
     * @param {Object} m - { text (config.parseDesignInfoEmail().text), customerName, greetingName, logoUrl,
     *   opp ({ tranId, title, siteAddress }), havingText, callKey ('' or the design call, today or later), goodsKey,
     *   link (the direct link), dashboardLink, sender ({ name, firstName, phone, email, photoUrl }: the card; email
     *   already DESIGN_EMAIL_ADDRESS when it applies), senderRole ('pe'|'am'), peName (the PE's name for the AM
     *   variant, '' when none), steps ({ insulation: boolean, heatPump: boolean }) }
     * @returns {string}
     */
    function designInfoRequestEmail(m) {
        var t = m.text || config.DESIGNINFO_EMAIL;
        var std = config.EMAIL_STANDARD;
        var hero = config.EMAIL_HERO_URL;
        var name = m.greetingName || m.customerName || '';
        var sender = m.sender || {};
        var senderFirst = resolveFirstName(sender.firstName, sender.name) || sender.name || 'your Nu-Heat team';
        var facts = '';
        var html = '';
        var n = 0;
        var personal;
        var ref = [m.opp && m.opp.tranId, m.opp && String(m.opp.siteAddress || '').replace(/\s*\r?\n\s*/g, ', ')]
            .filter(function (x) { return !!x; }).join(' · ');

        html += emailLogo(m.logoUrl);
        html += emailBand(t.EYEBROW, name ? fill(t.HEADING, { name: name }) : t.HEADING_NO_NAME, t.SUB);
        if (isHttpsUrl(hero)) {
            html += '<tr><td align="center" valign="top"><img src="' + esc(hero) + '" width="' + config.EMAIL_HERO_WIDTH +
                '" height="' + config.EMAIL_HERO_HEIGHT + '" alt="" border="0" class="fluid" style="display:block;width:100%;' +
                'max-width:600px;height:auto;"></td></tr>\n';
        }

        // The personal paragraph: the PE's own words, or the account manager's.
        personal = fill(m.senderRole === 'pe' ? t.PERSONAL_PE : t.PERSONAL_AM, { sender: senderFirst,
            pe: m.peName || t.PE_NONE });
        html += '<tr><td align="left" valign="top" class="pad" style="padding:28px 48px 4px 48px;">' +
            emailP('0 0 12px 0', 17, COLORS.TEXT, name ? fill(t.HELLO, { name: name }) : t.HELLO_NO_NAME) +
            emailP('0', 17, COLORS.TEXT, personal) + '</td></tr>\n';

        // "Your project".
        if (ref) {
            facts += factRow(t.FACT_REFERENCE, '<b>' + esc(ref) + '</b>');
        }
        if (m.havingText) {
            facts += factRow(t.FACT_HAVING, '<b>' + esc(m.havingText) + '</b>');
        }
        if (m.callKey) {
            facts += factRow(t.FACT_CALL, '<b>' + esc(shortDate(m.callKey)) + '</b>');
        }
        if (m.goodsKey) {
            facts += factRow(t.FACT_GOODS, '<b>' + esc(shortDate(m.goodsKey)) + '</b>');
        }
        html += '<tr><td align="center" valign="top" class="pad" style="padding:24px 48px 8px 48px;">\n' +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" ' +
            'style="background-color:#ffffff;border:1px solid #e2ded9;border-radius:10px;border-collapse:separate;">\n' +
            '<tr><td align="left" valign="top" style="padding:20px 22px 12px 22px;">\n' +
            emailP('0 0 6px 0', 12, std.TEAL, t.FACTS_LABEL, true) +
            emailP('0 0 8px 0', 19, COLORS.TEXT, (m.opp && (m.opp.title || m.opp.tranId)) || 'Your project', true) +
            (facts ? '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n' + facts +
                '</table>\n' : '') +
            '</td></tr>\n</table>\n</td></tr>\n';

        html += emailButtonRow(m.link, t.BUTTON, 'yellow', '24px 32px 8px');
        html += '<tr><td align="center" valign="top" style="padding:4px 32px 8px;' + EF + 'font-size:15px;">' +
            '<a href="' + esc(m.dashboardLink) + '" target="_blank" style="' + EF + 'font-size:15px;color:' + COLORS.PURPLE +
            ';text-decoration:underline;">' + fontHtml(COLORS.PURPLE, esc(t.DASHBOARD_LINK)) + '</a></td></tr>\n';

        // What we'll ask: the plans; the insulation unless UFH Design; where things go (+ the heat pump).
        html += '<tr><td align="center" valign="top" class="pad" style="padding:24px 48px 8px 48px;">\n' +
            emailH2(t.ASK_HEADING, std.PURPLE) +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n';
        n += 1;
        html += stepRow(n, t.STEP1_TITLE, t.STEP1_TEXT);
        if (m.steps && m.steps.insulation) {
            n += 1;
            html += stepRow(n, t.STEP2_TITLE, t.STEP2_TEXT);
        }
        n += 1;
        html += stepRow(n, t.STEP3_TITLE, t.STEP3_TEXT + (m.steps && m.steps.heatPump ? ' ' + t.STEP3_HP : ''));
        html += '</table>\n' +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff5dc" ' +
            'style="background-color:#fff5dc;border-radius:6px;"><tr><td align="left" valign="top" bgcolor="#fff5dc" ' +
            'style="padding:12px 14px;' + EF + 'font-size:15px;line-height:21px;color:' + COLORS.TEXT + ';">' +
            fontHtml(COLORS.TEXT, esc(t.NOTE)) + '</td></tr></table>\n</td></tr>\n';

        // What happens next: three tips, three across (stacked on phones).
        html += '<tr><td align="center" valign="top" bgcolor="' + std.PANEL + '" class="pad" style="background-color:' + std.PANEL +
            ';padding:28px 30px;">\n' + emailH2(t.NEXT_HEADING, std.MAGENTA, '0 0 18px 0') +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n<tr>\n' +
            t.TIPS.map(function (tip) {
                return '<td class="stack" width="33%" align="center" valign="top" style="padding:0 10px 12px 10px;">\n' +
                    emailP('0 0 6px 0', 16, COLORS.TEXT, tip[0], true, 'center') +
                    emailP('0', 14, '#4a4650', tip[1], false, 'center') + '</td>\n';
            }).join('') +
            '</tr>\n</table>\n</td></tr>\n';

        return emailShell({
            title: esc(designInfoRequestSubject(t)),
            preheader: esc(t.PREHEADER),
            rows: html,
            cardIntro: emailH2(t.QUESTIONS, std.PURPLE, '4px 0 16px 0'),
            card: emailRepCard(sender, m.senderRole === 'pe' ? t.CARD_PE : t.CARD_AM),
            after: emailPersonal(t.PERSONAL),
            footerLine: esc(t.FOOTER)
        });
    }

    return {
        VERSION: VERSION,
        COLORS: COLORS,
        BADGES: BADGES,
        INVALID_LINK_TEXT: INVALID_LINK_TEXT,
        esc: esc,
        orderTitle: orderTitle,
        stageLabel: stageLabel,
        plannedDate: plannedDate,
        PLANNED_TEXT: PLANNED_TEXT,
        quoteFacts: quoteFacts,
        contactParts: contactParts,
        questionsLine: questionsLine,
        formatMoney: formatMoney,
        amountText: amountText,
        NOTHING_TO_PAY: NOTHING_TO_PAY,
        css: css,
        page: page,
        invalidPage: invalidPage,
        errorPage: errorPage,
        dashboard: dashboard,
        deliveryForm: deliveryForm,
        confirmation: confirmation,
        CONFIRM_TEXT: CONFIRM_TEXT,
        DELIVERY_TEXT: DELIVERY_TEXT,
        UPDATE_TEXT: UPDATE_TEXT,
        updatePage: updatePage,
        updateDone: updateDone,
        lostDone: lostDone,
        unavailablePage: unavailablePage,
        digestRows: digestRows,
        digestCallout: digestCallout,
        digestEmail: digestEmail,
        digestExplainer: digestExplainer,
        emailOrderRow: emailOrderRow,
        emailShell: emailShell,
        emailLogo: emailLogo,
        emailBand: emailBand,
        emailButton: emailButton,
        emailRepCard: emailRepCard,
        resolveFirstName: resolveFirstName,
        amContact: amContact,
        amountToPayText: amountToPayText,
        projectStage: projectStage,
        digestProjects: digestProjects,
        digestCounts: digestCounts,
        deliveryLinkSubject: deliveryLinkSubject,
        deliveryLinkEmail: deliveryLinkEmail,
        // 2.3
        DESIGN_TEXT: DESIGN_TEXT,
        designInfoStep: designInfoStep,
        designInfoReview: designInfoReview,
        STEP_TEXT: STEP_TEXT,
        designInfoMessagePage: designInfoMessagePage,
        designCardLines: designCardLines,
        designInfoRequestSubject: designInfoRequestSubject,
        designInfoRequestEmail: designInfoRequestEmail
    };
});
