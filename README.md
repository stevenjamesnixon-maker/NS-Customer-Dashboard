# NS Customer Dashboard

SuiteScript 2.1 for Nu-Heat's customer dashboard: a no-login page, reached by a signed link, where a
customer sees their projects by stage and arranges delivery for a sales order that is ready to
ship. A Map/Reduce emails each customer a digest of the same information every 14 days.

## Canonical reference

**[`docs/context.md`](docs/context.md) is the single source of truth for this project.** Read it
before changing anything. It records the design, the parameters and what an empty one means, the
NetSuite objects the scripts assume, the security rules, the audit log key and the deployment
sequence.

If this README and `docs/context.md` disagree, the context document wins. If either disagrees with
the code, the code wins — and the document gets fixed in the same PR.

## Layout

```
src/FileCabinet/SuiteScripts/NuHeat/Customer Dashboard/
    cdb_sl_dashboard.js        Suitelet, Available Without Login
    cdb_mr_digest.js           Map/Reduce: the digest email
    lib/                       shared modules — uploaded, no script record needed
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
node --test test/
```

Node 18 or later. The tests cover the pure parts only — dates, the token payload, the stage
grouping. Everything that touches NetSuite is tested in Sandbox, per `docs/context.md` §9.

## Three rules for contributors

1. **Never commit internal IDs.** List values, statuses, employees and quote types come from
   script parameters. Script IDs (`custbody_*`, `customscript_*` and the rest) are fine.
2. **The dashboard never writes the confirmed delivery date or the Record Status.**
   `custbody_del_date` and `custbody_finance_status` belong to people and workflows.
3. **Never merge or deploy without Steve's explicit instruction.** Work goes on a branch with a
   PR and waits.
