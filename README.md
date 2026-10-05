# NS Customer Dashboard

SuiteScript 2.1 for Nu-Heat's customer dashboard: a no-login page, reached by a signed link, where a
customer sees their projects by stage and arranges delivery for a sales order that is ready to
ship. A Map/Reduce emails each customer a digest of the same information every 14 days.

## Canonical reference

**[`docs/context.md`](docs/context.md) is the single source of truth for this project.** Read it
before changing anything. It records the design, the settings (one record, 3.0) and what an empty one means, the
NetSuite objects the scripts assume, the security rules, the audit log key and the deployment
sequence.

If this README and `docs/context.md` disagree, the context document wins. If either disagrees with
the code, the code wins — and the document gets fixed in the same PR.

## Layout

```
src/FileCabinet/SuiteScripts/NuHeat/Customer Dashboard/
    cdb_sl_dashboard.js        Suitelet, Available Without Login
    cdb_mr_digest.js           Map/Reduce: the digest email
    cdb_ue_salesorder.js       User Event (2.0): the sales order's "Send delivery link" button
    cdb_sl_send_link.js        Suitelet (2.0), login required: emails a direct delivery link
    cdb_ue_opportunity.js      User Event (2.3): the opportunity's "Request design information" button
    cdb_sl_send_designinfo.js  Suitelet (2.3), login required: emails the "Tell us about your property" link
    lib/                       shared modules — uploaded, no script record needed
content/design-info-registry.csv  the design information questions (2.3), uploaded to the File Cabinet
test/                          node tests for the pure parts
docs/context.md                canonical project context
```

The `src/FileCabinet/...` path mirrors the NetSuite File Cabinet exactly. There is no SDF project;
the path exists so a reader can tell where each file belongs, and because the relative imports
between scripts only resolve if the tree is preserved.

## Conventions

- SuiteScript 2.1 in ES5 style: `var`, function declarations, `'use strict'`. No arrow functions,
  `let`/`const`, template literals or `Array.prototype.includes`. No `log.warn` (it does not exist).
- Every file carries a `VERSION` constant and a matching JSDoc `@version` header. Semver.
- Every log title begins `CDB ` — one string to grep the execution log for.
- Script records `customscript_cdb_<type>_<purpose>`, deployments `customdeploy_cdb_<type>_<purpose>`.

## Tests

```
npm test            # or: node --test test/*.test.js
```

Node 18 or later, no dependencies. The tests cover the pure parts — dates, the token payload,
the stage grouping, validation, configuration — plus the Suitelet and the digest run against an
in-memory NetSuite stub (`test/helpers/netsuite.js`). The stub catches wiring mistakes, not API
behaviour: everything that touches NetSuite is still tested in Sandbox, per `docs/context.md` §9.

## Three rules for contributors

1. **Never commit internal IDs.** List values, statuses, employees and quote types come from
   settings — the `customrecord_cdb_setting` record (3.0), or until a row is set the script
   parameters. Script IDs (`custbody_*`, `customscript_*` and the rest) are fine.
2. **The dashboard never writes the confirmed delivery date or the Record Status.**
   `custbody_del_date` and `custbody_finance_status` belong to people and workflows.
3. **Never merge or deploy without Steve's explicit instruction.** Work goes on a branch with a
   PR and waits.
