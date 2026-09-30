/**
 * cdb_lib_render.js
 *
 * HTML strings: the page shell, the dashboard sections, the delivery form, the confirmations and
 * the digest email. Pure: no NetSuite module. Every value from a record or a request goes
 * through esc().
 *
 * NOTHING LOADS FROM A THIRD-PARTY HOST. The styles are inline; there is no script; the font
 * stack names Source Sans 3 but does NOT load Google Fonts, so it falls back to Calibri or the
 * system font. The only external resource is the logo, from custscript_cdb_logo_url (https, a
 * nu-heat.co.uk image), and only when that parameter is set.
 *
 * The colours are copied by value from PAGE_COLORS / baseCss() in
 * 2026.03-Online-quote/nuheat_opp_update_lib.js. That repo is NOT a dependency.
 *
 * THE EMAIL is tables and inline styles, readable with styles stripped, and never uses
 * display:none (brief B6).
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.0.0
 */
define(['./cdb_lib_dates'], function (dates) {

    'use strict';

    var VERSION = '1.0.0';

    var COLORS = {
        PURPLE: '#59315f',
        PURPLE_HOVER: '#3d1f42',
        YELLOW: '#ffb500',
        YELLOW_TEXT: '#2b2a2e',
        PAGE: '#f4f2ef',
        CARD: '#ffffff',
        BORDER: '#e2ded9',
        TEXT: '#2b2a2e',
        SECONDARY: '#5f5b66',
        ERROR: '#a3261b'
    };

    var FONT = "'Source Sans 3', Calibri, sans-serif";

    /** Badge colours: [background, text]. */
    var BADGES = {
        ready: { bg: '#e6f2ec', fg: '#1f5c3f' },
        needs_info: { bg: '#fdf0d8', fg: '#6e4400' },
        awaiting_payment: { bg: '#e3edf7', fg: '#1d4f7a' },
        in_design: { bg: '#efe9f1', fg: '#3d1f42' },
        quote: { bg: '#ecebe9', fg: '#4a4650' }
    };

    var INVALID_LINK_TEXT = 'This link is no longer valid. Please contact your account manager';

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

    /** Escaped text with line breaks kept. */
    function escLines(value) {
        return esc(value).replace(/\r?\n/g, '<br>');
    }

    function css() {
        return [
            '*{box-sizing:border-box}',
            'body{margin:0;background:' + COLORS.PAGE + ';color:' + COLORS.TEXT + ';font-family:' + FONT +
                ';font-size:16px;line-height:1.45}',
            '.wrap{max-width:860px;margin:0 auto;padding:16px}',
            'header.top{background:' + COLORS.PURPLE + ';color:#fff}',
            'header.top .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}',
            'header.top img{max-height:44px;display:block}',
            'header.top .brand{font-weight:700;font-size:20px}',
            '.am{font-size:15px;text-align:right}',
            '.am a{color:#fff}',
            'h1{font-size:26px;margin:8px 0 4px}',
            'h2{font-size:20px;margin:28px 0 10px;color:' + COLORS.PURPLE + '}',
            '.muted{color:' + COLORS.SECONDARY + '}',
            '.card{background:' + COLORS.CARD + ';border:1px solid ' + COLORS.BORDER +
                ';border-radius:8px;padding:16px;margin:0 0 12px}',
            '.row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 16px;align-items:flex-start}',
            '.row + .row{border-top:1px solid ' + COLORS.BORDER + ';margin-top:12px;padding-top:12px}',
            '.title{font-weight:700}',
            '.badge{display:inline-block;border-radius:999px;padding:2px 12px;font-size:14px;font-weight:600;white-space:nowrap}',
            '.btn{display:inline-block;border:0;border-radius:6px;padding:10px 18px;font:inherit;font-weight:700;' +
                'text-decoration:none;cursor:pointer}',
            '.btn-yellow{background:' + COLORS.YELLOW + ';color:' + COLORS.YELLOW_TEXT + '}',
            '.btn-purple{background:' + COLORS.PURPLE + ';color:#fff}',
            '.btn-purple:hover,.btn-purple:focus{background:' + COLORS.PURPLE_HOVER + '}',
            'a{color:' + COLORS.PURPLE + '}',
            'a:hover{color:' + COLORS.PURPLE_HOVER + '}',
            '.notice{background:#fdf0d8;color:#6e4400;border-radius:6px;padding:10px 14px;margin:12px 0}',
            '.panel{background:' + COLORS.PAGE + ';border-radius:6px;padding:12px 14px;margin-top:8px}',
            '.ref{background:' + COLORS.YELLOW + ';color:' + COLORS.YELLOW_TEXT + ';padding:2px 8px;border-radius:4px;font-weight:700}',
            'details summary{cursor:pointer;color:' + COLORS.PURPLE + ';font-weight:600}',
            'fieldset{border:1px solid ' + COLORS.BORDER + ';border-radius:8px;padding:12px 14px;margin:0 0 14px;background:#fff}',
            'legend{font-weight:700;padding:0 6px}',
            'label.opt{display:block;margin:6px 0}',
            'input[type=text],input[type=email],input[type=tel],select,textarea{width:100%;font:inherit;padding:8px;' +
                'border:1px solid ' + COLORS.BORDER + ';border-radius:6px;background:#fff}',
            '.err{color:' + COLORS.ERROR + ';font-weight:600;margin:4px 0}',
            '.months{display:flex;flex-wrap:wrap;gap:16px}',
            '.month{flex:1 1 240px;max-width:320px}',
            '.month table{border-collapse:collapse;width:100%}',
            '.month th{font-size:13px;color:' + COLORS.SECONDARY + ';font-weight:600;padding:2px}',
            '.month td{padding:2px;text-align:center}',
            '.day{display:block;padding:6px 0;border-radius:6px;font-size:15px}',
            '.day.off{color:#b9b4ad}',
            'label.day{background:#fff;border:1px solid ' + COLORS.BORDER + ';cursor:pointer}',
            'label.day input{position:absolute;opacity:0;width:1px;height:1px}',
            'label.day:has(input:checked){background:' + COLORS.PURPLE + ';color:#fff;border-color:' + COLORS.PURPLE + '}',
            'label.day:focus-within{outline:2px solid ' + COLORS.YELLOW + '}',
            'footer{margin:32px 0 16px;font-size:14px;color:' + COLORS.SECONDARY + '}'
        ].join('\n');
    }

    function badge(kind, text) {
        var c = BADGES[kind] || BADGES.quote;
        return '<span class="badge" style="background:' + c.bg + ';color:' + c.fg + '">' + esc(text) +
            '</span>';
    }

    /**
     * The whole page.
     * @param {Object} opts - { title, logoUrl, am: {name, phone}, body }
     */
    function page(opts) {
        var logo = opts.logoUrl ?
            '<img src="' + esc(opts.logoUrl) + '" alt="Nu-Heat">' :
            '<span class="brand">Nu-Heat</span>';
        var am = '';
        if (opts.am && opts.am.name) {
            am = '<div class="am">Your account manager<br><strong>' + esc(opts.am.name) + '</strong>' +
                (opts.am.phone ? '<br><a href="tel:' + esc(opts.am.phone.replace(/[^0-9+]/g, '')) + '">' +
                    esc(opts.am.phone) + '</a>' : '') + '</div>';
        }
        return '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<meta name="robots" content="noindex, nofollow">' +
            '<meta name="referrer" content="no-referrer">' +
            '<title>' + esc(opts.title || 'Your projects') + ' | Nu-Heat</title>' +
            '<style>' + css() + '</style></head><body>' +
            '<header class="top"><div class="wrap">' + logo + am + '</div></header>' +
            '<main class="wrap">' + opts.body + '</main></body></html>';
    }

    /** The one page every link failure shows. No detail, ever. */
    function invalidPage(logoUrl) {
        return page({
            title: 'Link not valid',
            logoUrl: logoUrl,
            body: '<div class="card"><p>' + esc(INVALID_LINK_TEXT) + '.</p></div>'
        });
    }

    /** A failure that is ours, not the link's. */
    function errorPage(logoUrl) {
        return page({
            title: 'Something went wrong',
            logoUrl: logoUrl,
            body: '<div class="card"><p>Sorry, something went wrong on our side. Please try again ' +
                'later, or contact your account manager.</p></div>'
        });
    }

    /** The bank panel for a BACS payment. */
    function bankPanel(bank, reference) {
        return '<div class="panel"><table role="presentation">' +
            '<tr><td class="muted">Bank</td><td><strong>' + esc(bank.name) + '</strong></td></tr>' +
            '<tr><td class="muted">Sort code&nbsp;&nbsp;</td><td><strong>' + esc(bank.sort) + '</strong></td></tr>' +
            '<tr><td class="muted">Account</td><td><strong>' + esc(bank.account) + '</strong></td></tr>' +
            '<tr><td class="muted">Reference</td><td><span class="ref">' + esc(reference) + '</span></td></tr>' +
            '</table><p>Please use the reference exactly as shown. We\'ll book your delivery once ' +
            'payment reaches us.</p></div>';
    }

    function oppHeading(opp) {
        return '<div><div class="title">' + esc(opp.title || opp.tranId || 'Your project') + '</div>' +
            (opp.siteAddress ? '<div class="muted">' + escLines(opp.siteAddress) + '</div>' : '') + '</div>';
    }

    /**
     * One sales order row inside "Projects for delivery".
     * @param {Object} row - { order, state }
     * @param {Object} m - the dashboard model
     */
    function orderRow(row, m) {
        var o = row.order;
        var name = '<div><div class="title">' + esc(o.quoteTypeText || 'Your order') + '</div>' +
            '<div class="muted">Order ' + esc(o.tranId) + '</div>';
        var right;
        var extra = '';
        var requested;

        if (row.state === 'booked') {
            right = badge('ready', 'Delivery booked');
            extra = '<div>' + esc(dates.formatLong(o.confirmedDateKey)) + '</div>';
        } else if (row.state === 'awaiting_payment') {
            right = badge('awaiting_payment', 'Awaiting payment');
            requested = 'Requested ' + (dates.formatLong(o.shipDateKey) || 'date to be confirmed') +
                (o.timeText ? ', ' + o.timeText : '');
            extra = '<div>' + esc(requested) + '</div><details><summary>Payment details</summary>' +
                (o.payIntent === String(m.payBacs) ? bankPanel(m.bank, o.tranId) :
                    '<div class="panel">Your account manager' + (m.am && m.am.name ? ', ' + esc(m.am.name) + ',' : '') +
                    ' will call you to take payment. We never ask for card details online.</div>') +
                '</details>';
        } else if (row.state === 'ready') {
            right = badge('ready', 'Ready to deliver') + '<div style="margin-top:8px">' +
                '<a class="btn btn-yellow" href="' + esc(m.deliveryUrl(o.id)) + '">Arrange delivery</a></div>';
        } else {
            right = badge('needs_info', 'Needs information');
            extra = (o.holdReason ? '<div>' + esc(o.holdReason) + '</div>' : '') +
                '<div class="muted">Your account manager will be in touch.</div>';
        }
        return '<div class="row">' + name + extra + '</div><div>' + right + '</div></div>';
    }

    /**
     * The dashboard.
     * @param {Object} m - { customerName, logoUrl, am, groups, notice, deliveryUrl(soId), bank,
     *                       payBacs }
     */
    function dashboard(m) {
        var g = m.groups;
        var body = '<h1>Your projects</h1><p class="muted">' + esc(m.customerName) + '</p>';
        var i;
        var j;
        var html;

        if (m.notice) {
            body += '<div class="notice" role="status">' + esc(m.notice) + '</div>';
        }
        if (g.forDelivery.length) {
            body += '<h2>Projects for delivery</h2>';
            for (i = 0; i < g.forDelivery.length; i++) {
                html = '<div class="card"><div class="row">' + oppHeading(g.forDelivery[i].opp) + '</div>';
                for (j = 0; j < g.forDelivery[i].orders.length; j++) {
                    html += orderRow(g.forDelivery[i].orders[j], m);
                }
                body += html + '</div>';
            }
        }
        if (g.inDesign.length) {
            body += '<h2>Projects in design</h2>';
            for (i = 0; i < g.inDesign.length; i++) {
                body += '<div class="card"><div class="row">' + oppHeading(g.inDesign[i].opp) + '<div>' +
                    (g.inDesign[i].badge === 'needs_info' ? badge('needs_info', 'We need information') :
                        badge('in_design', 'Designing your system')) + '</div></div></div>';
            }
        }
        if (g.toOrder.length) {
            body += '<h2>Projects to order</h2>';
            for (i = 0; i < g.toOrder.length; i++) {
                body += '<div class="card"><div class="row">' + oppHeading(g.toOrder[i]) + '<div>' +
                    badge('quote', 'Quote sent') + '</div></div></div>';
            }
        }
        if (g.isEmpty) {
            body += '<div class="card"><p>There is nothing to show at the moment. If you think ' +
                'that\'s wrong, please contact your account manager.</p></div>';
        }
        return page({ title: 'Your projects', logoUrl: m.logoUrl, am: m.am, body: body });
    }

    function fieldError(errors, name) {
        return errors && errors[name] ? '<p class="err" id="err-' + esc(name) + '">' + esc(errors[name]) +
            '</p>' : '';
    }

    function radioGroup(name, legend, options, selected, errors) {
        var html = '<fieldset><legend>' + esc(legend) + '</legend>' + fieldError(errors, name);
        var i;
        for (i = 0; i < options.length; i++) {
            html += '<label class="opt"><input type="radio" name="' + esc(name) + '" value="' +
                esc(options[i].id) + '"' + (String(selected) === String(options[i].id) ? ' checked' : '') +
                ' required> ' + esc(options[i].text) + '</label>';
        }
        return html + '</fieldset>';
    }

    /**
     * The server-rendered calendar: every day of every month in the window, allowed days as
     * radio buttons, the rest disabled text.
     */
    function calendar(months, allowedSet, selected, errors) {
        var html = '<fieldset><legend>Delivery date</legend>' + fieldError(errors, 'date') +
            '<p class="muted">Weekends, bank holidays and the next few working days are not available.</p>' +
            '<div class="months">';
        var dow = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
        var i;
        var w;
        var d;
        var key;
        var day;

        for (i = 0; i < months.length; i++) {
            html += '<div class="month"><table><caption class="title">' + esc(months[i].title) +
                '</caption><tr>';
            for (d = 0; d < 7; d++) {
                html += '<th scope="col">' + dow[d] + '</th>';
            }
            html += '</tr>';
            for (w = 0; w < months[i].weeks.length; w++) {
                html += '<tr>';
                for (d = 0; d < 7; d++) {
                    key = months[i].weeks[w][d];
                    if (!key) {
                        html += '<td></td>';
                        continue;
                    }
                    day = String(parseInt(key.slice(8), 10));
                    if (allowedSet[key]) {
                        html += '<td><label class="day" title="' + esc(dates.formatLong(key)) + '">' +
                            '<input type="radio" name="date" value="' + esc(key) + '"' +
                            (selected === key ? ' checked' : '') + ' required aria-label="' +
                            esc(dates.formatLong(key)) + '">' + day + '</label></td>';
                    } else {
                        html += '<td><span class="day off">' + day + '</span></td>';
                    }
                }
                html += '</tr>';
            }
            html += '</table></div>';
        }
        return html + '</div></fieldset>';
    }

    function textInput(type, name, label, value, maxLength, errors, required) {
        return '<p><label for="f-' + esc(name) + '">' + esc(label) + (required ? '' : ' (optional)') +
            '</label>' + fieldError(errors, name) + '<input type="' + type + '" id="f-' + esc(name) +
            '" name="' + esc(name) + '" value="' + esc(value) + '" maxlength="' + maxLength + '"' +
            (required ? ' required' : '') + '></p>';
    }

    /**
     * The delivery form.
     * @param {Object} m - { logoUrl, am, order, opp, actionUrl, backUrl, token, months, allowedSet,
     *                       values, errors, options: {time, vehicle, unload, address}, limits,
     *                       hasErrors }
     */
    function deliveryForm(m) {
        var v = m.values || {};
        var e = m.errors || {};
        var i;
        var addressOptions = '';
        var body;

        for (i = 0; i < m.options.address.length; i++) {
            addressOptions += '<option value="' + esc(m.options.address[i].id) + '"' +
                (String(v.address) === String(m.options.address[i].id) ? ' selected' : '') + '>' +
                esc(m.options.address[i].text || m.options.address[i].label || 'Address') + '</option>';
        }

        body = '<p><a href="' + esc(m.backUrl) + '">&larr; Back to your projects</a></p>' +
            '<h1>Arrange delivery</h1>' +
            '<p class="muted">' + esc(m.order.quoteTypeText || 'Your order') + ' &middot; Order ' +
            esc(m.order.tranId) + (m.opp && m.opp.title ? ' &middot; ' + esc(m.opp.title) : '') + '</p>' +
            (m.hasErrors ? '<div class="notice" role="alert">Please check the highlighted answers ' +
                'below.</div>' : '') +
            '<form method="post" action="' + esc(m.actionUrl) + '" accept-charset="utf-8">' +
            '<input type="hidden" name="t" value="' + esc(m.token) + '">' +
            '<input type="hidden" name="a" value="delivery">' +
            '<input type="hidden" name="so" value="' + esc(m.order.id) + '">' +
            calendar(m.months, m.allowedSet, v.date, e) +
            radioGroup('time', 'Delivery time', m.options.time, v.time, e) +
            '<fieldset><legend>Delivery address</legend>' + fieldError(e, 'address') +
            '<select name="address" required>' + addressOptions + '</select></fieldset>' +
            radioGroup('vehicle', 'Largest vehicle that can reach the site', m.options.vehicle, v.vehicle, e) +
            radioGroup('unload', 'Unloading', m.options.unload, v.unload, e) +
            '<fieldset><legend>Contact on site</legend>' +
            textInput('text', 'contactName', 'Name', v.contactName, m.limits.CONTACT_NAME, e, true) +
            textInput('tel', 'contactPhone', 'Phone', v.contactPhone, m.limits.CONTACT_PHONE, e, true) +
            textInput('email', 'contactEmail', 'Email', v.contactEmail, m.limits.CONTACT_EMAIL, e, false) +
            '</fieldset>' +
            '<fieldset><legend>Special requests (optional)</legend>' + fieldError(e, 'requests') +
            '<textarea name="requests" rows="4" maxlength="' + m.limits.SPECIAL_REQUESTS + '">' +
            esc(v.requests) + '</textarea><p class="muted">Up to ' + m.limits.SPECIAL_REQUESTS +
            ' characters.</p></fieldset>' +
            radioGroup('payment', 'How would you like to pay?', [
                { id: 'BACS', text: 'Bank transfer (BACS)' },
                { id: 'CARD', text: 'Card: your account manager will call you' }
            ], v.payment, e) +
            '<p><button type="submit" class="btn btn-yellow">Request delivery</button></p>' +
            '</form>';

        return page({ title: 'Arrange delivery', logoUrl: m.logoUrl, am: m.am, body: body });
    }

    /**
     * The page after a successful request.
     * @param {Object} m - { logoUrl, am, payment ('BACS'|'CARD'), bank, tranId, backUrl, dateKey,
     *                       timeText }
     */
    function confirmation(m) {
        var body = '<h1>Thank you</h1><div class="card"><p>We\'ve received your delivery request ' +
            'for order <strong>' + esc(m.tranId) + '</strong>' +
            (m.dateKey ? ' on <strong>' + esc(dates.formatLong(m.dateKey)) + '</strong>' +
                (m.timeText ? ' (' + esc(m.timeText) + ')' : '') : '') + '.</p>';
        if (m.payment === 'BACS') {
            body += '<p>Please pay by bank transfer:</p>' + bankPanel(m.bank, m.tranId);
        } else {
            body += '<p>Your account manager' + (m.am && m.am.name ? ', ' + esc(m.am.name) + ',' : '') +
                ' will call you to take payment. We never ask for card details online.</p>';
        }
        body += '</div><p><a class="btn btn-purple" href="' + esc(m.backUrl) +
            '">Back to your projects</a></p>';
        return page({ title: 'Delivery requested', logoUrl: m.logoUrl, am: m.am, body: body });
    }

    // ---------------------------------------------------------------- email

    function emailBadge(kind, text) {
        var c = BADGES[kind] || BADGES.quote;
        return '<span style="background:' + c.bg + ';color:' + c.fg + ';border-radius:12px;padding:2px 10px;' +
            'font-size:13px;font-weight:bold;white-space:nowrap">' + esc(text) + '</span>';
    }

    /**
     * One line per project for the digest. Pure.
     * @returns {Array<{section: string, title: string, badgeKind: string, badgeText: string,
     *                   needed: string}>}
     */
    function digestRows(groups, payBacs) {
        var rows = [];
        var i;
        var j;
        var o;
        var opp;
        var states;
        var kind;
        var text;
        var needed;

        for (i = 0; i < groups.forDelivery.length; i++) {
            opp = groups.forDelivery[i].opp;
            states = groups.forDelivery[i].orders;
            for (j = 0; j < states.length; j++) {
                o = states[j].order;
                if (states[j].state === 'booked') {
                    kind = 'ready'; text = 'Delivery booked';
                    needed = 'Nothing: delivery is booked for ' + dates.formatLong(o.confirmedDateKey) + '.';
                } else if (states[j].state === 'awaiting_payment') {
                    kind = 'awaiting_payment'; text = 'Awaiting payment';
                    needed = o.payIntent === String(payBacs) ?
                        'Your bank transfer, reference ' + o.tranId + '. We book delivery once it arrives.' :
                        'Your account manager will call you to take payment.';
                } else if (states[j].state === 'ready') {
                    kind = 'ready'; text = 'Ready to deliver';
                    needed = 'Choose your delivery date: use the button below.';
                } else {
                    kind = 'needs_info'; text = 'Needs information';
                    needed = (o.holdReason ? o.holdReason + '. ' : '') +
                        'Your account manager will be in touch.';
                }
                rows.push({ section: 'Projects for delivery',
                    title: (opp.title || opp.tranId) + ': ' + (o.quoteTypeText || 'Order') + ' (' + o.tranId + ')',
                    badgeKind: kind, badgeText: text, needed: needed });
            }
        }
        for (i = 0; i < groups.inDesign.length; i++) {
            opp = groups.inDesign[i].opp;
            if (groups.inDesign[i].badge === 'needs_info') {
                rows.push({ section: 'Projects in design', title: opp.title || opp.tranId,
                    badgeKind: 'needs_info', badgeText: 'We need information',
                    needed: 'We need some information from you before we can design your system.' });
            } else {
                rows.push({ section: 'Projects in design', title: opp.title || opp.tranId,
                    badgeKind: 'in_design', badgeText: 'Designing your system',
                    needed: 'Nothing: we are designing your system.' });
            }
        }
        for (i = 0; i < groups.toOrder.length; i++) {
            opp = groups.toOrder[i];
            rows.push({ section: 'Projects to order', title: opp.title || opp.tranId,
                badgeKind: 'quote', badgeText: 'Quote sent',
                needed: 'Your quote is ready whenever you are.' });
        }
        return rows;
    }

    /**
     * The digest email body.
     * @param {Object} m - { customerName, logoUrl, rows (digestRows), anyReady, link, am {name,
     *                       phone, email}, digestDays }
     * @returns {string}
     */
    function digestEmail(m) {
        var td = 'style="font-family:' + FONT.replace(/'/g, '') + ';font-size:15px;color:' + COLORS.TEXT + '"';
        var html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
            'style="background:' + COLORS.PAGE + '"><tr><td align="center" style="padding:16px">' +
            '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ' +
            'style="max-width:600px;width:100%;background:' + COLORS.CARD + ';border:1px solid ' +
            COLORS.BORDER + '">';
        var section = '';
        var i;
        var r;

        html += '<tr><td style="background:' + COLORS.PURPLE + ';padding:14px 20px;color:#ffffff">' +
            (m.logoUrl ? '<img src="' + esc(m.logoUrl) + '" alt="Nu-Heat" height="40" style="height:40px;border:0">' :
                '<strong style="font-size:20px;color:#ffffff">Nu-Heat</strong>') + '</td></tr>';
        html += '<tr><td ' + td + ' ><div style="padding:20px 20px 0">' +
            '<p style="margin:0 0 8px">Hello ' + esc(m.customerName) + ',</p>' +
            '<p style="margin:0 0 12px">Here is where your projects with us stand.</p></div></td></tr>';

        if (m.anyReady) {
            html += '<tr><td style="padding:0 20px"><table role="presentation" width="100%" cellpadding="12" ' +
                'cellspacing="0" border="0"><tr><td ' + td.replace('style="', 'style="background:' +
                COLORS.YELLOW + ';font-weight:bold;') + '>Good news: an order is ready to deliver. ' +
                'Choose your delivery date online.</td></tr></table></td></tr>';
        }

        html += '<tr><td style="padding:8px 20px"><table role="presentation" width="100%" cellpadding="0" ' +
            'cellspacing="0" border="0">';
        for (i = 0; i < m.rows.length; i++) {
            r = m.rows[i];
            if (r.section !== section) {
                section = r.section;
                html += '<tr><td colspan="2" style="padding:16px 0 6px;font-family:Calibri,sans-serif;' +
                    'font-size:17px;font-weight:bold;color:' + COLORS.PURPLE + '">' + esc(section) + '</td></tr>';
            }
            html += '<tr><td ' + td.replace('style="', 'style="padding:8px 8px 8px 0;border-top:1px solid ' +
                COLORS.BORDER + ';') + '><strong>' + esc(r.title) + '</strong><br>' +
                '<span style="color:' + COLORS.SECONDARY + '">' + esc(r.needed) + '</span></td>' +
                '<td align="right" valign="top" style="padding:8px 0;border-top:1px solid ' + COLORS.BORDER + '">' +
                emailBadge(r.badgeKind, r.badgeText) + '</td></tr>';
        }
        html += '</table></td></tr>';

        html += '<tr><td align="center" style="padding:20px">' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
            '<td style="background:' + COLORS.YELLOW + ';border-radius:6px">' +
            '<a href="' + esc(m.link) + '" style="display:inline-block;padding:12px 24px;font-family:' +
            'Calibri,sans-serif;font-size:16px;font-weight:bold;color:' + COLORS.YELLOW_TEXT +
            ';text-decoration:none">VIEW YOUR PROJECTS</a></td></tr></table></td></tr>';

        if (m.am && m.am.name) {
            html += '<tr><td style="padding:0 20px 20px"><table role="presentation" width="100%" ' +
                'cellpadding="12" cellspacing="0" border="0" style="border:1px solid ' + COLORS.BORDER +
                '"><tr><td ' + td + '><strong>Your account manager</strong><br>' + esc(m.am.name) +
                (m.am.phone ? '<br>' + esc(m.am.phone) : '') +
                (m.am.email ? '<br><a href="mailto:' + esc(m.am.email) + '" style="color:' + COLORS.PURPLE +
                    '">' + esc(m.am.email) + '</a>' : '') + '</td></tr></table></td></tr>';
        }

        html += '<tr><td style="padding:12px 20px 20px;font-family:Calibri,sans-serif;font-size:13px;color:' +
            COLORS.SECONDARY + '">You get this update every ' + esc(m.digestDays) + ' days while you have ' +
            'an open project or order with us. To stop these updates, reply to this email.</td></tr>';

        return html + '</table></td></tr></table>';
    }

    return {
        VERSION: VERSION,
        COLORS: COLORS,
        BADGES: BADGES,
        INVALID_LINK_TEXT: INVALID_LINK_TEXT,
        esc: esc,
        page: page,
        invalidPage: invalidPage,
        errorPage: errorPage,
        dashboard: dashboard,
        deliveryForm: deliveryForm,
        confirmation: confirmation,
        digestRows: digestRows,
        digestEmail: digestEmail
    };
});
