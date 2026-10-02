/**
 * cdb_lib_designinfo.js
 *
 * Release 2.3, "Tell us about your property": the pure parts of the design information page. No
 * NetSuite module: everything here takes plain values and is node-tested (test/designinfo-lib.test.js).
 *
 *   THE REGISTRY   parseRegistry(): content/design-info-registry.csv, read from the File Cabinet per
 *                  request (setting DESIGNINFO_REGISTRY). A bad ROW is rejected and listed, never the file;
 *                  only a missing column (or unreadable CSV) makes the whole registry invalid.
 *   THE FACTS      buildFacts(): what the opportunity's Sales MI and design service say (FC_MAP, HEAT_MAP,
 *                  VP_MAP, NEWBUILD_MARKET_IDS). Unknowns are explicit values and each one is a warning.
 *   VISIBILITY     whenMatches() / visibleQuestions(): the registry's `when` column against the facts.
 *   PROGRESS       sectionStatus(), completeness(), progressFromState(), cardState().
 *   THE STATE      parseState() / stateText(): custbody_cdb_designinfo_state, the JSON the dashboard keeps.
 *   UPLOADS        the allowed extensions, the size limit, the stored file name.
 *
 * WHO WRITES WHAT is decided by the registry's `field` column: '' or 'note' -> the Note only (and the state,
 * for the progress); 'state' -> the state only (yesno); a custbody_ ID -> that opportunity field, when it is in
 * the allow-list (config.FIELDS.OPPORTUNITY) and NOT in the deny-list (config.DESIGNINFO_DENY: the goods
 * date custbody_opp_del_date, the sub-status, the Sales MI fields, custbody_cad_des_contact, ...).
 *
 * 1.0.1 (amendment 2): parseFcMapOnly() — the request button and Suitelet read FC_MAP only; capPending() — the change
 * list since the last Send is at most PENDING_MAX entries and PENDING_MAX_CHARS of JSON, the oldest dropped behind one
 * marker entry; stateTextGuarded() — a state over STATE_MAX_CHARS keeps only the last 10 pending entries; plainValue()
 * and sameText() — the Note and the Task are plain text (control characters stripped, clipped, never HTML-escaped),
 * and an answer is compared with its line endings normalised.
 *
 * House style is ES5 throughout: var, function, 'use strict'. Deliberate. Do not modernise.
 *
 * 1.0.2 (amendment 3): custbody_cdb_designinfo_state is a TEXT AREA (4,000 characters): a Long Text field can be
 * neither a search column nor a lookupFields column ("invalid column" in Production). The state is version 2, compact
 * (s, a, n, f, req, sent, task; times to the minute); the change list (pending, capPending()) is gone — the Notes are
 * the audit trail and the Task is a snapshot; at most 20 files, names clipped to 60; over 3,500 characters the files
 * drop to the last 5 (CDB DESIGNINFO_STATE_TRIMMED); never over the field. Version 1 states are migrated on read.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.0.2
 */
define([], function () {

    'use strict';

    var VERSION = '1.0.2';

    /** The registry's columns, all required, in the documented order. Extra columns are ignored. */
    var COLUMNS = ['section', 'section_title', 'panel', 'qid', 'type', 'label', 'hint', 'options', 'field', 'required',
        'when', 'why'];

    var TYPES = ['info', 'text', 'long', 'date', 'yesno', 'choice', 'files'];

    /** Where an answer goes. */
    var STORE = { NOTE: 'note', STATE: 'state', FIELD: 'field' };

    /** The `options` value that sources a choice's options from the field's own select list. */
    var FROM_FIELD = '@field';

    /** FC_MAP tokens: the floor tokens combine with |; the single tokens stand alone. */
    var FC_FLOORS = ['solid', 'joisted', 'overfloor', 'acoustic'];
    var FC_SINGLES = ['none', 'hp', 'unknown'];
    var HEAT_VALUES = ['boiler', 'nuheat_hp', 'user_hp', 'other'];
    var SERVICE_VALUES = ['ufh', 'ufh_plus', 'hp'];

    /** The `when` keys and the values each takes. */
    var WHEN_VALUES = {
        service: SERVICE_VALUES.concat(['unknown']),
        fc: FC_FLOORS.concat(FC_SINGLES),
        heat: HEAT_VALUES,
        newbuild: ['yes', 'no']
    };

    /** An unknown design service shows the UFH Design + set (brief §2, VP_MAP). */
    var UNKNOWN_SERVICE_AS = 'ufh_plus';

    var LIMITS = {
        TEXT: 300,
        LONG: 4000,
        // The Note's body (Note.note is a 4,000-character text area): clipped here, visibly.
        NOTE_BODY: 3900,
        // One value in the Note or the Task.
        NOTE_VALUE: 300,
        MAX_FILES_DEFAULT: 6,
        FILE_BYTES: 10 * 1024 * 1024
    };

    var ALLOWED_EXTENSIONS = ['pdf', 'dwg', 'dxf', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'doc', 'docx', 'xls', 'xlsx',
        'tif', 'tiff'];

    /**
     * Amendment 1 §1: the goods date. Note and state only — NEVER custbody_opp_del_date, which the sync copies
     * onto the sales orders' ship dates after Won. The page shows the opportunity's date beside it, read-only.
     */
    var GOODS_DATE_QID = 'goods_date';

    /** The "I have files bigger than 10 MB" tick: wording only, into the state, the Note and the Task. */
    var BIG_FILES_QID = 'bigfiles';

    /**
     * Amendment 3: version 2, compact, for a Text Area of 4,000 characters. No change list (the Notes are the audit trail;
     * the Task is a snapshot); at most STATE_FILES files with names of STATE_FILE_NAME characters; trimmed over
     * STATE_TRIM_AT; never over the field.
     */
    var STATE_VERSION = 2;
    var STATE_FILES = 20;
    var STATE_FILE_NAME = 60;
    var STATE_TRIM_AT = 3500;
    var STATE_TRIM_FILES = 5;
    var STATE_HARD_MAX = 3900;

    /** The four project-card states (brief §6), plus the FC-none card, which shows "In design" as before. */
    var CARD = { NEEDS_INFO: 'needs_info', INFO_PARTIAL: 'info_partial', INFO_SENT: 'info_sent', DESIGNING: 'designing',
        FC_NONE: 'fc_none' };

    // ---------------------------------------------------------------- text

    function trim(value) {
        return String(value === null || value === undefined ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    function contains(list, value) {
        var i;
        for (i = 0; i < (list || []).length; i++) {
            if (String(list[i]) === String(value)) {
                return true;
            }
        }
        return false;
    }

    function isBlankValue(value) {
        return value === null || value === undefined || value === false || trim(value) === '';
    }

    // ---------------------------------------------------------------- CSV

    /**
     * Pure: a CSV document as rows of cells. Copes with a UTF-8 BOM, CRLF or LF, quoted cells holding commas,
     * doubled quotes ("") and newlines (Excel's output), and unquoted cells (a hand edit). A quote counts only at
     * the start of a cell; elsewhere it is a character.
     * @param {string} text
     * @returns {{rows: string[][], error: string}} error 'unterminated quote' when a quoted cell never closes
     */
    function parseCsv(text) {
        var s = String(text === null || text === undefined ? '' : text);
        var rows = [];
        var row = [];
        var cell = '';
        var quoted = false;
        var started = false;
        var i = 0;
        var c;
        if (s.charCodeAt(0) === 0xFEFF) {
            s = s.slice(1);
        }
        function endRow() {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            started = false;
        }
        while (i < s.length) {
            c = s.charAt(i);
            if (quoted) {
                if (c === '"') {
                    if (s.charAt(i + 1) === '"') {
                        cell += '"';
                        i += 2;
                        continue;
                    }
                    quoted = false;
                } else {
                    cell += c;
                }
                i += 1;
                continue;
            }
            if (c === '"' && !started) {
                quoted = true;
                started = true;
            } else if (c === ',') {
                row.push(cell);
                cell = '';
                started = false;
            } else if (c === '\r' || c === '\n') {
                if (c === '\r' && s.charAt(i + 1) === '\n') {
                    i += 1;
                }
                endRow();
            } else {
                cell += c;
                started = true;
            }
            i += 1;
        }
        if (quoted) {
            return { rows: rows, error: 'unterminated quote' };
        }
        if (cell !== '' || row.length) {
            endRow();
        }
        return { rows: rows, error: '' };
    }

    // ---------------------------------------------------------------- when

    /**
     * Pure: `key=value[,value][;key=value…]` — AND across ;, OR within ,. Keys and values are WHEN_VALUES;
     * anything else is a syntax error. '' is no condition.
     * @param {string} text
     * @returns {{ok: boolean, clauses: Array<{key: string, values: string[]}>, error: string}}
     */
    function parseWhen(text) {
        var t = trim(text);
        var clauses = [];
        var parts;
        var i;
        var j;
        var m;
        var key;
        var values;
        if (t === '') {
            return { ok: true, clauses: [], error: '' };
        }
        parts = t.split(';');
        for (i = 0; i < parts.length; i++) {
            m = /^\s*([a-z_]+)\s*=\s*([^=]+?)\s*$/i.exec(parts[i]);
            if (!m) {
                return { ok: false, clauses: [], error: 'when: "' + trim(parts[i]) + '" is not key=value' };
            }
            key = m[1].toLowerCase();
            if (!WHEN_VALUES.hasOwnProperty(key)) {
                return { ok: false, clauses: [], error: 'when: unknown key "' + key + '"' };
            }
            values = m[2].split(',').map(function (v) { return trim(v).toLowerCase(); });
            for (j = 0; j < values.length; j++) {
                if (!contains(WHEN_VALUES[key], values[j])) {
                    return { ok: false, clauses: [], error: 'when: "' + values[j] + '" is not a value of ' + key };
                }
            }
            clauses.push({ key: key, values: values });
        }
        return { ok: true, clauses: clauses, error: '' };
    }

    /**
     * Pure: does a `when` hold for these facts? An empty when is true. fc matches when ANY of the facts' tokens
     * is listed. An unknown service matches as UFH Design + (and also matches an explicit `unknown`).
     * @param {string|Object} when - the text, or parseWhen()'s result, or a question (its .when)
     * @param {Object} facts - buildFacts()
     * @returns {boolean} false for a when that does not parse
     */
    function whenMatches(when, facts) {
        var parsed = typeof when === 'string' || when === null || when === undefined ? parseWhen(when) : when;
        var f = facts || {};
        var i;
        var c;
        var ok;
        if (!parsed.ok) {
            return false;
        }
        for (i = 0; i < parsed.clauses.length; i++) {
            c = parsed.clauses[i];
            if (c.key === 'service') {
                ok = contains(c.values, f.service) || (f.service === 'unknown' && contains(c.values, UNKNOWN_SERVICE_AS));
            } else if (c.key === 'fc') {
                ok = (f.fc || []).some(function (tok) { return contains(c.values, tok); });
            } else if (c.key === 'heat') {
                ok = contains(c.values, f.heat);
            } else {
                ok = contains(c.values, f.newbuild ? 'yes' : 'no');
            }
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    // ---------------------------------------------------------------- the registry

    /**
     * Pure (brief §3.1): the question registry.
     *
     * @param {string} text - the CSV
     * @param {string[]} allow - the field IDs a question may write (the values of config.FIELDS.OPPORTUNITY)
     * @param {string[]} [deny] - field IDs no question may write, even when allowed (config.DESIGNINFO_DENY)
     * @returns {{status: string, questions: Object[], rejected: Array<{line: number, qid: string, reason: string}>,
     *            detail: string}}
     *   status 'ok' (at least one question), 'empty' (no text, or no rows), 'invalid' (a column is missing or the
     *   CSV does not parse). Each question: { section, sectionTitle, panel, qid, type, label, hint, options
     *   (labels, or null), optionsFromField, field ('' unless store is field), store (STORE), required, whenText,
     *   when (parseWhen()), why, line }. File order.
     */
    function parseRegistry(text, allow, deny) {
        var out = { status: 'empty', questions: [], rejected: [], detail: '' };
        var csv;
        var header;
        var col = {};
        var missing = [];
        var seen = {};
        var titles = {};
        var i;
        var r;
        var q;
        var reason;

        if (trim(text) === '') {
            out.detail = 'the registry is empty';
            return out;
        }
        csv = parseCsv(text);
        if (csv.error) {
            out.status = 'invalid';
            out.detail = 'the CSV does not parse: ' + csv.error;
            return out;
        }
        header = (csv.rows[0] || []).map(function (h) { return trim(h).toLowerCase(); });
        header.forEach(function (h, n) {
            if (!col.hasOwnProperty(h)) {
                col[h] = n;
            }
        });
        COLUMNS.forEach(function (c) {
            if (!col.hasOwnProperty(c)) {
                missing.push(c);
            }
        });
        if (missing.length) {
            out.status = 'invalid';
            out.detail = 'missing column' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ');
            return out;
        }

        function cell(row, name) {
            return trim(row[col[name]]);
        }

        for (i = 1; i < csv.rows.length; i++) {
            r = csv.rows[i];
            if (r.every(function (c) { return trim(c) === ''; })) {
                continue;
            }
            q = {
                line: i + 1,
                section: cell(r, 'section'),
                sectionTitle: cell(r, 'section_title'),
                panel: cell(r, 'panel'),
                qid: cell(r, 'qid'),
                type: cell(r, 'type').toLowerCase(),
                label: cell(r, 'label'),
                hint: cell(r, 'hint'),
                options: null,
                optionsFromField: false,
                field: '',
                store: STORE.NOTE,
                required: false,
                whenText: cell(r, 'when'),
                when: null,
                why: cell(r, 'why')
            };
            reason = rowProblem(q, cell(r, 'field'), cell(r, 'options'), cell(r, 'required'), allow, deny, seen);
            if (reason) {
                out.rejected.push({ line: q.line, qid: q.qid, reason: reason });
                continue;
            }
            seen[q.qid] = true;
            // A section's title is its first row's.
            if (!titles.hasOwnProperty(q.section)) {
                titles[q.section] = q.sectionTitle || q.section;
            }
            q.sectionTitle = titles[q.section];
            out.questions.push(q);
        }
        out.status = out.questions.length ? 'ok' : 'empty';
        if (!out.questions.length) {
            out.detail = 'no usable rows';
        }
        return out;
    }

    /** One row's checks, filling q as it goes; '' when the row is usable, else why not. */
    function rowProblem(q, field, options, required, allow, deny, seen) {
        var id = /^[a-z0-9_]+$/;
        var parsed;
        var labels;
        if (!id.test(q.qid)) {
            return 'qid "' + q.qid + '" must be lower-case letters, digits and _';
        }
        if (seen[q.qid]) {
            return 'duplicate qid "' + q.qid + '"';
        }
        if (!id.test(q.section)) {
            return 'section "' + q.section + '" must be lower-case letters, digits and _';
        }
        if (!id.test(q.panel)) {
            return 'panel "' + q.panel + '" must be lower-case letters, digits and _';
        }
        if (!contains(TYPES, q.type)) {
            return 'unknown type "' + q.type + '"';
        }
        if (q.type !== 'info' && q.label === '') {
            return 'no label';
        }
        // The field.
        if (field === '' || field.toLowerCase() === 'note') {
            q.store = STORE.NOTE;
        } else if (field.toLowerCase() === 'state') {
            if (q.type !== 'yesno') {
                return 'field "state" is for yesno questions only';
            }
            q.store = STORE.STATE;
        } else {
            if (q.type === 'files' || q.type === 'info') {
                return 'a ' + q.type + ' question writes no field (use note)';
            }
            if (!/^custbody/.test(field) || !contains(allow, field)) {
                return 'field "' + field + '" is not an opportunity field the dashboard knows (config.FIELDS.OPPORTUNITY)';
            }
            if (contains(deny, field)) {
                return 'field "' + field + '" may never be written from this page';
            }
            q.store = STORE.FIELD;
            q.field = field;
        }
        // The options.
        if (q.type === 'choice') {
            if (options === FROM_FIELD) {
                if (q.store !== STORE.FIELD) {
                    return 'options "@field" needs a field';
                }
                q.optionsFromField = true;
            } else {
                labels = options.split('|').map(trim).filter(function (x) { return x !== ''; });
                if (!labels.length) {
                    return 'a choice needs options: labels separated by |, or @field';
                }
                q.options = labels;
            }
        }
        // Required.
        if (required === '' || /^n$/i.test(required)) {
            q.required = false;
        } else if (/^y$/i.test(required)) {
            q.required = q.type !== 'info';
        } else {
            return 'required must be Y or N, not "' + required + '"';
        }
        parsed = parseWhen(q.whenText);
        if (!parsed.ok) {
            return parsed.error;
        }
        q.when = parsed;
        return '';
    }

    /**
     * Pure: the registry's sections, in file order, each with its questions.
     * @param {Object[]} questions
     * @returns {Array<{id: string, title: string, questions: Object[]}>}
     */
    function sectionsOf(questions) {
        var list = [];
        var byId = {};
        (questions || []).forEach(function (q) {
            if (!byId[q.section]) {
                byId[q.section] = { id: q.section, title: q.sectionTitle, questions: [] };
                list.push(byId[q.section]);
            }
            byId[q.section].questions.push(q);
        });
        return list;
    }

    // ---------------------------------------------------------------- the maps and the facts

    /** Pure: a JSON object setting; never throws. */
    function jsonObject(raw) {
        var v;
        if (trim(raw) === '') {
            return { status: 'empty', value: {}, detail: '' };
        }
        try {
            v = JSON.parse(String(raw));
        } catch (e) {
            return { status: 'invalid', value: {}, detail: 'not JSON' };
        }
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
            return { status: 'invalid', value: {}, detail: 'not a JSON object' };
        }
        return { status: 'ok', value: v, detail: '' };
    }

    /**
     * Pure: FC_MAP {"<fc pair id>": "solid|joisted"}. A value is |-joined floor tokens, or ONE of none, hp,
     * unknown. A bad entry is ignored (that ID is then unknown) and listed in rejected.
     * @returns {{status: string, map: Object, rejected: string[], detail: string}} map: id -> token[]
     */
    function parseFcMap(raw) {
        var json = jsonObject(raw);
        var out = { status: json.status, map: {}, rejected: [], detail: json.detail };
        var key;
        var tokens;
        for (key in json.value) {
            if (!json.value.hasOwnProperty(key)) {
                continue;
            }
            tokens = typeof json.value[key] === 'string' ? json.value[key].split('|').map(function (t) {
                return trim(t).toLowerCase();
            }) : [];
            if (/^\d+$/.test(trim(key)) && fcTokensOk(tokens)) {
                out.map[trim(key)] = tokens;
            } else {
                out.rejected.push(key + ': ' + JSON.stringify(json.value[key]));
            }
        }
        return out;
    }

    function fcTokensOk(tokens) {
        var seen = {};
        if (!tokens.length) {
            return false;
        }
        if (tokens.length === 1 && contains(FC_SINGLES, tokens[0])) {
            return true;
        }
        return tokens.every(function (t) {
            var ok = contains(FC_FLOORS, t) && !seen[t];
            seen[t] = true;
            return ok;
        });
    }

    /** Pure: an {"<id>": "<one of values>"} map (HEAT_MAP, VP_MAP). Bad entries are ignored and listed. */
    function parseValueMap(raw, values) {
        var json = jsonObject(raw);
        var out = { status: json.status, map: {}, rejected: [], detail: json.detail };
        var key;
        var v;
        for (key in json.value) {
            if (!json.value.hasOwnProperty(key)) {
                continue;
            }
            v = typeof json.value[key] === 'string' ? trim(json.value[key]).toLowerCase() : '';
            if (/^\d+$/.test(trim(key)) && contains(values, v)) {
                out.map[trim(key)] = v;
            } else {
                out.rejected.push(key + ': ' + JSON.stringify(json.value[key]));
            }
        }
        return out;
    }

    /**
     * Pure (1.0.1): FC_MAP alone, in parseMaps()' shape (heat and vp empty) — for the request button and the Send
     * design information Suitelet's rule, which read no other map.
     */
    function parseFcMapOnly(cfg) {
        var fc = parseFcMap((cfg || {}).FC_MAP);
        return { fc: fc.map, heat: {}, vp: {}, fcEmpty: fc.status !== 'ok',
            problems: fc.status === 'invalid' ? ['FC_MAP ignored: ' + fc.detail] : [] };
    }

    function parseHeatMap(raw) {
        return parseValueMap(raw, HEAT_VALUES);
    }

    function parseVpMap(raw) {
        return parseValueMap(raw, SERVICE_VALUES);
    }

    /**
     * Pure: the three maps of a config, and what is wrong with them (for one CDB DESIGNINFO_MAP_INVALID line).
     * @param {Object} cfg - FC_MAP, HEAT_MAP, VP_MAP (raw setting text)
     * @returns {{fc: Object, heat: Object, vp: Object, fcEmpty: boolean, problems: string[]}}
     */
    function parseMaps(cfg) {
        var c = cfg || {};
        var fc = parseFcMap(c.FC_MAP);
        var heat = parseHeatMap(c.HEAT_MAP);
        var vp = parseVpMap(c.VP_MAP);
        var problems = [];
        [['FC_MAP', fc], ['HEAT_MAP', heat], ['VP_MAP', vp]].forEach(function (p) {
            if (p[1].status === 'invalid') {
                problems.push(p[0] + ' ignored: ' + p[1].detail);
            } else if (p[1].rejected.length) {
                problems.push(p[0] + ' entries ignored: ' + p[1].rejected.join('; '));
            }
        });
        return { fc: fc.map, heat: heat.map, vp: vp.map, fcEmpty: fc.status !== 'ok', problems: problems };
    }

    /**
     * Pure: an opportunity's FC tokens, ['unknown'] when the ID is not mapped (or blank).
     * @param {Object} maps - parseMaps()
     * @param {string} fcId
     * @returns {string[]}
     */
    function fcTokens(maps, fcId) {
        var id = trim(fcId);
        return id !== '' && maps.fc.hasOwnProperty(id) ? maps.fc[id].slice() : ['unknown'];
    }

    /** Pure: true when the FC needs nothing from the customer (OneZone, Electric UFH, Parts). */
    function isFcNone(tokens) {
        return (tokens || []).length === 1 && tokens[0] === 'none';
    }

    /**
     * Pure (brief §3.2): the facts the registry's `when` reads.
     *
     * @param {Object} opp - plain values read from the record, IDs as strings: { valueProposition, fc, heatSource,
     *   market, subStatus, manifolds (custbody_manifold_locations_2026's current text, '' when none) }
     * @param {Object} cfg - FC_MAP, HEAT_MAP, VP_MAP, NEWBUILD_MARKET_IDS, NEEDINFO_SUBSTATUS, DESIGN_SUBSTATUS
     * @returns {{service: string, fc: string[], heat: string, newbuild: boolean, manifoldsText: string,
     *            substatusMode: string, warnings: string[], mapProblems: string[]}}
     *   service ufh | ufh_plus | hp | unknown; fc tokens (['unknown'] when unmapped); heat boiler | nuheat_hp |
     *   user_hp | other; substatusMode 'edit' (NEEDINFO), 'view' (DESIGN) or ''.
     */
    function buildFacts(opp, cfg) {
        var o = opp || {};
        var c = cfg || {};
        var maps = parseMaps(c);
        var vp = trim(o.valueProposition);
        var fcId = trim(o.fc);
        var heatId = trim(o.heatSource);
        var facts = {
            service: vp !== '' && maps.vp.hasOwnProperty(vp) ? maps.vp[vp] : 'unknown',
            fc: fcTokens(maps, fcId),
            heat: heatId !== '' && maps.heat.hasOwnProperty(heatId) ? maps.heat[heatId] : 'other',
            newbuild: trim(o.market) !== '' && contains(c.NEWBUILD_MARKET_IDS, trim(o.market)),
            manifoldsText: trim(o.manifolds),
            substatusMode: contains(c.NEEDINFO_SUBSTATUS, o.subStatus) ? 'edit' :
                contains(c.DESIGN_SUBSTATUS, o.subStatus) ? 'view' : '',
            warnings: [],
            mapProblems: maps.problems
        };
        if (facts.service === 'unknown') {
            facts.warnings.push('Design service unknown: value proposition ' + (vp || '(blank)') + ' is not in VP_MAP, ' +
                'so the customer was shown the UFH Design + questions.');
        }
        if (facts.fc.length === 1 && facts.fc[0] === 'unknown') {
            facts.warnings.push('Floor construction unknown: FC ' + (fcId || '(blank)') + ' is not in FC_MAP.');
        }
        if (heatId === '' || !maps.heat.hasOwnProperty(heatId)) {
            facts.warnings.push('Heat source ' + (heatId ? heatId + ' is not in HEAT_MAP' : 'not set') +
                ', so it was treated as "other".');
        }
        if (facts.service === 'hp' && facts.heat !== 'nuheat_hp') {
            facts.warnings.push('The design service is HP Design, but the heat source is not a Nu-Heat heat pump.');
        } else if (facts.heat === 'nuheat_hp' && facts.service !== 'hp' && facts.service !== 'unknown') {
            facts.warnings.push('The heat source is a Nu-Heat heat pump, but the design service is not HP Design.');
        }
        return facts;
    }

    /**
     * Pure: the questions whose `when` holds. A section shows when at least one of its questions does.
     * @returns {Object[]} in registry order
     */
    function visibleQuestions(questions, facts) {
        return (questions || []).filter(function (q) {
            return whenMatches(q.when || q.whenText || '', facts);
        });
    }

    // ---------------------------------------------------------------- the state

    function emptyState() {
        return { v: STATE_VERSION, sections: {}, answers: {}, noted: {}, files: [], requested: '', sent: '', lastTaskAt: '' };
    }

    /** The section status codes as stored (v2) and as used. */
    var STATUS_CODE = { done: 'done', todo: 'todo', optional: 'opt' };
    var STATUS_OF_CODE = { done: 'done', todo: 'todo', opt: 'optional', optional: 'optional' };

    /**
     * Pure (1.0.2): an ISO time to the minute, "2026-10-02T14:02Z" — the form every time in the state is stored in, so
     * stored times compare as strings. '' for anything else.
     */
    function shortIso(value) {
        var ms = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
        return isNaN(ms) ? '' : new Date(ms).toISOString().slice(0, 16) + 'Z';
    }

    function str(v) {
        return typeof v === 'string' ? v : '';
    }

    /**
     * Pure (brief §5.6; amendment 3): custbody_cdb_designinfo_state — a TEXT AREA (4,000 characters), so it is a valid
     * search column and lookupFields column (a Long Text field is neither). Reads version 2 (stored) and version 1
     * (amendment 2 and before, migrated: pending dropped, keys renamed). Missing -> empty; unparsable, not an object or
     * another version -> empty with status 'invalid' (the caller logs CDB DESIGNINFO_STATE_INVALID once). Never throws.
     *
     * In memory: { v, sections: { id: { saved, status } }, answers: { qid: value }, noted: { qid: true },
     *   files: [{ qid, id, name, at, attached }], requested, sent, lastTaskAt }.
     * @param {*} raw
     * @returns {{state: Object, status: string, detail: string}} status 'empty' | 'ok' | 'invalid'
     */
    function parseState(raw) {
        var s = emptyState();
        var v;
        var k;
        if (trim(raw) === '') {
            return { state: s, status: 'empty', detail: '' };
        }
        try {
            v = JSON.parse(String(raw));
        } catch (e) {
            return { state: s, status: 'invalid', detail: 'not JSON' };
        }
        if (!v || typeof v !== 'object' || Array.isArray(v) || (v.v !== 1 && v.v !== STATE_VERSION)) {
            return { state: s, status: 'invalid', detail: 'not a version 1 or ' + STATE_VERSION + ' state object' };
        }
        if (v.v === 1) {
            // Migrate on read: the long keys, a noted time per qid, the files' long keys; pending is dropped.
            for (k in plainObject(v.sections)) {
                if (v.sections.hasOwnProperty(k) && v.sections[k] && typeof v.sections[k] === 'object') {
                    s.sections[k] = { saved: str(v.sections[k].saved), status: STATUS_OF_CODE[v.sections[k].status] || 'todo' };
                }
            }
            s.answers = plainObject(v.answers);
            for (k in plainObject(v.noted)) {
                if (v.noted.hasOwnProperty(k) && v.noted[k]) {
                    s.noted[k] = true;
                }
            }
            s.files = (Array.isArray(v.files) ? v.files : []).filter(function (f) { return f && typeof f === 'object'; })
                .map(function (f) {
                    return { qid: str(f.qid), id: String(f.id || ''), name: str(f.name), at: str(f.at), attached: f.attached !== false };
                });
            s.requested = str(v.requested);
            s.sent = str(v.sent);
            s.lastTaskAt = str(v.lastTaskAt);
            return { state: s, status: 'ok', detail: 'migrated from version 1' };
        }
        for (k in plainObject(v.s)) {
            if (v.s.hasOwnProperty(k) && v.s[k] && typeof v.s[k] === 'object') {
                s.sections[k] = { saved: str(v.s[k].at), status: STATUS_OF_CODE[v.s[k].st] || 'todo' };
            }
        }
        s.answers = plainObject(v.a);
        (Array.isArray(v.n) ? v.n : []).forEach(function (qid) {
            if (typeof qid === 'string' && qid) {
                s.noted[qid] = true;
            }
        });
        s.files = (Array.isArray(v.f) ? v.f : []).filter(function (f) { return f && typeof f === 'object'; })
            .map(function (f) {
                return { qid: str(f.q), id: String(f.id || ''), name: str(f.n), at: str(f.at), attached: f.x !== 1 };
            });
        s.requested = str(v.req);
        s.sent = str(v.sent);
        s.lastTaskAt = str(v.task);
        return { state: s, status: 'ok', detail: '' };
    }

    function plainObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }

    /**
     * Pure (1.0.2): the state as stored — version 2, compact: s (sections: at, st), a (answers), n (qids answered in a
     * Note; left out when none), f (the newest STATE_FILES files, names clipped to STATE_FILE_NAME), req, sent, task.
     * Times to the minute. opts.files caps the files (the size guard's trim).
     */
    function stateText(state, opts) {
        var st = state || emptyState();
        var o = opts || {};
        var sections = {};
        var noted = [];
        var k;
        var out;
        for (k in (st.sections || {})) {
            if (st.sections.hasOwnProperty(k) && st.sections[k]) {
                sections[k] = { at: shortIso(st.sections[k].saved), st: STATUS_CODE[st.sections[k].status] || 'todo' };
            }
        }
        for (k in (st.noted || {})) {
            if (st.noted.hasOwnProperty(k) && st.noted[k]) {
                noted.push(k);
            }
        }
        out = { v: STATE_VERSION, s: sections, a: st.answers || {} };
        if (noted.length && !o.dropNoted) {
            out.n = noted;
        }
        out.f = (st.files || []).slice(-(o.files === undefined ? STATE_FILES : o.files)).map(function (f) {
            var e = { q: f.qid, id: String(f.id), n: String(f.name || '').slice(0, STATE_FILE_NAME), at: shortIso(f.at) };
            if (f.attached === false) {
                e.x = 1;
            }
            return e;
        });
        out.req = shortIso(st.requested);
        out.sent = shortIso(st.sent);
        out.task = shortIso(st.lastTaskAt);
        return JSON.stringify(out);
    }

    /**
     * Pure (1.0.2): the state's text, guarded to fit the Text Area — over STATE_TRIM_AT (3,500) characters the files drop
     * to the last STATE_TRIM_FILES (5); still over STATE_HARD_MAX (3,900), the noted list and the files go too; still over,
     * the answers. It never exceeds the field. Older files stay on the opportunity and in the Notes.
     * @returns {{text: string, trimmed: boolean}}
     */
    function stateTextGuarded(state) {
        var text = stateText(state);
        var slim;
        if (text.length <= STATE_TRIM_AT) {
            return { text: text, trimmed: false };
        }
        text = stateText(state, { files: STATE_TRIM_FILES });
        if (text.length > STATE_HARD_MAX) {
            text = stateText(state, { files: 0, dropNoted: true });
        }
        if (text.length > STATE_HARD_MAX) {
            slim = parseState(text).state;
            slim.answers = {};
            text = stateText(slim, { files: 0, dropNoted: true });
        }
        return { text: text, trimmed: true };
    }

    /** Pure: a section has been saved at least once. */
    function anySectionSaved(state) {
        var k;
        for (k in (state && state.sections) || {}) {
            if (state.sections.hasOwnProperty(k) && state.sections[k] && state.sections[k].saved) {
                return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------- progress

    /**
     * Pure: does a question have an answer? files: an upload recorded for it; state: the state holds it; note:
     * values[qid] (the short answers the state keeps) or a noted mark (a long answer sent in a Note); field:
     * values[qid] (the record's current value; a checkbox counts when ticked).
     */
    function hasAnswer(q, values, state) {
        var s = state || emptyState();
        if (q.type === 'files') {
            return (s.files || []).some(function (f) { return f.qid === q.qid; });
        }
        if (q.store === STORE.STATE) {
            return !isBlankValue((s.answers || {})[q.qid]);
        }
        if (q.store === STORE.NOTE) {
            return !isBlankValue((values || {})[q.qid]) || !isBlankValue((s.answers || {})[q.qid]) ||
                !isBlankValue((s.noted || {})[q.qid]);
        }
        return !isBlankValue((values || {})[q.qid]);
    }

    /**
     * Pure (brief §3.4): one section's status, from its SHOWN questions. Questions marked unavailable (a missing
     * or mismatched field, options that could not be read) cannot be answered here and do not count.
     * @returns {string} 'done' | 'todo' | 'optional'
     */
    function sectionStatus(questions, values, state) {
        var required = (questions || []).filter(function (q) { return q.required && !q.unavailable; });
        if (!required.length) {
            return 'optional';
        }
        return required.every(function (q) { return hasAnswer(q, values, state); }) ? 'done' : 'todo';
    }

    /**
     * Pure: the shown questions' sections with their status, and what is still to do.
     * @param {Object[]} questions - visibleQuestions()
     * @returns {{complete: boolean, missing: string[], sections: Array<{id, title, status}>}}
     */
    function completeness(questions, values, state) {
        var sections = sectionsOf(questions).map(function (s) {
            return { id: s.id, title: s.title, status: sectionStatus(s.questions, values, state) };
        });
        var missing = sections.filter(function (s) { return s.status === 'todo'; }).map(function (s) { return s.title; });
        return { complete: !missing.length, missing: missing, sections: sections };
    }

    /**
     * Pure: the progress the dashboard card and the digest show, from the STATE alone (no record read): a section
     * saved carries the status it had when saved; one never saved is 'todo' when it has a required question,
     * else 'optional'.
     * @param {Object[]} questions - visibleQuestions()
     * @returns {{sections: Array<{id, title, status}>, done: string[], missing: string[], pct: number}}
     */
    function progressFromState(questions, state) {
        var s = state || emptyState();
        var sections = sectionsOf(questions).map(function (sec) {
            var saved = (s.sections || {})[sec.id];
            var status = saved && saved.status ? saved.status :
                sec.questions.some(function (q) { return q.required; }) ? 'todo' : 'optional';
            return { id: sec.id, title: sec.title, status: status, saved: !!(saved && saved.saved) };
        });
        var counted = sections.filter(function (x) { return x.status !== 'optional'; });
        var done = sections.filter(function (x) { return x.status === 'done' || (x.status === 'optional' && x.saved); })
            .map(function (x) { return x.title; });
        var missing = sections.filter(function (x) { return x.status === 'todo'; }).map(function (x) { return x.title; });
        var doneCount = counted.filter(function (x) { return x.status === 'done'; }).length;
        return { sections: sections, done: done, missing: missing,
            pct: counted.length ? Math.round(100 * doneCount / counted.length) : 100 };
    }

    /**
     * Pure (brief §6): which of the four card states a project in design is in.
     * @param {Object} o - { needInfo (sub-status in NEEDINFO_SUBSTATUS), fcNone, state (parseState().state) }
     * @returns {string} CARD
     */
    function cardState(o) {
        if (o.fcNone) {
            return CARD.FC_NONE;
        }
        if (!o.needInfo) {
            return CARD.DESIGNING;
        }
        if (o.state && o.state.sent) {
            return CARD.INFO_SENT;
        }
        return anySectionSaved(o.state) ? CARD.INFO_PARTIAL : CARD.NEEDS_INFO;
    }

    // ---------------------------------------------------------------- uploads

    /** Pure: a file name's extension, lower-case, '' when none. */
    function extensionOf(name) {
        var m = /\.([A-Za-z0-9]+)$/.exec(trim(name));
        return m ? m[1].toLowerCase() : '';
    }

    function extensionAllowed(name) {
        return contains(ALLOWED_EXTENSIONS, extensionOf(name));
    }

    /** Pure: the customer's file name, safe for the File Cabinet — letters, digits . _ - only, at most 80. */
    function sanitiseFileName(name) {
        var base = trim(name).replace(/^.*[\\\/]/, '');
        var ext = extensionOf(base);
        var stem = ext ? base.slice(0, base.length - ext.length - 1) : base;
        stem = stem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'file';
        if (stem.length > 80) {
            stem = stem.slice(0, 80);
        }
        return stem + (ext ? '.' + ext : '');
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function lastSunday(y, m) {
        var last = new Date(Date.UTC(y, m, 0));
        return last.getUTCDate() - last.getUTCDay();
    }

    /**
     * Pure: London's wall-clock time as { key: 'yyyy-mm-dd', stamp: 'yyyymmdd-HHmm', text: 'dd/mm/yyyy HH:mm' } —
     * the same BST rule as dates.londonTodayKey().
     * @param {number} nowMs
     */
    function londonTime(nowMs) {
        var y = new Date(nowMs).getUTCFullYear();
        var bstStart = Date.UTC(y, 2, lastSunday(y, 3), 1);
        var bstEnd = Date.UTC(y, 9, lastSunday(y, 10), 1);
        var d = new Date(nowMs + ((nowMs >= bstStart && nowMs < bstEnd) ? 3600000 : 0));
        var Y = d.getUTCFullYear();
        var M = pad2(d.getUTCMonth() + 1);
        var D = pad2(d.getUTCDate());
        var h = pad2(d.getUTCHours());
        var mi = pad2(d.getUTCMinutes());
        return { key: Y + '-' + M + '-' + D, stamp: '' + Y + M + D + '-' + h + mi, text: D + '/' + M + '/' + Y + ' ' + h + ':' + mi };
    }

    /** Pure (brief §4.5 step 2): <tranid>_<qid>_<yyyymmdd-HHmm>_<sanitised original>. */
    function uploadName(tranId, qid, stamp, original) {
        return sanitiseFileName(trim(tranId) || 'OPP') + '_' + qid + '_' + stamp + '_' + sanitiseFileName(original);
    }

    /** Pure: "1.2 MB" / "350 KB". */
    function sizeText(bytes) {
        var n = Number(bytes) || 0;
        if (n >= 1024 * 1024) {
            return (Math.round(n / 104857.6) / 10) + ' MB';
        }
        return Math.max(1, Math.round(n / 1024)) + ' KB';
    }

    /** Pure: 'yyyy-mm-dd' -> 'dd/mm/yyyy' (as the customer sees a date on this page); '' otherwise. */
    function slashDate(key) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(key));
        return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
    }

    /**
     * Pure (1.0.1): a value for the Note or the Task — PLAIN TEXT: control characters stripped (newlines kept, \r\n made
     * \n), clipped with …; never HTML-escaped (staff read it as typed).
     */
    function plainValue(text, max) {
        return clipValue(String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n')
            .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ''), max);
    }

    /** Pure (1.0.1): two answers equal once line endings are normalised to \n and the ends trimmed. */
    function sameText(a, b) {
        function norm(v) {
            return String(v === null || v === undefined ? '' : v).replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
        }
        return norm(a) === norm(b);
    }

    /** Pure: a value clipped for the Note and the Task, with … when cut. */
    function clipValue(text, max) {
        var t = String(text === null || text === undefined ? '' : text);
        var n = max || LIMITS.NOTE_VALUE;
        return t.length > n ? t.slice(0, n - 1) + '…' : t;
    }

    return {
        VERSION: VERSION,
        COLUMNS: COLUMNS,
        TYPES: TYPES,
        STORE: STORE,
        FROM_FIELD: FROM_FIELD,
        FC_FLOORS: FC_FLOORS,
        FC_SINGLES: FC_SINGLES,
        HEAT_VALUES: HEAT_VALUES,
        SERVICE_VALUES: SERVICE_VALUES,
        LIMITS: LIMITS,
        ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS,
        GOODS_DATE_QID: GOODS_DATE_QID,
        BIG_FILES_QID: BIG_FILES_QID,
        CARD: CARD,
        parseCsv: parseCsv,
        parseWhen: parseWhen,
        whenMatches: whenMatches,
        parseRegistry: parseRegistry,
        sectionsOf: sectionsOf,
        parseFcMap: parseFcMap,
        parseHeatMap: parseHeatMap,
        parseVpMap: parseVpMap,
        parseMaps: parseMaps,
        fcTokens: fcTokens,
        isFcNone: isFcNone,
        buildFacts: buildFacts,
        visibleQuestions: visibleQuestions,
        emptyState: emptyState,
        parseState: parseState,
        stateText: stateText,
        anySectionSaved: anySectionSaved,
        hasAnswer: hasAnswer,
        sectionStatus: sectionStatus,
        completeness: completeness,
        progressFromState: progressFromState,
        cardState: cardState,
        extensionOf: extensionOf,
        extensionAllowed: extensionAllowed,
        sanitiseFileName: sanitiseFileName,
        londonTime: londonTime,
        uploadName: uploadName,
        sizeText: sizeText,
        slashDate: slashDate,
        clipValue: clipValue,
        // 1.0.1
        STATE_FILES: STATE_FILES,
        STATE_FILE_NAME: STATE_FILE_NAME,
        STATE_TRIM_AT: STATE_TRIM_AT,
        STATE_HARD_MAX: STATE_HARD_MAX,
        shortIso: shortIso,
        parseFcMapOnly: parseFcMapOnly,
        stateTextGuarded: stateTextGuarded,
        plainValue: plainValue,
        sameText: sameText
    };
});
