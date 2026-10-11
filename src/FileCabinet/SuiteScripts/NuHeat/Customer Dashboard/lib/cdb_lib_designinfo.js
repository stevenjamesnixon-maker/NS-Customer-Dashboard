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
 * 1.1.0 (release 2.3b, the stepper): the registry v2 header (step_intro, step_minutes, image, placeholder; a v1 header
 * still parses), each section's intro and minutes from its first row (sectionsOf() carries them), and
 * unknownStateQids() for answers stored under qids the registry no longer has.
 *
 * 1.2.0 (release 2.3c): the registry v3 header (reveal, short; v1 and v2 still parse) and its new forms — literal options
 * with keys (key=Label|…), @setting:KEY and @preset:ELEMENT options, field `state` for a choice, @element:<element>[:extN]
 * and @epc, the element and epc types; parseReveal() / revealMap() (the `reveal` column: alternatives |, clauses ;, the
 * missing-question rule); the heat facts as a SET from custbody_heat_source_type_26 (DI_HEAT26_MAP, the Sales MI as the
 * fallback) and the hp set, with `when` testing membership; stepsFor() (the ONE list of steps for the stepper, Review,
 * the request page, the email and the cards); the state's rq (the steps the request asked about); the element cards'
 * pure parts (parsePresets, parseAgeBands, parseEpcMap, elementLine, parseElementLine, elementTargets, epcElement,
 * ageBandKey, fillPrefill) and parseOptionsSetting().
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @version 1.2.0
 */
define([], function () {

    'use strict';

    var VERSION = '1.2.0';

    /** The registry's columns, all required, in the documented order. Extra columns are ignored. */
    var COLUMNS = ['section', 'section_title', 'panel', 'qid', 'type', 'label', 'hint', 'options', 'field', 'required',
        'when', 'why'];

    /**
     * 1.1.0 (release 2.3b): the registry v2 columns, after `why`. All four or none: a v1 file (12 columns) still parses
     * and reads them as empty; a header with some but not all of them is neither shape and is invalid. step_intro and
     * step_minutes are read from each section's FIRST row; image is accepted and not used yet; placeholder goes in the
     * input box (the hint stays under the label).
     */
    var COLUMNS_V2 = ['step_intro', 'step_minutes', 'image', 'placeholder'];

    /**
     * 1.2.0 (release 2.3c): the registry v3 columns, after the v2 four. Both or neither: a v2 file reads them as empty. reveal
     * (parseReveal()) shows a question on the customer's own earlier answers; short is the step bar's and the email's label,
     * read from a section's first row like step_intro, falling back to section_title.
     */
    var COLUMNS_V3 = ['reveal', 'short'];

    var TYPES = ['info', 'text', 'long', 'date', 'yesno', 'choice', 'files', 'element', 'epc'];

    /**
     * Where an answer goes. 1.2.0: ELEMENT — an element card, routed to the New / Existing fields by elementTargets();
     * EPC — the EPC lookup, which writes custbody_epc_number and custbody_epc_date itself.
     */
    var STORE = { NOTE: 'note', STATE: 'state', FIELD: 'field', ELEMENT: 'element', EPC: 'epc' };

    /** 1.2.0: the `options` prefixes for options from a settings row and from content/element-presets.csv. */
    var FROM_SETTING = '@setting:';
    var FROM_PRESET = '@preset:';

    /** 1.2.0: the four building elements an element card can be, and the `field` forms. */
    var ELEMENTS = ['walls', 'windows', 'roof', 'floor'];
    var ELEMENT_FIELD = '@element:';
    var EPC_FIELD = '@epc';

    /** 1.2.0: the specials in every element card's list, after the presets (typical: renovation only). */
    var ELEMENT_SPECIALS = [
        { key: 'typical', label: 'Typical for the age of my property' },
        { key: 'regs', label: 'Built to current Building Regulations' },
        { key: 'unsure', label: 'Not sure' },
        { key: 'describe', label: 'I\'ll describe it' }
    ];

    /** 1.2.0: an element card's sources (the hidden q_<qid>_src) and the line's U-value sources. */
    var ELEMENT_SRC = ['epc', 'age', 'regs', 'you'];
    var U_SOURCES = ['customer', 'EPC', 'typical', 'regs', 'preset'];
    var U_MIN = 0.05;
    var U_MAX = 6.0;
    var ELEMENT_NOTES_MAX = 300;

    /** 1.2.0: the routing — main house and new build fields by market, extensions always New (brief §B8). */
    var ELEMENT_FIELDS = {
        new: { walls: 'custbody_new_walls_2026', windows: 'custbody_new_windows_2026', roof: 'custbody_new_roofs_2026',
            floor: 'custbody_new_floors_2026' },
        existing: { walls: 'custbody_existing_walls_2026', windows: 'custbody_existing_windows_2026',
            roof: 'custbody_existing_roofs_2026', floor: 'custbody_existing_floors_2026' }
    };
    var ELEMENT_NAMES = { walls: 'Walls', windows: 'Windows', roof: 'Roof', floor: 'Floor' };

    /** 1.2.0: the heat keys DI_HEAT26_MAP may give, and the heat pump keys among them (each also adds nuheat_hp). */
    var HEAT26_VALUES = ['ashp', 'gshp_loop', 'gshp_bore', 'user_hp', 'boiler'];
    var HP_VALUES = ['ashp', 'gshp_loop', 'gshp_bore'];

    /** The `options` value that sources a choice's options from the field's own select list. */
    var FROM_FIELD = '@field';

    /** FC_MAP tokens: the floor tokens combine with |; the single tokens stand alone. */
    var FC_FLOORS = ['solid', 'joisted', 'overfloor', 'acoustic'];
    var FC_SINGLES = ['none', 'hp', 'unknown'];
    var HEAT_VALUES = ['boiler', 'nuheat_hp', 'user_hp', 'other'];
    /** 1.2.0: every value the heat fact SET can hold (the Sales MI's four and the heat pump types). */
    var HEAT_SET_VALUES = HEAT_VALUES.concat(HP_VALUES);
    var SERVICE_VALUES = ['ufh', 'ufh_plus', 'hp'];

    /** The `when` keys and the values each takes. */
    var WHEN_VALUES = {
        service: SERVICE_VALUES.concat(['unknown']),
        fc: FC_FLOORS.concat(FC_SINGLES),
        heat: HEAT_SET_VALUES,
        hp: HP_VALUES.concat(['unknown']),
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

    /** Pure (1.2.0): a value as a list — an array as it is, a non-empty string as one item, else empty. */
    function asList(v) {
        if (Array.isArray(v)) {
            return v;
        }
        return v === null || v === undefined || v === '' ? [] : [v];
    }

    /**
     * Pure: does a `when` hold for these facts? An empty when is true. fc matches when ANY of the facts' tokens
     * is listed; 1.2.0: so do heat and hp (sets). An unknown service matches as UFH Design + (and also matches an explicit `unknown`).
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
            } else if (c.key === 'heat' || c.key === 'hp') {
                // 1.2.0: the heat facts are SETS — true when the set holds any value listed. A plain string (a caller
                // before 1.2.0) is a set of one.
                ok = asList(f[c.key]).some(function (h) { return contains(c.values, h); });
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
     * @param {Object} [opts] - 1.2.0: { settings: { KEY: raw text } — the settings rows @setting:KEY may name (any other
     *   KEY rejects the row) }
     * @returns {{status: string, questions: Object[], rejected: Array<{line: number, qid: string, reason: string}>,
     *            detail: string, headerVersion: number}}
     *   status 'ok' (at least one question), 'empty' (no text, or no rows), 'invalid' (a column is missing or the
     *   CSV does not parse). Each question: { section, sectionTitle, panel, qid, type, label, hint, options
     *   (labels, or null), optionKeys (1.2.0: the keys `reveal` compares), optionIds / optionSubs / optionFiles
     *   (@setting), optionsFromField, optionsFromSetting (the KEY, or ''), pictures, presetElement, element, ext, field
     *   ('' unless store is field), store (STORE), required, whenText, when (parseWhen()), revealText, reveal
     *   (parseReveal(), or null), why, line, stepIntro, stepMinutes, stepShort }. File order.
     */
    function parseRegistry(text, allow, deny, opts) {
        var out = { status: 'empty', questions: [], rejected: [], detail: '', headerVersion: 0 };
        var o = opts || {};
        var csv;
        var header;
        var col = {};
        var missing = [];
        var seen = {};
        var titles = {};
        var steps = {};
        var bySection = {};
        var v2;
        var v3;
        var i;
        var r;
        var q;
        var reason;
        var minutes;
        var rv;

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
        v2 = COLUMNS_V2.filter(function (c) { return col.hasOwnProperty(c); });
        v3 = COLUMNS_V3.filter(function (c) { return col.hasOwnProperty(c); });
        if ((v2.length && v2.length < COLUMNS_V2.length) || (v3.length && v3.length < COLUMNS_V3.length) ||
                (v3.length && !v2.length)) {
            out.status = 'invalid';
            out.detail = 'neither the v1, the v2 nor the v3 header: missing ' + COLUMNS_V2.concat(v3.length ? COLUMNS_V3 : [])
                .filter(function (c) { return !col.hasOwnProperty(c); }).join(', ');
            return out;
        }
        out.headerVersion = v3.length ? 3 : v2.length ? 2 : 1;

        function cell(row, name) {
            return col.hasOwnProperty(name) ? trim(row[col[name]]) : '';
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
                optionKeys: null,
                optionIds: null,
                optionSubs: null,
                optionFiles: null,
                optionsFromField: false,
                optionsFromSetting: '',
                pictures: false,
                presetElement: '',
                element: '',
                ext: '',
                field: '',
                store: STORE.NOTE,
                required: false,
                whenText: cell(r, 'when'),
                when: null,
                revealText: cell(r, 'reveal'),
                reveal: null,
                why: cell(r, 'why'),
                image: cell(r, 'image'),
                placeholder: cell(r, 'placeholder'),
                stepIntro: '',
                stepMinutes: 0,
                stepShort: ''
            };
            // 1.1.0: a section's intro and minutes come from its FIRST row in the file, used or not; 1.2.0: and its short.
            if (!steps.hasOwnProperty(q.section)) {
                minutes = cell(r, 'step_minutes');
                steps[q.section] = { intro: cell(r, 'step_intro'), minutes: /^\d+$/.test(minutes) ? parseInt(minutes, 10) : 0,
                    short: cell(r, 'short') };
            }
            reason = rowProblem(q, cell(r, 'field'), cell(r, 'options'), cell(r, 'required'), allow, deny, seen, o);
            if (!reason && cell(r, 'step_minutes') !== '' && !/^\d+$/.test(cell(r, 'step_minutes'))) {
                reason = 'step_minutes must be a whole number, not "' + cell(r, 'step_minutes') + '"';
            }
            if (!reason && q.revealText !== '') {
                rv = parseReveal(q.revealText, bySection[q.section] || {});
                if (rv.ok) {
                    q.reveal = rv;
                } else {
                    reason = rv.error;
                }
            }
            if (reason) {
                out.rejected.push({ line: q.line, qid: q.qid, reason: reason });
                continue;
            }
            seen[q.qid] = true;
            bySection[q.section] = bySection[q.section] || {};
            bySection[q.section][q.qid] = q;
            // A section's title is its first row's.
            if (!titles.hasOwnProperty(q.section)) {
                titles[q.section] = q.sectionTitle || q.section;
            }
            q.sectionTitle = titles[q.section];
            q.stepIntro = steps[q.section].intro;
            q.stepMinutes = steps[q.section].minutes;
            q.stepShort = steps[q.section].short || q.sectionTitle;
            out.questions.push(q);
        }
        out.status = out.questions.length ? 'ok' : 'empty';
        if (!out.questions.length) {
            out.detail = 'no usable rows';
        }
        return out;
    }

    /**
     * Pure (1.2.0): a settings row of options — a JSON array of { id, key, label, sub (optional), file (optional: a
     * picture's file ID) }. id and key are unique; key is lower-case letters, digits and _; label is not empty.
     * @returns {{ok: boolean, options: Array<{id: string, key: string, label: string, sub: string, file: string}>,
     *   error: string}}
     */
    function parseOptionsSetting(raw) {
        var v;
        var ids = {};
        var keys = {};
        var list = [];
        var i;
        var x;
        if (trim(raw) === '') {
            return { ok: false, options: [], error: 'the setting is empty' };
        }
        try {
            v = JSON.parse(String(raw));
        } catch (e) {
            return { ok: false, options: [], error: 'the setting is not JSON' };
        }
        if (!Array.isArray(v) || !v.length) {
            return { ok: false, options: [], error: 'the setting is not a JSON array of options' };
        }
        for (i = 0; i < v.length; i++) {
            x = v[i];
            if (!x || typeof x !== 'object' || trim(x.id) === '' || !/^[a-z0-9_]+$/.test(trim(x.key)) ||
                    typeof x.label !== 'string' || trim(x.label) === '') {
                return { ok: false, options: [], error: 'option ' + (i + 1) + ' needs an id, a key (a-z, 0-9, _) and a label' };
            }
            if (ids[trim(x.id)] || keys[trim(x.key)]) {
                return { ok: false, options: [], error: 'option ' + (i + 1) + ' repeats an id or a key' };
            }
            if (x.file !== undefined && x.file !== null && x.file !== '' && !/^\d+$/.test(trim(x.file))) {
                return { ok: false, options: [], error: 'option ' + (i + 1) + ': file must be a file ID' };
            }
            ids[trim(x.id)] = true;
            keys[trim(x.key)] = true;
            list.push({ id: trim(x.id), key: trim(x.key), label: trim(x.label), sub: typeof x.sub === 'string' ? trim(x.sub) : '',
                file: x.file === undefined || x.file === null ? '' : trim(x.file) });
        }
        return { ok: true, options: list, error: '' };
    }

    /**
     * Pure (1.2.0): literal options, `key=Label|key=Label` — an option without key= gets the key o<index> (0-based, as the
     * index posted before 1.2.0). Keys unique.
     * @returns {{labels: string[], keys: string[], error: string}}
     */
    function parseLiteralOptions(options) {
        var labels = [];
        var keys = [];
        var error = '';
        options.split('|').map(trim).filter(function (x) { return x !== ''; }).forEach(function (part, n) {
            var m = /^([a-z0-9_]+)\s*=\s*(.+)$/.exec(part);
            var key = m ? m[1] : 'o' + n;
            var label = m ? trim(m[2]) : part;
            if (contains(keys, key)) {
                error = error || 'option key "' + key + '" is repeated';
            }
            keys.push(key);
            labels.push(label);
        });
        return { labels: labels, keys: keys, error: error };
    }

    /** One row's checks, filling q as it goes; '' when the row is usable, else why not. */
    function rowProblem(q, field, options, required, allow, deny, seen, opts) {
        var id = /^[a-z0-9_]+$/;
        var parsed;
        var lit;
        var key;
        var setting;
        var m;
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
        if (q.type === 'element') {
            m = /^@element:([a-z]+)(?::(ext\d+))?$/.exec(field);
            if (!m || !contains(ELEMENTS, m[1])) {
                return 'an element question needs field @element:<walls|windows|roof|floor>[:extN]';
            }
            q.store = STORE.ELEMENT;
            q.element = m[1];
            q.ext = m[2] || '';
        } else if (q.type === 'epc') {
            if (field !== EPC_FIELD) {
                return 'an epc question needs field @epc';
            }
            q.store = STORE.EPC;
        } else if (field.indexOf('@') === 0) {
            return 'field "' + field + '" is for an ' + (field === EPC_FIELD ? 'epc' : 'element') + ' question only';
        } else if (field === '' || field.toLowerCase() === 'note') {
            q.store = STORE.NOTE;
        } else if (field.toLowerCase() === 'state') {
            if (q.type !== 'yesno' && q.type !== 'choice') {
                return 'field "state" is for yesno and choice questions only';
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
            } else if (options.indexOf(FROM_SETTING) === 0) {
                key = options.slice(FROM_SETTING.length);
                if (!(opts.settings || {}).hasOwnProperty(key)) {
                    return 'options "' + options + '": ' + key + ' is not an options setting the dashboard reads';
                }
                setting = parseOptionsSetting(opts.settings[key]);
                if (!setting.ok) {
                    return 'options "' + options + '": ' + setting.error;
                }
                q.optionsFromSetting = key;
                q.options = setting.options.map(function (x) { return x.label; });
                q.optionKeys = setting.options.map(function (x) { return x.key; });
                q.optionIds = setting.options.map(function (x) { return x.id; });
                q.optionSubs = setting.options.map(function (x) { return x.sub; });
                q.optionFiles = setting.options.map(function (x) { return x.file; });
                q.pictures = q.optionFiles.some(function (f) { return f !== ''; });
            } else {
                lit = parseLiteralOptions(options);
                if (!lit.labels.length) {
                    return 'a choice needs options: labels separated by |, @field or @setting:KEY';
                }
                if (lit.error) {
                    return lit.error;
                }
                q.options = lit.labels;
                q.optionKeys = lit.keys;
            }
        } else if (q.type === 'element') {
            if (options !== FROM_PRESET + q.element) {
                return 'an element question needs options ' + FROM_PRESET + q.element;
            }
            q.presetElement = q.element;
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

    // ---------------------------------------------------------------- 1.2.0: reveal

    /** Pure (1.2.0): the answer keys a question can have — yes/no, or a choice's option keys; null when it has none. */
    function answerKeys(q) {
        if (q.type === 'yesno') {
            return ['yes', 'no'];
        }
        if (q.type === 'choice' && q.optionKeys) {
            return q.optionKeys;
        }
        return null;
    }

    /**
     * Pure (1.2.0): the `reveal` column. Alternatives separated by |; each is clauses joined by ;; a clause is
     * qid=key1,key2. The question shows when ANY alternative has ALL its clauses true. Checked here: each qid is an
     * EARLIER question of the SAME section (earlier: qid -> question), with answer keys, and each key is one of them.
     * @returns {{ok: boolean, alternatives: Array<Array<{qid: string, keys: string[]}>>, error: string}}
     */
    function parseReveal(text, earlier) {
        var t = trim(text);
        var alternatives = [];
        var error = '';
        if (t === '') {
            return { ok: true, alternatives: [], error: '' };
        }
        t.split('|').forEach(function (alt) {
            var clauses = [];
            if (error) {
                return;
            }
            trim(alt).split(';').forEach(function (part) {
                var m = /^\s*([a-z0-9_]+)\s*=\s*([^=]+?)\s*$/.exec(part);
                var q;
                var keys;
                var allowed;
                if (error) {
                    return;
                }
                if (!m) {
                    error = 'reveal: "' + trim(part) + '" is not qid=key';
                    return;
                }
                q = (earlier || {})[m[1]];
                if (!q) {
                    error = 'reveal: "' + m[1] + '" is not an earlier question in this section';
                    return;
                }
                allowed = answerKeys(q);
                if (!allowed) {
                    error = 'reveal: "' + m[1] + '" is a ' + q.type + ' question (a reveal needs a yesno or a choice with keys)';
                    return;
                }
                keys = m[2].split(',').map(trim);
                keys.forEach(function (k) {
                    if (!error && !contains(allowed, k)) {
                        error = 'reveal: "' + k + '" is not a key of ' + m[1] + ' (' + allowed.join(', ') + ')';
                    }
                });
                clauses.push({ qid: m[1], keys: keys });
            });
            alternatives.push(clauses);
        });
        return error ? { ok: false, alternatives: [], error: error } : { ok: true, alternatives: alternatives, error: '' };
    }

    /**
     * Pure (1.2.0): a question's answer as its key — yesno: yes/no; a literal choice: the key of the label stored or
     * posted (a stored label may carry a " · …" suffix, as the insulation route's EPC note does); @setting: the key of the
     * id. '' when there is none or it is not an option.
     * @param {Object} q
     * @param {string} value - the stored label (literal), the id (@setting), yes/no
     */
    function keyOfValue(q, value) {
        var v = trim(value);
        var i;
        if (v === '') {
            return '';
        }
        if (q.type === 'yesno') {
            return v === 'yes' || v === 'no' ? v : '';
        }
        if (q.type !== 'choice' || !q.optionKeys) {
            return '';
        }
        if (q.optionsFromSetting) {
            i = (q.optionIds || []).indexOf(v);
            return i >= 0 ? q.optionKeys[i] : '';
        }
        for (i = 0; i < (q.options || []).length; i++) {
            if (v === q.options[i] || v.indexOf(q.options[i] + ' · ') === 0) {
                return q.optionKeys[i];
            }
        }
        return '';
    }

    /**
     * Pure (1.2.0): which of the shown questions are revealed. A question without a reveal is revealed. A clause on a
     * question ABSENT for this opportunity (not in `questions`: its `when` is false) is TRUE; on a question present but
     * itself hidden by its reveal, FALSE — so hiding cascades. Questions are evaluated in order (a reveal names earlier
     * questions only).
     * @param {Object[]} questions - the shown questions (visibleQuestions()), in registry order
     * @param {function(Object): string} keyOf - a question's current answer key ('' for none)
     * @returns {Object} qid -> boolean
     */
    function revealMap(questions, keyOf) {
        var present = {};
        var out = {};
        (questions || []).forEach(function (q) { present[q.qid] = q; });
        (questions || []).forEach(function (q) {
            var alts = q.reveal && q.reveal.alternatives && q.reveal.alternatives.length ? q.reveal.alternatives : null;
            if (!alts) {
                out[q.qid] = true;
                return;
            }
            out[q.qid] = alts.some(function (clauses) {
                return clauses.every(function (c) {
                    if (!present.hasOwnProperty(c.qid)) {
                        return true;
                    }
                    if (out[c.qid] === false) {
                        return false;
                    }
                    return contains(c.keys, keyOf(present[c.qid]));
                });
            });
        });
        return out;
    }

    /**
     * Pure (1.2.0): the "If you chose …" heading a reveal panel shows when script is off — worded from the option labels.
     * '' for no reveal.
     */
    function revealHeading(q, byQid) {
        var alts = q.reveal && q.reveal.alternatives ? q.reveal.alternatives : [];
        var parts = alts.map(function (clauses) {
            return clauses.map(function (c) {
                var src = (byQid || {})[c.qid];
                return c.keys.map(function (k) {
                    var i;
                    if (!src) {
                        return k;
                    }
                    if (src.type === 'yesno') {
                        return '“' + (k === 'yes' ? 'Yes' : 'No') + '”';
                    }
                    i = (src.optionKeys || []).indexOf(k);
                    return '“' + (i >= 0 ? src.options[i] : k) + '”';
                }).join(' or ') + (src ? ' to “' + src.label + '”' : '');
            }).join(' and ');
        });
        return parts.length ? 'If you chose ' + parts.join('; or if you chose ') : '';
    }

    /**
     * Pure: the registry's sections, in file order, each with its questions.
     * @param {Object[]} questions
     * @returns {Array<{id: string, title: string, short: string, intro: string, minutes: number, questions: Object[]}>} 1.1.0:
     *   intro and minutes are the section's step_intro and step_minutes; 1.2.0: short its short (else its title)
     */
    function sectionsOf(questions) {
        var list = [];
        var byId = {};
        (questions || []).forEach(function (q) {
            if (!byId[q.section]) {
                byId[q.section] = { id: q.section, title: q.sectionTitle, short: q.stepShort || q.sectionTitle,
                    intro: q.stepIntro || '', minutes: q.stepMinutes || 0, questions: [] };
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
     * Pure (1.2.0): DI_HEAT26_MAP {"<custbody_heat_source_type_26 list id>": "ashp|gshp_loop|gshp_bore|user_hp|boiler"}.
     * Bad entries are ignored and listed.
     */
    function parseHeat26Map(raw) {
        return parseValueMap(raw, HEAT26_VALUES);
    }

    /**
     * Pure (1.2.0): a multi-select's value as IDs — an array (record.getValue), or a string joined by commas or by
     * NetSuite's \u0005 (a search column, a posted multi-select). Blanks dropped.
     * @returns {string[]}
     */
    function idsOf(value) {
        var list = Array.isArray(value) ? value : String(value === null || value === undefined ? '' : value).split(/[,\u0005]/);
        return list.map(function (x) { return trim(x); }).filter(function (x) { return x !== ''; });
    }

    /**
     * Pure (brief §3.2; 1.2.0 §B2): the facts the registry's `when` reads.
     *
     * @param {Object} opp - plain values read from the record, IDs as strings: { valueProposition, fc, heatSource (the
     *   Sales MI), heatSource26 (custbody_heat_source_type_26: an array, or a comma string), market, subStatus,
     *   manifolds (custbody_manifold_locations_2026's current text, '' when none) }
     * @param {Object} cfg - FC_MAP, HEAT_MAP, VP_MAP, DI_HEAT26_MAP, NEWBUILD_MARKET_IDS, NEEDINFO_SUBSTATUS, DESIGN_SUBSTATUS
     * @returns {{service: string, fc: string[], heat: string[], hp: string[], heatFrom: string, unmapped26: string[],
     *            newbuild: boolean, manifoldsText: string, substatusMode: string, warnings: string[], mapProblems: string[]}}
     *   service ufh | ufh_plus | hp | unknown; fc tokens (['unknown'] when unmapped); 1.2.0: heat a SET — from
     *   custbody_heat_source_type_26 through DI_HEAT26_MAP (ashp, gshp_loop, gshp_bore, user_hp, boiler; any heat pump
     *   also adds nuheat_hp), else (heatFrom 'mi') the Sales MI's one value through HEAT_MAP (boiler | nuheat_hp | user_hp |
     *   other); hp the heat pump types in heat, or ['unknown'] for a Nu-Heat heat pump of no known type; substatusMode
     *   'edit' (NEEDINFO), 'view' (DESIGN) or ''.
     */
    function buildFacts(opp, cfg) {
        var o = opp || {};
        var c = cfg || {};
        var maps = parseMaps(c);
        var h26 = parseHeat26Map(c.DI_HEAT26_MAP);
        var vp = trim(o.valueProposition);
        var fcId = trim(o.fc);
        var heatId = trim(o.heatSource);
        var heat = [];
        var unmapped26 = [];
        var facts;
        idsOf(o.heatSource26).forEach(function (id) {
            if (h26.map.hasOwnProperty(id)) {
                if (!contains(heat, h26.map[id])) {
                    heat.push(h26.map[id]);
                }
            } else {
                unmapped26.push(id);
            }
        });
        if (heat.some(function (h) { return contains(HP_VALUES, h); })) {
            heat.push('nuheat_hp');
        }
        facts = {
            service: vp !== '' && maps.vp.hasOwnProperty(vp) ? maps.vp[vp] : 'unknown',
            fc: fcTokens(maps, fcId),
            heat: [],
            hp: [],
            heatFrom: heat.length ? '26' : 'mi',
            unmapped26: unmapped26,
            newbuild: trim(o.market) !== '' && contains(c.NEWBUILD_MARKET_IDS, trim(o.market)),
            manifoldsText: trim(o.manifolds),
            substatusMode: contains(c.NEEDINFO_SUBSTATUS, o.subStatus) ? 'edit' :
                contains(c.DESIGN_SUBSTATUS, o.subStatus) ? 'view' : '',
            warnings: [],
            mapProblems: maps.problems.concat(h26.status === 'invalid' ? ['DI_HEAT26_MAP ignored: ' + h26.detail] :
                h26.rejected.length ? ['DI_HEAT26_MAP entries ignored: ' + h26.rejected.join('; ')] : [])
        };
        // The Sales MI fallback: custbody_heat_source_type_26 empty, or nothing in it mapped.
        if (!heat.length) {
            heat = [heatId !== '' && maps.heat.hasOwnProperty(heatId) ? maps.heat[heatId] : 'other'];
        }
        facts.heat = HEAT_SET_VALUES.filter(function (h) { return contains(heat, h); });
        facts.hp = HP_VALUES.filter(function (h) { return contains(heat, h); });
        if (!facts.hp.length && contains(heat, 'nuheat_hp')) {
            facts.hp = ['unknown'];
        }
        if (facts.service === 'unknown') {
            facts.warnings.push('Design service unknown: value proposition ' + (vp || '(blank)') + ' is not in VP_MAP, ' +
                'so the customer was shown the UFH Design + questions.');
        }
        if (facts.fc.length === 1 && facts.fc[0] === 'unknown') {
            facts.warnings.push('Floor construction unknown: FC ' + (fcId || '(blank)') + ' is not in FC_MAP.');
        }
        if (facts.heatFrom === 'mi' && (heatId === '' || !maps.heat.hasOwnProperty(heatId))) {
            facts.warnings.push('Heat source ' + (heatId ? heatId + ' is not in HEAT_MAP' : 'not set') +
                ', so it was treated as "other".');
        }
        if (facts.service === 'hp' && !contains(facts.heat, 'nuheat_hp')) {
            facts.warnings.push('The design service is HP Design, but the heat source is not a Nu-Heat heat pump.');
        } else if (contains(facts.heat, 'nuheat_hp') && facts.service !== 'hp' && facts.service !== 'unknown') {
            facts.warnings.push('The heat source is a Nu-Heat heat pump, but the design service is not HP Design.');
        }
        if (facts.service === 'hp' && !facts.hp.length) {
            facts.warnings.push('HP Design but no heat pump in Heat Source Type.');
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

    /**
     * 1.2.0: the questions whose answer must be a number above 0 (decimals allowed). The registry has no column for it, so
     * the rule is here, by qid: the MCS distance to the neighbour's window.
     */
    var NUMBER_QIDS = ['distance'];

    /** Pure (1.2.0): is this the number question? */
    function isNumberQuestion(q) {
        return !!q && q.type === 'text' && contains(NUMBER_QIDS, q.qid);
    }

    /** 1.2.0: the steps every request asks about, never offered as tick boxes. */
    var ALWAYS_STEPS = ['project', 'other'];

    /**
     * Pure (1.2.0 §B3): THE list of steps — for the stepper and its step bar, Review, the request page's "will be asked
     * about", the request email's "What we'll ask" and the cards' progress. A step is a section with at least one question
     * whose `when` holds (reveal never removes a step), kept only when `requested` names it; project and other are always
     * kept; an empty or missing `requested` keeps every step (2.3 and 2.3b requests).
     * @param {Object[]} questions - the registry's
     * @param {Object} facts - buildFacts()
     * @param {string[]} [requested] - the state's rq
     * @returns {Array<{id: string, title: string, short: string, intro: string, minutes: number, questions: Object[]}>}
     */
    function stepsFor(questions, facts, requested) {
        var req = Array.isArray(requested) ? requested : [];
        return sectionsOf(visibleQuestions(questions, facts)).filter(function (sec) {
            return !req.length || contains(ALWAYS_STEPS, sec.id) || contains(req, sec.id);
        });
    }

    /** Pure (1.2.0): the questions of stepsFor(), flat, in registry order. */
    function stepQuestions(steps) {
        var out = [];
        (steps || []).forEach(function (st) { out = out.concat(st.questions); });
        return out;
    }

    /** Pure (1.2.0): the minutes of stepsFor()'s steps, summed (the card's "about N minutes"; 0: no time is shown). */
    function stepsMinutes(steps) {
        return (steps || []).reduce(function (n, st) { return n + (parseInt(st.minutes, 10) || 0); }, 0);
    }

    // ---------------------------------------------------------------- the state

    function emptyState() {
        return { v: STATE_VERSION, sections: {}, answers: {}, noted: {}, files: [], requested: '', sent: '', lastTaskAt: '',
            rq: [] };
    }

    /**
     * Pure (1.1.0): the qids a stored state holds answers or noted marks for that the registry no longer has (the v2
     * registry removed fc_unknown, the old mcs_* rows, ...). They are ignored, never deleted; the caller logs them once
     * (CDB DESIGNINFO_STATE_QID_UNKNOWN).
     * @returns {string[]}
     */
    function unknownStateQids(state, questions) {
        var known = {};
        var out = [];
        var k;
        (questions || []).forEach(function (q) { known[q.qid] = true; });
        for (k in ((state && state.answers) || {})) {
            if (state.answers.hasOwnProperty(k) && !known[k]) {
                out.push(k);
            }
        }
        for (k in ((state && state.noted) || {})) {
            if (state.noted.hasOwnProperty(k) && !known[k] && out.indexOf(k) < 0) {
                out.push(k);
            }
        }
        return out;
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
        // 1.2.0: the steps the last request asked about (optional; none: every step).
        s.rq = (Array.isArray(v.rq) ? v.rq : []).filter(function (x) { return typeof x === 'string' && /^[a-z0-9_]+$/.test(x); });
        return { state: s, status: 'ok', detail: '' };
    }

    function plainObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }

    /**
     * Pure (1.0.2): the state as stored — version 2, compact: s (sections: at, st), a (answers), n (qids answered in a
     * Note; left out when none), f (the newest STATE_FILES files, names clipped to STATE_FILE_NAME), req, sent, task;
     * 1.2.0: rq (the steps requested; left out when none — the size guard keeps it).
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
        if ((st.rq || []).length) {
            out.rq = st.rq.slice();
        }
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

    /** Pure: a section has been saved at least once. 1.2.0: only the steps listed, when `ids` is given (stepsFor()). */
    function anySectionSaved(state, ids) {
        var k;
        for (k in (state && state.sections) || {}) {
            if (state.sections.hasOwnProperty(k) && state.sections[k] && state.sections[k].saved &&
                    (!ids || contains(ids, k))) {
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
        // 1.2.0: a question hidden by its reveal (q.revealed false) does not count.
        var required = (questions || []).filter(function (q) { return q.required && !q.unavailable && q.revealed !== false; });
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
            // 1.2.0: never saved — 'todo' when a required question shows whatever the answers (no reveal).
            var status = saved && saved.status ? saved.status :
                sec.questions.some(function (q) { return q.required && !(q.reveal && q.reveal.alternatives &&
                    q.reveal.alternatives.length); }) ? 'todo' : 'optional';
            return { id: sec.id, title: sec.title, short: sec.short, minutes: sec.minutes, status: status,
                saved: !!(saved && saved.saved) };
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
        // 1.2.0: only a requested step's save counts (o.stepIds, from stepsFor(); none: any).
        return anySectionSaved(o.state, o.stepIds) ? CARD.INFO_PARTIAL : CARD.NEEDS_INFO;
    }

    // ---------------------------------------------------------------- 1.2.0: the element cards (brief §B8)

    /** Pure: a U-value as text ("0.55", "1.7"), '' when it is not a number in range. */
    function uText(u) {
        var n = typeof u === 'number' ? u : parseFloat(trim(u));
        if (isNaN(n) || !/^\s*\d*\.?\d+\s*$/.test(String(u)) && typeof u !== 'number') {
            return '';
        }
        return String(Math.round(n * 1000) / 1000);
    }

    /** Pure: is this an exact U-value the card takes (0.05–6.0 W/m²K)? */
    function uInRange(text) {
        var n = parseFloat(trim(text));
        return /^\d*\.?\d+$/.test(trim(text)) && n >= U_MIN && n <= U_MAX;
    }

    /** Pure: one of the content CSVs as objects keyed by its header; null header cells ignored. */
    function csvObjects(text) {
        var csv = parseCsv(text);
        var header;
        if (csv.error) {
            return { error: 'the CSV does not parse: ' + csv.error, header: [], rows: [] };
        }
        header = (csv.rows[0] || []).map(function (h) { return trim(h).toLowerCase(); });
        return { error: '', header: header, rows: csv.rows.slice(1).map(function (r, i) {
            var o = { line: i + 2 };
            header.forEach(function (h, n) { o[h] = trim(r[n]); });
            o.blank = r.every(function (c) { return trim(c) === ''; });
            return o;
        }).filter(function (o) { return !o.blank; }) };
    }

    function missingColumns(header, wanted) {
        return wanted.filter(function (c) { return !contains(header, c); });
    }

    /**
     * Pure: content/element-presets.csv — element,key,label,u. A bad row is rejected and listed; the rest are used, in
     * file order per element.
     * @returns {{status: string, byElement: Object, rejected: Array<{line, reason}>, detail: string}} byElement: element ->
     *   [{ key, label, u (text) }]
     */
    function parsePresets(text) {
        var out = { status: 'empty', byElement: {}, rejected: [], detail: '' };
        var c = csvObjects(text);
        var miss;
        ELEMENTS.forEach(function (e) { out.byElement[e] = []; });
        if (c.error || trim(text) === '') {
            out.status = c.error ? 'invalid' : 'empty';
            out.detail = c.error || 'the presets file is empty';
            return out;
        }
        miss = missingColumns(c.header, ['element', 'key', 'label', 'u']);
        if (miss.length) {
            out.status = 'invalid';
            out.detail = 'missing column(s): ' + miss.join(', ');
            return out;
        }
        c.rows.forEach(function (r) {
            var list = out.byElement[r.element];
            var reason = !list ? 'unknown element "' + r.element + '"' :
                !/^[a-z0-9_]+$/.test(r.key) ? 'key "' + r.key + '" must be lower-case letters, digits and _' :
                    contains(ELEMENT_SPECIALS.map(function (x) { return x.key; }), r.key) ? 'key "' + r.key + '" is a special' :
                        list.some(function (x) { return x.key === r.key; }) ? 'duplicate key "' + r.key + '"' :
                            r.label === '' ? 'no label' : !uInRange(r.u) ? 'u "' + r.u + '" is not a U-value (0.05–6.0)' : '';
            if (reason) {
                out.rejected.push({ line: r.line, reason: reason });
                return;
            }
            list.push({ key: r.key, label: r.label, u: uText(r.u) });
        });
        out.status = ELEMENTS.some(function (e) { return out.byElement[e].length; }) ? 'ok' : 'empty';
        return out;
    }

    /** Pure: a preset of an element by key, or null. */
    function presetOf(presets, element, key) {
        return ((presets && presets.byElement && presets.byElement[element]) || []).filter(function (p) {
            return p.key === key;
        })[0] || null;
    }

    /**
     * Pure: content/age-bands.csv — key,label,walls,windows,roof,floor. Each element value is a preset key of that
     * element or a U-value. The rows regs_new and regs_ext are the Building Regulations rows.
     * @returns {{status, bands: Object, rejected, detail}} bands: key -> { key, label, walls: { preset ('' for a number), u,
     *   label }, ... }
     */
    function parseAgeBands(text, presets) {
        var out = { status: 'empty', bands: {}, rejected: [], detail: '' };
        var c = csvObjects(text);
        var miss;
        if (c.error || trim(text) === '') {
            out.status = c.error ? 'invalid' : 'empty';
            out.detail = c.error || 'the age bands file is empty';
            return out;
        }
        miss = missingColumns(c.header, ['key', 'label'].concat(ELEMENTS));
        if (miss.length) {
            out.status = 'invalid';
            out.detail = 'missing column(s): ' + miss.join(', ');
            return out;
        }
        c.rows.forEach(function (r) {
            var band = { key: r.key, label: r.label };
            var reason = !/^[a-z0-9_]+$/.test(r.key) ? 'key "' + r.key + '" must be lower-case letters, digits and _' :
                out.bands.hasOwnProperty(r.key) ? 'duplicate key "' + r.key + '"' : r.label === '' ? 'no label' : '';
            ELEMENTS.forEach(function (e) {
                var p;
                if (reason) {
                    return;
                }
                if (uInRange(r[e])) {
                    band[e] = { preset: '', u: uText(r[e]), label: '' };
                    return;
                }
                p = presetOf(presets, e, r[e]);
                if (!p) {
                    reason = e + ' "' + r[e] + '" is neither a ' + e + ' preset nor a U-value';
                    return;
                }
                band[e] = { preset: p.key, u: p.u, label: p.label };
            });
            if (reason) {
                out.rejected.push({ line: r.line, reason: reason });
                return;
            }
            out.bands[r.key] = band;
        });
        out.status = Object.keys(out.bands).length ? 'ok' : 'empty';
        return out;
    }

    /**
     * Pure: content/epc-element-map.csv — element,pattern,preset,priority. Patterns are case-insensitive substrings; the
     * lowest priority wins. A preset that is not one of the element's is rejected.
     * @returns {{status, rows: Array<{element, pattern, preset, priority}>, rejected, detail}}
     */
    function parseEpcMap(text, presets) {
        var out = { status: 'empty', rows: [], rejected: [], detail: '' };
        var c = csvObjects(text);
        var miss;
        if (c.error || trim(text) === '') {
            out.status = c.error ? 'invalid' : 'empty';
            out.detail = c.error || 'the EPC map is empty';
            return out;
        }
        miss = missingColumns(c.header, ['element', 'pattern', 'preset', 'priority']);
        if (miss.length) {
            out.status = 'invalid';
            out.detail = 'missing column(s): ' + miss.join(', ');
            return out;
        }
        c.rows.forEach(function (r) {
            var reason = !contains(ELEMENTS, r.element) ? 'unknown element "' + r.element + '"' :
                r.pattern === '' ? 'no pattern' : !/^\d+$/.test(r.priority) ? 'priority must be a whole number' :
                    !presetOf(presets, r.element, r.preset) ? 'preset "' + r.preset + '" is not a ' + r.element + ' preset' : '';
            if (reason) {
                out.rejected.push({ line: r.line, reason: reason });
                return;
            }
            out.rows.push({ element: r.element, pattern: r.pattern.toLowerCase(), preset: r.preset,
                priority: parseInt(r.priority, 10) });
        });
        out.status = out.rows.length ? 'ok' : 'empty';
        return out;
    }

    /** Pure: "average thermal transmittance 0.28 W/m²K" -> '0.28'; '' when the text has none in range. */
    function uFromEpcText(text) {
        var m = /average thermal transmittance\s*(?:=\s*)?(\d*\.?\d+)/i.exec(String(text || ''));
        return m && uInRange(m[1]) ? uText(m[1]) : '';
    }

    /**
     * Pure (brief §B9): one element's EPC description ("; "-joined entries, as epc_lib gives them) -> a card. Each entry is
     * mapped on its own (the lowest-priority pattern it contains); all mapped to one preset -> that preset; any
     * disagreement or an entry that maps to nothing -> unsure, with the certificate's text to show. An entry stating an
     * average thermal transmittance gives the U-value (source EPC).
     * @returns {{key: string, u: string, text: string, missing: boolean, mixed: boolean}} missing: no description at all
     */
    function epcElement(description, map, element) {
        var text = trim(description);
        var entries = text === '' ? [] : text.split(/;\s*/).map(trim).filter(function (x) { return x !== ''; });
        var keys = [];
        var u = '';
        var unmatched = false;
        if (!entries.length) {
            return { key: 'unsure', u: '', text: '', missing: true, mixed: false };
        }
        entries.forEach(function (entry) {
            var low = entry.toLowerCase();
            var best = null;
            var eu = uFromEpcText(entry);
            if (eu) {
                u = u || eu;
                return;
            }
            ((map && map.rows) || []).forEach(function (r) {
                if (r.element === element && low.indexOf(r.pattern) >= 0 && (!best || r.priority < best.priority)) {
                    best = r;
                }
            });
            if (best) {
                if (!contains(keys, best.preset)) {
                    keys.push(best.preset);
                }
            } else {
                unmatched = true;
            }
        });
        if (keys.length === 1 && !unmatched) {
            return { key: keys[0], u: u, text: text, missing: false, mixed: false };
        }
        return { key: 'unsure', u: u, text: text, missing: false, mixed: keys.length > 1 || unmatched };
    }

    /** The age question's bands by their first year. */
    var AGE_BAND_STARTS = [['pre1920', -Infinity], ['1920', 1920], ['1950', 1950], ['1976', 1976], ['1991', 1991],
        ['2003', 2003], ['2012', 2012]];

    /**
     * Pure (brief §B9): an EPC construction age band -> the age question's key, from the START year ("England and Wales:
     * 1950-1966" -> 1950; "before 1900" -> 1899; "2012 onwards" -> 2012). No year -> 'unsure'.
     */
    function ageBandKey(constructionAgeBand) {
        var t = String(constructionAgeBand || '');
        var m = /(\d{4})/.exec(t);
        var year;
        var key = 'unsure';
        if (!m) {
            return key;
        }
        year = parseInt(m[1], 10) - (/before\s+\d{4}/i.test(t) ? 1 : 0);
        AGE_BAND_STARTS.forEach(function (b) {
            if (year >= b[1]) {
                key = b[0];
            }
        });
        return key;
    }

    /**
     * Pure (brief §B8): an element's line, as the field holds it — 'Cavity, filled · U 0.55 (typical) · notes: …'. uSource
     * is 'customer' when an exact U was typed, else 'EPC' | 'typical' | 'regs' | 'preset'. '' when all are empty.
     */
    function elementLine(o) {
        var x = o || {};
        var parts = [];
        var label = trim(x.label).replace(/\s*·\s*/g, ', ');
        var u = uText(x.u);
        var notes = trim(String(x.notes || '').replace(/[\r\n]+/g, ' '));
        if (label) {
            parts.push(label);
        }
        if (u) {
            parts.push('U ' + u + ' (' + (contains(U_SOURCES, x.uSource) ? x.uSource : 'preset') + ')');
        }
        if (notes) {
            parts.push('notes: ' + notes);
        }
        return parts.join(' · ');
    }

    /**
     * Pure: an element line back as its parts, or null when it is not one of ours (staff prose). A line counts as ours
     * when it has the U part or the notes part, or its label is one of `labels` (the presets', the specials', "Typical
     * for …"). An "Extension N: " prefix is not part of the line (splitExtensionLines()).
     * @returns {{label: string, u: string, uSource: string, notes: string}|null}
     */
    function parseElementLine(text, labels) {
        var t = trim(text);
        var m = /^(.*?)(?:(?:^| · )U (\d*\.?\d+) \((customer|EPC|typical|regs|preset)\))?(?:(?:^| · )notes: (.*))?$/.exec(t);
        var label;
        if (t === '' || /\n/.test(t) || !m) {
            return null;
        }
        label = trim(m[1]);
        if (!m[2] && m[4] === undefined && !contains(labels || [], label) && !/^Typical for /.test(label)) {
            return null;
        }
        if (label.indexOf(' · ') >= 0) {
            return null;
        }
        return { label: label, u: m[2] ? uText(m[2]) : '', uSource: m[3] || '', notes: m[4] === undefined ? '' : trim(m[4]) };
    }

    /** Pure: two element lines are the same when (label, u, notes) are — a change of source alone is not a change. */
    function sameElement(a, b, labels) {
        var pa = parseElementLine(a, labels);
        var pb = parseElementLine(b, labels);
        if (!pa || !pb) {
            return sameText(a, b);
        }
        return pa.label === pb.label && pa.u === pb.u && pa.notes === pb.notes;
    }

    /** Pure: a New field's text as { main: the lines without a prefix, ext1: ..., ext2: ... } ("Extension N: …"). */
    function splitExtensionLines(text) {
        var out = { main: '' };
        String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
            var m = /^Extension (\d+): (.*)$/.exec(trim(line));
            if (m) {
                out['ext' + m[1]] = trim(m[2]);
            } else if (trim(line) !== '') {
                out.main = out.main ? out.main + '\n' + trim(line) : trim(line);
            }
        });
        return out;
    }

    /** Pure: the field an element answer goes to — market 'new': New; 'reno': Existing for the house, New for extensions. */
    function elementField(market, element, ext) {
        if (ext) {
            return ELEMENT_FIELDS.new[element];
        }
        if (market === 'new') {
            return ELEMENT_FIELDS.new[element];
        }
        return market === 'reno' ? ELEMENT_FIELDS.existing[element] : '';
    }

    /**
     * Pure (brief §B8): where the element answers go. A new build: the New fields. A renovation: the house to the Existing
     * fields; each extension's "Different" element to the matching New field, prefixed "Extension N: ", two joined by a
     * newline. An extension "Same as the main house" has no answer here and writes nothing. Empty lines write nothing.
     * @param {Object} facts - { market: 'new' | 'reno' } (the customer's answer to the market question)
     * @param {Object} answers - qid -> { element, ext ('' for the house, 'ext1', 'ext2'), line }
     * @returns {Object} fieldId -> the text
     */
    function elementTargets(facts, answers) {
        var market = (facts || {}).market;
        var byField = {};
        var order = [];
        var out = {};
        var qid;
        var a;
        var f;
        for (qid in (answers || {})) {
            if (!answers.hasOwnProperty(qid)) {
                continue;
            }
            a = answers[qid];
            f = elementField(market, a.element, a.ext);
            if (!f || trim(a.line) === '' || (a.ext && market !== 'reno')) {
                continue;
            }
            if (!byField[f]) {
                byField[f] = [];
                order.push(f);
            }
            byField[f].push({ ext: a.ext, line: trim(a.line) });
        }
        order.forEach(function (fid) {
            out[fid] = byField[fid].sort(function (x, y) {
                return x.ext === y.ext ? 0 : x.ext < y.ext ? -1 : 1;
            }).map(function (x) {
                return x.ext ? 'Extension ' + x.ext.replace(/^ext/, '') + ': ' + x.line : x.line;
            }).join('\n');
        });
        return out;
    }

    /** Pure: an age band's label inside a sentence ("Before 1920" -> "before 1920"). */
    function bandText(band) {
        var l = String((band && band.label) || '');
        return /^[A-Z][a-z]/.test(l) ? l.charAt(0).toLowerCase() + l.slice(1) : l;
    }

    /** Pure: the special of a key, or null. */
    function specialOf(key) {
        return ELEMENT_SPECIALS.filter(function (x) { return x.key === key; })[0] || null;
    }

    /**
     * Pure: the hidden q_<qid>_src — "kind" or "kind:key:u", the source of the values the card was given and those values
     * (the pre-fill's fingerprint). Anything else reads as 'you'.
     */
    function parseSrc(raw) {
        var parts = String(raw || '').split(':');
        var kind = contains(ELEMENT_SRC, parts[0]) ? parts[0] : 'you';
        return { kind: kind, key: /^[a-z0-9_]*$/.test(parts[1] || '') ? (parts[1] || '') : '', u: uText(parts[2] || '') };
    }

    /** Pure: the source still holds when the card is as it was given (same key, same U); else the customer changed it. */
    function cardSource(card) {
        var fp = parseSrc(card.src);
        if (fp.kind === 'you' || String(card.src || '').indexOf(':') < 0) {
            return fp.kind;
        }
        return fp.key === (card.key || '') && fp.u === uText(card.u || '') ? fp.kind : 'you';
    }

    /**
     * Pure (brief §B8): a card -> elementLine()'s parts. card { key, u (the exact U box), notes, src }; ctx { presets, element,
     * band (the age band: for typical), regs (the regs row) }.
     */
    function composeElement(card, ctx) {
        var c = card || {};
        var x = ctx || {};
        var src = cardSource(c);
        var typed = uText(c.u);
        var srcU = { epc: 'EPC', age: 'typical', regs: 'regs' }[src] || '';
        var p = presetOf(x.presets, x.element, c.key);
        var label = '';
        var u = '';
        var uSource = '';
        var b;
        if (p) {
            label = p.label;
            u = p.u;
            uSource = srcU || 'preset';
        } else if (c.key === 'typical') {
            b = x.band && x.band[x.element];
            label = x.band ? 'Typical for ' + bandText(x.band) : specialOf('typical').label;
            u = b ? b.u : '';
            uSource = 'typical';
        } else if (c.key === 'regs') {
            b = x.regs && x.regs[x.element];
            label = specialOf('regs').label;
            u = b ? b.u : '';
            uSource = 'regs';
        } else if (specialOf(c.key)) {
            label = specialOf(c.key).label;
        }
        if (typed) {
            u = typed;
            uSource = src !== 'you' && srcU ? srcU : 'customer';
        }
        return { label: label, u: u, uSource: u ? uSource : '', notes: trim(c.notes) };
    }

    /**
     * Pure: a stored line -> the card it came from (for the page): the preset or special by its label, the exact U when the
     * customer typed one (or a U that is not the preset's), the source. null when the line is staff prose.
     */
    function cardOfLine(line, ctx) {
        var x = ctx || {};
        var labels = elementLabels(x.presets, x.element);
        var parsed = parseElementLine(line, labels);
        var list = ((x.presets && x.presets.byElement && x.presets.byElement[x.element]) || []);
        var p;
        var key = '';
        var src;
        var u;
        if (!parsed) {
            return null;
        }
        p = list.filter(function (y) { return y.label === parsed.label; })[0];
        if (p) {
            key = p.key;
        } else if (/^Typical for /.test(parsed.label)) {
            key = 'typical';
        } else {
            ELEMENT_SPECIALS.forEach(function (sp) {
                if (sp.label === parsed.label) {
                    key = sp.key;
                }
            });
        }
        src = { EPC: 'epc', typical: 'age', regs: 'regs' }[parsed.uSource] || 'you';
        // The U box holds a U the customer typed, or one that is not the preset's own (an EPC's average U).
        u = parsed.uSource === 'customer' || (parsed.u && !(p && p.u === parsed.u) && key !== 'typical' && key !== 'regs') ?
            parsed.u : '';
        return { key: key, u: u, notes: parsed.notes, src: srcString(src, key, u) };
    }

    /** Pure: the hidden src value for a card: "kind:key:u" (a fingerprint), or "you". */
    function srcString(kind, key, u) {
        return kind === 'you' ? 'you' : kind + ':' + (key || '') + ':' + (uText(u) || '');
    }

    /** Pure: the labels an element's lines may carry (its presets', the specials'). */
    function elementLabels(presets, element) {
        return ((presets && presets.byElement && presets.byElement[element]) || []).map(function (p) { return p.label; })
            .concat(ELEMENT_SPECIALS.map(function (x) { return x.label; }));
    }

    /**
     * Pure (brief §B8): pre-fill a card — only when it is empty or its values still came from an earlier pre-fill; never over
     * the customer's own choice. Notes are never touched. Returns the card to show (a copy).
     * @param {Object} card - { key, u, notes, src }
     * @param {Object} fill - { kind: 'epc'|'age'|'regs', key, u }
     */
    function fillPrefill(card, fill) {
        var c = card || {};
        var out = { key: c.key || '', u: c.u || '', notes: c.notes || '', src: c.src || '' };
        var empty = out.key === '' && uText(out.u) === '';
        if (!fill || (!empty && cardSource(out) === 'you')) {
            return out;
        }
        out.key = fill.key || '';
        out.u = fill.u || '';
        out.src = srcString(fill.kind, out.key, out.u);
        return out;
    }

    /**
     * Pure: what a route pre-fills on a card. 'age' (the typical route): the band's value — its preset, or the U on the
     * typical special; 'regs': the regs row's value on the regs special (a preset value as that preset).
     * @returns {{kind, key, u}|null}
     */
    function bandFill(kind, row, element) {
        var v = row && row[element];
        if (!v) {
            return null;
        }
        if (v.preset) {
            return { kind: kind, key: v.preset, u: '' };
        }
        return { kind: kind, key: kind === 'age' ? 'typical' : 'regs', u: '' };
    }

    /** Pure: the card's source tag. */
    function sourceTag(card, band) {
        var k = cardSource(card || {});
        if (!(card && (card.key || uText(card.u)))) {
            return '';
        }
        return k === 'epc' ? 'From your EPC' : k === 'age' ? 'Typical for ' + (band ? bandText(band) : 'the age of your property') :
            k === 'regs' ? 'Building Regulations' : 'You chose this';
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
        COLUMNS_V2: COLUMNS_V2,
        unknownStateQids: unknownStateQids,
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
        sameText: sameText,
        // 1.2.0
        COLUMNS_V3: COLUMNS_V3,
        ELEMENTS: ELEMENTS,
        ELEMENT_SPECIALS: ELEMENT_SPECIALS,
        ELEMENT_FIELDS: ELEMENT_FIELDS,
        ELEMENT_NAMES: ELEMENT_NAMES,
        ELEMENT_NOTES_MAX: ELEMENT_NOTES_MAX,
        U_MIN: U_MIN,
        U_MAX: U_MAX,
        HEAT26_VALUES: HEAT26_VALUES,
        HP_VALUES: HP_VALUES,
        ALWAYS_STEPS: ALWAYS_STEPS,
        NUMBER_QIDS: NUMBER_QIDS,
        isNumberQuestion: isNumberQuestion,
        FROM_SETTING: FROM_SETTING,
        asList: asList,
        idsOf: idsOf,
        parseHeat26Map: parseHeat26Map,
        parseOptionsSetting: parseOptionsSetting,
        parseLiteralOptions: parseLiteralOptions,
        answerKeys: answerKeys,
        parseReveal: parseReveal,
        keyOfValue: keyOfValue,
        revealMap: revealMap,
        revealHeading: revealHeading,
        stepsFor: stepsFor,
        stepQuestions: stepQuestions,
        stepsMinutes: stepsMinutes,
        uText: uText,
        uInRange: uInRange,
        parsePresets: parsePresets,
        presetOf: presetOf,
        parseAgeBands: parseAgeBands,
        parseEpcMap: parseEpcMap,
        uFromEpcText: uFromEpcText,
        epcElement: epcElement,
        ageBandKey: ageBandKey,
        elementLine: elementLine,
        parseElementLine: parseElementLine,
        sameElement: sameElement,
        splitExtensionLines: splitExtensionLines,
        elementField: elementField,
        elementTargets: elementTargets,
        parseSrc: parseSrc,
        cardSource: cardSource,
        composeElement: composeElement,
        cardOfLine: cardOfLine,
        srcString: srcString,
        elementLabels: elementLabels,
        fillPrefill: fillPrefill,
        bandFill: bandFill,
        sourceTag: sourceTag,
        bandText: bandText
    };
});
