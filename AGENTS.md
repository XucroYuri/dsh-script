# Script Studio Agent Instructions

## Required Reading

Before changing product behavior, architecture, schema, API, workflow, Prompt, or Client code, read:

1. `docs/spec/README.md`;
2. `docs/spec/product-spec.md`;
3. `docs/spec/domain-model.md`;
4. `docs/spec/architecture.md`;
5. `docs/spec/migration-plan.md`;
6. `docs/spec/host-plugin-contract.md`;
7. `docs/spec/cloud-collaboration.md`;
8. `docs/spec/quality-gates.md`;
9. the relevant implementation history and ADRs in `NOVEL_STUDIO_MASTER_PLAN.md`.

The SPEC set is normative for the Script Studio direction. `NOVEL_STUDIO_MASTER_PLAN.md` remains the compatibility history, implementation ledger, and ADR archive. README files describe current user-facing reality and must not override a SPEC.

## Product Truth

- The target hierarchy is `Team / IP / Project / Season / Episode`; `Sequence / Scene / Beat` live inside Episode.
- `Project` represents one episodic series or one feature film. Novel content is migration/source material, never a runtime medium.
- A feature-film Project has exactly one system Season and one primary Episode. Sequences are not Episodes.
- Approved Episode versions update Project Canon. Promotion into IP Bible/Canon is separate and always explicit.
- Sibling Projects do not automatically share manuscript or Project Canon. Cross-IP access is default-deny and requires an auditable Selection Snapshot grant.
- Team is the cloud tenant, membership, permission, and asset boundary. Collaboration claims require server-side authorization, audit, realtime, and recovery to work end to end.
- Keep current and target capabilities visibly separate in docs, UI, release notes, and health output.

## Architecture Boundaries

- Keep Codex plugin APIs inside `plugins/codex-script-studio/` and DeepSeek Harness APIs inside `plugins/dsh-script-studio/`.
- Domain code must not depend on Harness, SQLite, React, HTTP, or the filesystem.
- Client code uses declared Client slots and stable Host APIs only. Never use DOM selectors or DOM injection to alter official Harness surfaces.
- Do not fork or patch DeepSeek Harness, its installation directory, official `node_modules`, or built web assets.
- PostgreSQL is the cloud transactional authority; object storage is the immutable content authority; SQLite is only local development/offline cache.
- Codex and DSH adapters call the same Script Studio API and application contracts. Plugins never connect directly to cloud databases or object-store master credentials.
- Target runtime must not retain `novel-studio` package/API/data-path compatibility. Old data is read only by the standalone importer.

## Change Gate

Before the first implementation edit:

1. identify the active stage in `docs/spec/migration-plan.md`;
2. name the affected product goal and domain invariants;
3. define one falsifiable local hypothesis and a focused check;
4. update the relevant SPEC first when behavior or architecture changes;
5. confirm data backup, rollback, and compatibility requirements for schema work.

Do not implement a later stage while an earlier exit gate is incomplete. Do not add Team/IP/cloud/Codex conditionals to the current monolithic Bundle; extract the host-neutral core first.

## Data Safety

- Preserve user data and unrelated workspace changes.
- Cloud and local schema migrations are monotonic, transactional, idempotent, and forward-only.
- Migration failure must stop writes, roll back completely, and retain the previous schema data.
- The standalone novel importer never modifies the source database. The target runtime contains no legacy tables or dual-write path.
- Do not let models or Client code execute SQL.
- Do not use names as entity identity; use stable IDs and explicit ownership.
- Archive is a reversible write barrier, not deletion.

## Verification

After each milestone:

1. run the narrow test that can falsify the change;
2. run `pnpm check`, `pnpm test`, `pnpm build`, `pnpm pack:audit`, and `git diff --check` when applicable;
3. run Codex marketplace/plugin/MCP composition for Codex integration changes;
4. run DSH composition for Harness integration changes;
5. run exact-package installation tests for packaging or release changes;
6. update `docs/spec/migration-plan.md`, the master-plan implementation status, and the ADR ledger;
7. report tests that could not run and do not mark the milestone complete.
