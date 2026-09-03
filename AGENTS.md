# Novel Studio Agent Instructions

- Treat `NOVEL_STUDIO_MASTER_PLAN.md` as the single source of truth.
- Read the master plan before changing implementation or architecture.
- Keep every DeepSeek Harness import and integration call inside `packages/bundle/src/dsh-adapter/`.
- Do not fork or patch DeepSeek Harness, its installation directory, official `node_modules`, or built web assets.
- Do not use DOM selectors or DOM injection to alter official Harness surfaces. Use declared Client slots and Host services only.
- Implement only the active phase. Phase 0 must pass before any Phase 1 database work begins.
- After each milestone, run its focused verification and update the master plan implementation status and decision log.
- Preserve user data and unrelated workspace changes.
