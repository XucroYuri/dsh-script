# Script Studio Bundle

Local-first professional script and long-form fiction workspace for DeepSeek Harness.

Script Studio evolves the installable Novel Studio authoring plugin toward Team / IP / Project / Season / Episode production. The current compatibility release still organizes long-form works into projects, volumes, and chapters; preserves approved manuscript versions; and carries confirmed Canon, character facts, timelines, foreshadowing, and governed long-term memory into later writing. Creators remain in control of editing and approval while the plugin handles context assembly, persistence, batch queues, and restart recovery.

The five-level script domain and professional screenplay formatting are migration targets, not features of the current compatibility release.

The package contains the authoring interface and runtime only. It ships no sample novel, character storyline, game material, user manuscript, or model credential.

- Novel Studio: `0.8.0-author-control.6`
- DeepSeek Harness: `0.1.0-rc.7`
- Node.js: 24
- pnpm: `11.22.0` available on `PATH`
- Web profile: `web`
- SQLite: schema 1–20 upgrades to schema 20

The Bundle uses declared Harness Bundle, Client-slot, Host-service, LLM, filesystem, settings, credentials, and tool interfaces. It does not patch Harness, edit official `node_modules`, inject DOM selectors, or require an external database.

## Install

Install the required package manager and Harness first. Harness invokes pnpm while installing a local Bundle:

```bash
npm install --global pnpm@11.22.0
npm install --global @deepseek-ai/dsh@0.1.0-rc.7
pnpm --version
dsh --version
```

Download these assets from the matching [GitHub Release](https://github.com/XucroYuri/dsh-script/releases):

- `novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz`
- `SHA256SUMS`
- `release-manifest.json`

Verify the tarball against `SHA256SUMS`. The release manifest must identify the same version/tag and report `workingTreeDirty: false`. Do not install GitHub's generated source archive.

Stop Harness, then install the downloaded tarball into the Web profile and restart:

```bash
dsh plugin --profile web add ./novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz
dsh --profile web
```

Open the local URL printed by Harness and choose **小说工作室**.

## Configure the model

Novel Studio uses the provider and model selected by Harness. Open **Settings → Models**, enter the DeepSeek API key in the DeepSeek card, save it, and select an available model. Harness stores the write-only credential under `$DSH_HOME/.credentials.yaml`; the plugin package and Novel Studio database do not contain it.

For a health check, ask the normal Harness conversation to run `novel_doctor`. A healthy installation reports this Bundle version, Harness `0.1.0-rc.7`, SQLite schema 20, and ready database/model/long-memory status. Optional Harness conversation compaction may be unavailable without disabling Novel Studio's own long-form memory.

## First chapter

1. Create a project in **小说工作室**.
2. Optionally generate and approve the outline, character system, and story timeline under **创作准备**. Missing stages are advice, not a writing gate.
3. Create a chapter and choose **生成本章**.
4. Edit the live-saved result or select a fragment for scoped rewriting.
5. Approve the chapter so Canon and long-term memory can be refreshed.
6. Inspect **记忆**, **实体关系**, and **创作统计** before continuing.

Use **批量生成** for selected or consecutive chapters. AUTO waits for chapter approval; bounded YOLO skips human approval but is not a quality guarantee. Queue order, pause/resume, retry, skip, cancellation, and restart recovery are persisted.

## What is included

- Project / Book / Volume / Chapter organization and immutable manuscript versions.
- Autosave, browser recovery copy, revision conflict protection, approval, and restart recovery.
- Versioned outline, character, and story-timeline foundations.
- Single-chapter generation, selection-scoped rewrite, recoverable streaming text, and advisory word targets.
- Persistent batch planning and AUTO / bounded-YOLO execution.
- Canon, timeline, foreshadowing, hierarchical long-memory summaries, and Prompt assembly traces.
- Searchable Memory Browser with immutable author revisions, sources, diffs, restore, usage trace, and Markdown conflicts.
- OFF / AUTO / YOLO relationship extraction with candidates, evidence, validity intervals, revision history, graph, and list views.
- Content-free statistics for real ModelRun counts, success/failure, provider-reported input/output/cache Token coverage, generated AI words, and per-chapter usage.
- Markdown/TXT import, approved-manuscript export, and allowlisted portable project snapshot v1/v2.

The statistics endpoint never returns manuscript, Prompt, model output, credentials, or machine-local workspace paths. Token values are counted only when supplied by the provider; missing usage is not estimated. Each successful chapter-draft ModelRun contributes its first persisted model manuscript once, so later approval copies cannot double-count output.

## Writing-first safeguards

Usable prose is not discarded merely because a chapter misses its target length, foundations are incomplete, scene-plan formatting is malformed, relationship mode is OFF, a relationship is ambiguous, or regenerable Memory/relationship/Markdown enrichment fails. These conditions become fallbacks, pending candidates, review drafts, or retryable warnings.

Hard stops remain for no usable manuscript, credential/quota or unrecoverable provider errors, cancellation, archive state, authority or revision drift, concurrent ownership loss, programming defects, and SQLite failures. Provider output limits receive bounded continuation attempts; remaining usable text is retained as an author-review draft.

## Memory and Markdown authority

SQLite is authoritative. Optional project-folder synchronization mirrors chapters under `chapters/`, approved foundations under `foundation/`, and governed memory under `memory/`.

User-created Markdown is never injected directly into a Prompt merely because it exists in `memory/`. It must first be scanned and registered as a SQLite Memory item; only an active, Prompt-enabled, conflict-free revision that passes the normal authority and token-budget rules can be selected. Concurrent database and file edits create an explicit three-way conflict rather than silently overwriting either side.

Approved Foundation/Canon/manuscript facts outrank author constraints and confirmed relationships, which outrank derived summaries and ordinary references. Relationship candidates never enter prompts; only confirmed relationships may be selected for later chapters.

## Update, uninstall, and data

Stop Harness and back up the complete `$DSH_HOME/data/novel-studio/` directory before updating. Install the new verified tarball with the same `dsh plugin --profile web add <tarball>` command, restart, and run `novel_doctor`. Do not open a newer-schema database with an older Bundle.

Remove plugin code with:

```bash
dsh plugin --profile web remove @novel-studio/dsh-novel-studio
```

Removal and upgrades preserve `$DSH_HOME/data/novel-studio/`. The directory contains private manuscripts, versions, queues, memory, relationships, traces, exports, and logs. Delete it manually only after stopping Harness and verifying a complete backup.

The published tarball is restricted to compiled `lib/`, declarations, `cordis.patch.yml`, this README, MIT license, and package metadata. It contains no database, manuscript, export, backup, log, credential, environment file, test fixture, or absolute build-machine path.

Full source, release assets, documentation, and issue tracking: [github.com/XucroYuri/dsh-script](https://github.com/XucroYuri/dsh-script)
