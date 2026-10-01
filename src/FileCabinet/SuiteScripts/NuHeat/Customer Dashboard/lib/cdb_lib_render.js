/**
 * cdb_lib_render.js
 *
 * HTML strings: the page shell, the dashboard, the delivery form, the confirmations and the digest
 * email. Pure: no NetSuite module of its own (2.0.2: it reads constants from cdb_lib_config). Every value from a record, a parameter or a request goes
 * through esc(), exactly once.
 *
 * THE DESIGN SOURCE is docs/design/canvas/ (release 1.1): Main, Mobile, Delivery, ConfirmBacs,
 * ConfirmCard and Email. Order and Update are release 2 and are not built. Anything the canvas
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
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 2.0.2
 */
define(['./cdb_lib_dates', './cdb_lib_config'], function (dates, config) {

    'use strict';

    var VERSION = '2.0.2';

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
     * Pure: an order's amount as the customer sees it — '' when there is none to show (unknown, or
     * an account order), "Nothing left to pay on this order" at 0, else "£1,234.50".
     * @param {{amount: number}|null} amount
     */
    function amountText(amount) {
        if (!amount || typeof amount.amount !== 'number') {
            return '';
        }
        return amount.amount === 0 ? NOTHING_TO_PAY : formatMoney(amount.amount);
    }

    /** Pure: the basis of an amount, for staff. */
    function amountBasisText(amount) {
        return amount && amount.basis === 'balance' ? 'balance inc VAT' :
            amount && amount.basis === 'total_less_deposit' ? 'total inc VAT less deposit' : '';
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
        // Amendment 2: name · phone, else name · email, else the name alone.
        c = contactParts(am);
        return '<div class="am"><span class="am-label">Your account manager</span><span class="am-name">' +
            esc(am.name) + (c.kind !== 'none' ? ' · <a href="' + esc(c.href) + '">' + esc(c.text) + '</a>' : '') +
            '</span></div>' + callButton(am);
    }

    /**
     * The whole page.
     * @param {Object} opts - { title, logoUrl, am, header ('am'|'questions'|'none'), width
     *                          ('w1200'|'w1120'|'w600'), body, script }
     */
    function page(opts) {
        var width = opts.width || 'w1200';
        return '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<meta name="robots" content="noindex, nofollow">' +
            '<meta name="referrer" content="no-referrer">' +
            '<title>' + esc(opts.title || 'Your projects') + ' | Nu-Heat</title>' +
            FONT_LINKS +
            '<style>' + css() + '</style>' +
            (opts.script ? '<script>document.documentElement.className+=" js";</script>' : '') +
            '</head><body>' +
            '<header class="top"><div class="wrap ' + width + '">' + logoHtml(opts.logoUrl) +
            headerRight(opts.header || 'am', opts.am) + '</div></header>' +
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
            state = stateCell(badge('ready', 'Ready to deliver'), '');
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
     *                       deliveryUrl(soId), bank, payBacs }
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

        if (m.notice) {
            body += '<div class="notice" role="status">' + esc(m.notice) + '</div>';
        }

        // Canvas order: to order -> in design -> for delivery.
        if (g.toOrder.length) {
            html = '<section class="sec" aria-label="Projects to order">' +
                sectionHead('Projects to order', g.toOrder.length, 'Quotes we’ve sent you') +
                colHead('Project');
            for (i = 0; i < g.toOrder.length; i++) {
                html += '<div class="row">' + projectCell(g.toOrder[i]) + stateCell(badge('quote', 'Quote sent'), '') +
                    '<div class="acts"></div></div>';
            }
            body += html + '</section>';
        }
        if (g.inDesign.length) {
            html = '<section class="sec" aria-label="Projects in design">' +
                sectionHead('Projects in design', g.inDesign.length, 'Ordered, and being designed by our team') +
                colHead('Project');
            for (i = 0; i < g.inDesign.length; i++) {
                d = g.inDesign[i];
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

        return page({ title: 'Your projects', logoUrl: m.logoUrl, am: m.am, header: 'am', width: 'w1200', body: body });
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

    /**
     * Radio cards: the list text as the title, an optional hint under it.
     * @param {Object} hints - id -> hint text (from custscript_cdb_option_hints); may be empty
     */
    function optionCards(name, options, selected, hints) {
        var html = '<div class="opts">';
        var i;
        var hint;
        for (i = 0; i < options.length; i++) {
            hint = hints && hints.hasOwnProperty(options[i].id) ? hints[options[i].id] : '';
            html += '<label class="optc"><input type="radio" name="' + esc(name) + '" value="' + esc(options[i].id) + '"' +
                (String(selected) === String(options[i].id) ? ' checked' : '') + ' required data-label="' +
                esc(options[i].text) + '"><span><span class="ot">' + esc(options[i].text) + '</span>' +
                (hint ? '<span class="oh">' + esc(hint) + '</span>' : '') + '</span></label>';
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

    /** The inline script for the form: month switching and the live summary. ES5, no library. */
    var FORM_SCRIPT = [
        '(function(){',
        'var d=document;',
        'function init(){',
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
     *                       paymentOptions (1.2: ['BACS','CARD'] or ['BACS','ACCOUNT']) }
     */
    function deliveryForm(m) {
        var v = m.values || {};
        var e = m.errors || {};
        var o = m.order;
        var title = orderTitle(o);
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
        if (m.noticeDays > 0) {
            notice = 'We need at least ' + m.noticeDays + ' working day' + (m.noticeDays === 1 ? '' : 's') +
                '’ notice. ';
        }

        body = '<div style="display:flex;flex-direction:column;gap:8px">' +
            '<a href="' + esc(m.backUrl) + '" style="font-size:15px;text-decoration:none">← Your projects</a>' +
            '<h1>Arrange delivery</h1>' +
            '<p class="lead" style="margin:0">' + esc([m.opp && m.opp.title, title, 'Order ' + o.tranId]
                .filter(function (x) { return !!x; }).join(' · ')) + '</p>' +
            (o.uniqueRef ? '<p class="soref" style="margin:0">' + esc(o.uniqueRef) + '</p>' : '') + '</div>' +
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
            '</fieldset></section>' +

            '<section class="card"><h2><span class="num">2</span>Where should we deliver?</h2><div>' +
            '<label class="lbl" for="f-address">Delivery address</label>' + fieldError(e, 'address') +
            '<select class="inp" id="f-address" name="address" required' + describedBy(e, 'address') + '>' +
            addressOptions + '</select><p class="hint" style="margin:6px 0 0">Need it somewhere else? Tell us under ' +
            '“Anything else” and we’ll call you to confirm.</p></div></section>' +

            '<section class="card"><h2><span class="num">3</span>Access and unloading</h2>' +
            guidance(m.guidance) +
            '<fieldset><legend>Largest vehicle that can reach the property</legend>' + fieldError(e, 'vehicle') +
            optionCards('vehicle', m.options.vehicle, v.vehicle, m.hints && m.hints.vehicle) + '</fieldset>' +
            '<fieldset><legend>Unloading</legend>' + fieldError(e, 'unload') +
            optionCards('unload', m.options.unload, v.unload, m.hints && m.hints.unload) + '</fieldset></section>' +

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
                'Amount to pay: <strong>' + esc(amountShown) + '</strong> including VAT') + '</p>' +
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
            width: 'w1120', body: body, script: FORM_SCRIPT });
    }

    // ---------------------------------------------------------------- confirmations

    /**
     * The page after a successful request (ConfirmBacs / ConfirmCard, and 1.2's account page styled
     * like the card one).
     * @param {Object} m - { logoUrl, am, payment ('BACS'|'CARD'|'ACCOUNT'), bank, tranId, orderTitle,
     *                       uniqueRef, backUrl, dateKey, timeText, amount (pay-up-front only) }
     */
    function confirmation(m) {
        var noted = (m.dateKey ? shortDate(m.dateKey) : 'your date') + (m.timeText ? ', ' + m.timeText : '');
        var what = (m.orderTitle || 'your order') + (m.uniqueRef ? ', ' + m.uniqueRef : '') + ' (order ' + m.tranId + ')';
        var amountShown = m.payment === 'ACCOUNT' ? '' : amountText(m.amount);
        var body = '<div class="card done"><div class="tick">' + TICK_ICON + '</div><h1>Delivery requested</h1><p>' +
            (m.payment === 'ACCOUNT' ? esc('Delivery requested. We’ll add order ' + m.tranId + ' to your account and ' +
                'email you to confirm the date.') :
                esc('Thanks. We’ve noted ' + noted + ', for ' + what + '. ') +
                (m.payment === 'BACS' ? 'We’ll book it as soon as your payment reaches us.' :
                    cardPaymentText(amountShown) + ' Once payment is taken, we’ll book your delivery.')) +
            '</p></div>';

        if (m.payment === 'BACS') {
            body += '<div class="card bank"><h2>Pay by bank transfer</h2>' + bankRows(m.bank, m.tranId, amountShown) +
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
            row.sub += ' \u00b7 ' + (o.payIntent === String(payBacs) ? 'awaiting your bank transfer \u00b7 ref ' +
                o.tranId : 'your account manager will call to take payment');
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
            return ' or email ' + esc(am.name) + ' at <a href="mailto:' + esc(c.text) + '" style="color:' + COLORS.PURPLE +
                ';">' + esc(c.text) + '</a>';
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

    /** The email's inline font declaration and <font face>. */
    var EF = 'font-family:' + EMAIL_FONT + ';';
    var FACE = EMAIL_FONT;

    /** Text in a colour that survives stripped styles. html must be escaped already. */
    function fontHtml(color, html) {
        return '<font face="' + FACE + '" color="' + color + '">' + html + '</font>';
    }

    /**
     * The whole email document (Send Quote's emailShell): head, the phone media queries, the Outlook
     * blocks, the hidden preheader, the centred 600px column, the caller's rows, the account manager
     * card, and the Send Quote footer (logo, five social links) with this email's line under it.
     *
     * @param {Object} s - every value already escaped HTML:
     *   title, preheader, rows (<tr>…</tr>), card (emailRepCard() or ''), footerLine
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

            (s.card ? '<tr><td align="center" valign="top" style="padding:28px 20px 32px 20px;">\n' + s.card + '</td></tr>\n' : '') +

            // The Send Quote footer: logo and the five social links, then this email's line.
            '<tr><td align="center" valign="top" bgcolor="' + std.FOOTER_BG + '" style="background-color:' + std.FOOTER_BG +
            ';padding:10px 10px 24px 10px;">\n' +
            '<img src="' + esc(std.IMG_BASE + std.FOOTER_LOGO) + '" width="167" height="94" alt="Nu-Heat Underfloor Heating &amp; Renewables" border="0" style="display:block;margin:0 auto 10px auto;width:167px;height:auto;">\n' +
            '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0">\n' +
            '<tr>\n' + social + '</tr>\n' +
            '</table>\n' +
            '</td></tr>\n' +
            '<tr><td align="center" valign="top" style="padding:16px 20px 24px 20px;">\n' +
            '<p style="margin:0;' + EF + 'font-size:13px;line-height:17px;color:#6b6b6b;">' + fontHtml('#6b6b6b', s.footerLine) + '</p>\n' +
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
        return '<tr><td align="center" valign="top" style="padding:24px 16px;border-bottom:1px solid #ece8e3;">' +
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
     * @param {string} hello - the whole line, e.g. "Hello Sam"
     */
    function emailBand(eyebrow, heading, hello) {
        return '<tr><td align="center" valign="top" bgcolor="' + COLORS.PURPLE + '" style="background-color:' + COLORS.PURPLE +
            ';padding:36px 32px;' + EF + 'color:#ffffff;">' +
            '<p style="margin:0 0 10px;' + EF + 'font-size:15px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;' +
            'color:#e7d9ea;">' + fontHtml('#e7d9ea', '<b>' + esc(eyebrow) + '</b>') + '</p>' +
            '<h1 class="h1" style="margin:0 0 10px;' + EF + 'font-size:30px;line-height:36px;font-weight:bold;color:#ffffff;">' +
            fontHtml('#ffffff', esc(heading)) + '</h1>' +
            '<p style="margin:0;' + EF + 'font-size:17px;color:#f3ecf4;">' + fontHtml('#f3ecf4', esc(hello)) + '</p></td></tr>\n';
    }

    /**
     * Send Quote's bulletproof button: one [if !mso] / [if mso] pair, never a display:none wrapper.
     * Colour by bgcolor and <font color>, padding by cellpadding, so it survives stripped styles.
     * @param {string} href - plain; escaped here
     * @param {string} label - plain; escaped here
     */
    function emailButton(href, label) {
        var bg = config.EMAIL_STANDARD.BUTTON_BG;
        var fg = config.EMAIL_STANDARD.BUTTON_TEXT;
        var text = EF + 'font-size:18px;line-height:22px;font-weight:bold;color:' + fg + ';text-decoration:none;';
        var h = esc(href);
        var l = esc(label);
        return '' +
            '<!--[if !mso]><!-- -->\n' +
            '<table role="presentation" class="btn-full" align="center" cellpadding="14" cellspacing="0" border="0" bgcolor="' + bg +
            '" style="background-color:' + bg + ';border-radius:5px;border-collapse:separate;">\n' +
            '<tr><td align="center" valign="middle" bgcolor="' + bg + '" style="padding:0;border-radius:5px;"><a href="' + h +
            '" target="_blank" style="display:block;padding:15px 28px;' + text + '"><font face="' + FACE + '" color="' + fg +
            '"><b>' + l + '</b></font></a></td></tr>\n' +
            '</table>\n' +
            '<!--<![endif]-->\n' +
            '<!--[if mso]>\n' +
            '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="' + bg + '">\n' +
            '<tr><td align="center" valign="middle" bgcolor="' + bg + '" style="padding:15px 28px;"><a href="' + h +
            '" target="_blank" style="' + text + '"><font face="Arial, sans-serif" color="' + fg + '"><b>' + l +
            '</b></font></a></td></tr>\n' +
            '</table>\n' +
            '<![endif]-->\n';
    }

    /** A centred row holding one button. */
    function emailButtonRow(link, label) {
        return '<tr><td align="center" valign="top" style="padding:16px 32px 8px;">\n' + emailButton(link, label) + '</td></tr>\n';
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
     * The account manager card (Send Quote 2.2.0's emailRepCard): the photo (a 96px circle, only for an
     * https:// URL, else no photo row at all), YOUR ACCOUNT MANAGER, the name, phone · email (two lines
     * on phones), then CALL {FIRST} and EMAIL {FIRST} side by side (stacked, full width, on phones). A
     * button without its value is left out. '' when there is no name, phone or email at all.
     *
     * @param {Object} am - { name, phone, email, firstName, photoUrl }, plain text
     * @returns {string}
     */
    function emailRepCard(am) {
        var a = am || {};
        var name = a.name || config.EMAIL_STANDARD.GENERIC_AM_NAME;
        var first = resolveFirstName(a.firstName, a.name).toUpperCase();
        var tel = String(a.phone || '').replace(/[^\d+]/g, '');
        var photo = /^https:\/\/[^\s"'<>]+$/i.test(String(a.photoUrl || '')) ? String(a.photoUrl) : '';
        var buttons = [];
        var lines = [];
        if (!a.name && !a.phone && !a.email) {
            return '';
        }
        if (tel) {
            buttons.push(emailButton('tel:' + tel, first ? 'CALL ' + first : 'CLICK TO CALL'));
        }
        if (a.email) {
            buttons.push(emailButton('mailto:' + a.email, first ? 'EMAIL ' + first : 'SEND AN EMAIL'));
        }
        if (a.phone) {
            lines.push('<span class="cl-line">' + esc(a.phone) + '</span>');
        }
        if (a.email) {
            lines.push('<span class="cl-line">' + esc(a.email) + '</span>');
        }
        return '' +
            '<table role="presentation" class="main-card" width="440" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f2f7" style="width:100%;max-width:440px;background-color:#f6f2f7;border-radius:8px;">\n' +
            (photo ? '<tr><td align="center" valign="top" style="padding:24px 20px 0 20px;"><img src="' + esc(photo) +
                '" width="96" height="96" alt="' + esc(name) + '" border="0" style="display:block;margin:0 auto;width:96px;height:96px;border-radius:48px;object-fit:cover;"></td></tr>\n' : '') +
            '<tr><td align="center" valign="top" style="padding:' + (photo ? '14px' : '24px') + ' 20px ' +
            (buttons.length ? '0' : '24px') + ' 20px;">\n' +
            '<p style="margin:0 0 4px 0;' + EF + 'font-size:13px;line-height:16px;letter-spacing:2px;color:#59315f;">' +
            fontHtml('#59315f', '<b>YOUR ACCOUNT MANAGER</b>') + '</p>\n' +
            '<p style="margin:0 0 6px 0;' + EF + 'font-size:24px;line-height:28px;font-weight:bold;color:#000000;">' +
            fontHtml('#000000', '<b>' + esc(name) + '</b>') + '</p>\n' +
            (lines.length ? '<p style="margin:0;' + EF + 'font-size:17px;line-height:23px;color:#131313;">' +
                fontHtml('#131313', lines.join('<span class="cl-sep"> · </span>')) + '</p>\n' : '') +
            '</td></tr>\n' +
            (buttons.length ? '<tr><td align="center" valign="top" style="padding:16px 14px 20px 14px;">\n' +
                '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0">\n' +
                '<tr>\n' +
                buttons.map(function (b) {
                    return '<td class="stack" width="' + (buttons.length === 2 ? '50%' : '100%') +
                        '" align="center" valign="top" style="padding:6px;">\n' + b + '</td>\n';
                }).join('') +
                '</tr>\n' +
                '</table>\n' +
                '</td></tr>\n' : '') +
            '</table>\n';
    }

    /** The muted "This link is personal to you…" row. text is plain. */
    function emailPersonal(text) {
        return '<tr><td align="center" valign="top" style="padding:4px 32px 8px;' + EF + 'font-size:14px;color:' + COLORS.MUTED + ';">' +
            fontHtml(COLORS.MUTED, esc(text)) + '</td></tr>\n';
    }

    /** One digest row's badge: a small table, colour by bgcolor and <font color>. */
    function emailBadge(kind, text) {
        var b = BADGES[kind] || BADGES.quote;
        return '<table role="presentation" align="right" cellpadding="3" cellspacing="0" border="0" bgcolor="' + b.bg +
            '" style="background-color:' + b.bg + ';border-radius:12px;border-collapse:separate;"><tr>' +
            '<td align="center" valign="middle" bgcolor="' + b.bg + '" style="padding:3px 12px;border-radius:12px;white-space:nowrap;">' +
            fontHtml(b.fg, '<span style="' + EF + 'font-size:13px;font-weight:bold;color:' + b.fg + ';white-space:nowrap;">' +
                esc(text) + '</span>') + '</td></tr></table>';
    }

    /** A paragraph in a colour: plain text, escaped here. */
    function emailP(margin, size, color, text, bold) {
        return '<p style="margin:' + margin + ';' + EF + 'font-size:' + size + 'px;' + (bold ? 'font-weight:bold;' : '') +
            'color:' + color + ';">' + fontHtml(color, bold ? '<b>' + esc(text) + '</b>' : esc(text)) + '</p>';
    }

    /**
     * The digest email. Pure, snapshot-tested.
     * @param {Object} m - { customerName, greetingName, logoUrl, groups, payBacs, link, title (the
     *                       subject), am {name, phone, email, firstName, photoUrl}, digestDays }
     * @returns {string}
     */
    function digestEmail(m) {
        var rows = digestRows(m.groups, m.payBacs);
        var callout = digestCallout(m.groups, m.payBacs);
        var html = '';
        var i;
        var r;

        html += emailLogo(m.logoUrl);
        html += emailBand('YOUR PROJECTS UPDATE', 'Here’s where everything stands', 'Hello ' + (m.greetingName || m.customerName || ''));

        html += '<tr><td align="center" valign="top" style="padding:32px 32px 8px;"><table role="presentation" width="100%" ' +
            'align="center" cellpadding="0" cellspacing="0" border="0">\n';

        // The action callout
        if (callout) {
            html += '<tr><td align="left" valign="top" style="padding:0 0 8px;"><table role="presentation" width="100%" align="center" ' +
                'cellpadding="16" cellspacing="0" border="0" bgcolor="#fffaf0" style="background-color:#fffaf0;"><tr>' +
                '<td align="left" valign="top" bgcolor="#fffaf0" style="background-color:#fffaf0;border:2px solid ' + COLORS.CTA +
                ';padding:16px 18px;' + EF + 'font-size:17px;line-height:24px;color:' + COLORS.TEXT + ';">' +
                fontHtml(COLORS.TEXT, callout) + '</td></tr></table></td></tr>\n';
        }

        // One row per order or project
        for (i = 0; i < rows.length; i++) {
            r = rows[i];
            if (r.heading) {
                html += '<tr><td align="left" valign="top" style="padding:20px 0 4px;' + EF + 'font-size:15px;font-weight:bold;' +
                    'letter-spacing:1px;text-transform:uppercase;color:' + COLORS.PURPLE + ';">' +
                    fontHtml(COLORS.PURPLE, '<b>' + esc(r.heading) + '</b>') + '</td></tr>\n';
            }
            html += '<tr><td align="left" valign="top" style="padding:16px 0;' + (i < rows.length - 1 ? 'border-bottom:1px solid #ece8e3;' : '') + '">' +
                '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0"><tr>' +
                '<td align="left" valign="middle" style="' + EF + 'text-align:left;">' +
                emailP('0', 17, COLORS.TEXT, r.title, true) +
                (r.line1 ? emailP('2px 0 0', 15, COLORS.TEXT, r.line1) : '') +
                (r.ref ? emailP('2px 0 0', 15, COLORS.TEXT, r.ref, true) : '') +
                emailP('2px 0 0', 15, COLORS.MUTED, r.sub) + '</td>' +
                '<td align="right" valign="middle" style="padding-left:12px;white-space:nowrap;">' +
                emailBadge(r.badgeKind, r.badgeText) + '</td></tr></table></td></tr>\n';
        }
        html += '</table></td></tr>\n';

        html += emailButtonRow(m.link, 'VIEW YOUR PROJECTS');
        html += emailPersonal('This link is personal to you. Please don’t forward this email.');

        return emailShell({
            title: esc(m.title || 'Your Nu-Heat projects'),
            preheader: esc(config.EMAIL_STANDARD.DIGEST_PREHEADER),
            rows: html,
            card: emailRepCard(m.am),
            footerLine: 'You get this update ' + everyText(m.digestDays) +
                ' while you have an open project or order with us. To stop these updates, reply to this email' +
                emailFooterContact(m.am) + '.'
        });
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
     * 2.0: the "Send delivery link" email — one order, one button to its direct delivery link.
     * Pure, snapshot-tested. No opt-out wording: it is not the digest.
     *
     * @param {Object} m - { text (config.DELIVERY_LINK_EMAIL; defaults to it), customerName, greetingName,
     *                       logoUrl, opp {title, tranId}, order (decorated: tranId, description, uniqueRef,
     *                       typeLabel, quoteTypeText), link (the direct delivery link), dashboardLink,
     *                       am {name, phone, email, firstName, photoUrl} }
     * @returns {string}
     */
    function deliveryLinkEmail(m) {
        var t = m.text || config.DELIVERY_LINK_EMAIL;
        var o = m.order;
        var html = '';

        html += emailLogo(m.logoUrl);
        html += emailBand(t.EYEBROW, t.HEADING, String(t.HELLO).replace('{name}', m.greetingName || m.customerName || ''));

        // Intro, then the one order block: project, order title, split reference, "Order SO… · UFH".
        html += '<tr><td align="center" valign="top" style="padding:32px 32px 8px;">' +
            '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0"><tr>' +
            '<td align="left" valign="top" style="padding:0 0 20px;' + EF + 'font-size:17px;line-height:24px;color:' + COLORS.TEXT + ';">' +
            emailP('0', 17, COLORS.TEXT, t.INTRO) + '</td></tr><tr>' +
            '<td align="left" valign="top" bgcolor="#ffffff" style="padding:16px 18px;border:1px solid #ece8e3;border-left:4px solid ' +
            COLORS.PURPLE + ';' + EF + 'text-align:left;">' +
            emailP('0', 17, COLORS.TEXT, (m.opp && (m.opp.title || m.opp.tranId)) || '', true) +
            emailP('2px 0 0', 15, COLORS.TEXT, orderTitle(o)) +
            (o.uniqueRef ? emailP('2px 0 0', 15, COLORS.TEXT, o.uniqueRef, true) : '') +
            emailP('2px 0 0', 15, COLORS.MUTED, orderMeta(o)) +
            '</td></tr></table></td></tr>\n';

        html += emailButtonRow(m.link, t.BUTTON);

        // The secondary link to the dashboard: small, purple, underlined.
        html += '<tr><td align="center" valign="top" style="padding:8px 32px 4px;' + EF + 'font-size:15px;">' +
            '<a href="' + esc(m.dashboardLink) + '" target="_blank" style="' + EF + 'font-size:15px;color:' + COLORS.PURPLE +
            ';text-decoration:underline;">' + fontHtml(COLORS.PURPLE, esc(t.DASHBOARD_LINK)) + '</a></td></tr>\n';

        html += emailPersonal(t.PERSONAL);

        return emailShell({
            title: esc(deliveryLinkSubject(t, o.tranId)),
            preheader: esc(t.PREHEADER),
            rows: html,
            card: emailRepCard(m.am),
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
        contactParts: contactParts,
        questionsLine: questionsLine,
        formatMoney: formatMoney,
        amountText: amountText,
        amountBasisText: amountBasisText,
        NOTHING_TO_PAY: NOTHING_TO_PAY,
        css: css,
        page: page,
        invalidPage: invalidPage,
        errorPage: errorPage,
        dashboard: dashboard,
        deliveryForm: deliveryForm,
        confirmation: confirmation,
        digestRows: digestRows,
        digestCallout: digestCallout,
        digestEmail: digestEmail,
        emailOrderRow: emailOrderRow,
        emailShell: emailShell,
        emailLogo: emailLogo,
        emailBand: emailBand,
        emailButton: emailButton,
        emailRepCard: emailRepCard,
        resolveFirstName: resolveFirstName,
        deliveryLinkSubject: deliveryLinkSubject,
        deliveryLinkEmail: deliveryLinkEmail
    };
});
