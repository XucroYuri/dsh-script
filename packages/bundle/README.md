# Historical Bundle Implementation

This package contains the pre-refactor Novel Studio implementation. It is retained temporarily as a source of tested workflow, approval, generation, recovery, and author-control behavior while Script Studio is decomposed into host-neutral core packages and separate Codex/DeepSeek Harness plugins.

It is **not** a Script Studio release and must not receive new Team, IP, cloud collaboration, Codex, screenplay-domain, or compatibility-projection features.

The target architecture is defined by:

- `docs/spec/product-spec.md`
- `docs/spec/domain-model.md`
- `docs/spec/architecture.md`
- `docs/spec/host-plugin-contract.md`
- `docs/spec/cloud-collaboration.md`
- `docs/spec/migration-plan.md`

Migration rules:

- extract reusable domain/application behavior behind new contracts;
- rewrite all target entities and language around episodic and feature-film screenwriting;
- keep Codex and DeepSeek Harness APIs in separate thin adapters;
- move cloud authority to PostgreSQL and object storage;
- do not carry Book/Volume/Chapter, `novel` medium, old API routes, old package identity, or legacy projection tables into the target runtime;
- import old user data only through the standalone read-only importer.

Existing tests may be reused as behavioral evidence, but passing this package's historical composition does not mean the new Script Studio architecture is complete.
