# Data and privacy

## Local data boundary

Novel Studio stores its SQLite database and operational directories under:

```text
$DSH_HOME/data/novel-studio/
```

This location is separate from the Bundle installation. Plugin removal and code updates are designed to preserve it.

The directory may contain manuscripts, immutable version history, batch plans and queues, author-memory revision/source/usage history, Markdown conflicts, relationship candidates and evidence, model and Prompt traces, workflow events, Canon and knowledge records, recovery state, exports, backups, and logs. Treat the complete directory as private user content.

## Portable project snapshot boundary

The project-library snapshot is a schema-validated, allowlisted migration package for one project. It is not an SQLite export and is not a complete backup of `$DSH_HOME/data/novel-studio/`.

Portable snapshot schema v2 contains the schema v1 project metadata and targets, project writing rules, structured Style Profile, Book/Volume/Chapter hierarchy, every immutable manuscript version and its links/status, and every version of the three active foundations: full-book outline, characters, and story timeline. It additionally carries author-owned memory with its complete immutable revision and source history, plus confirmed relationship history, evidence, and the associated entities and aliases. Foundation records retain their dependency links and limited provider/model/prompt-version/hash provenance, but no reusable Prompt Asset or Prompt-selection state. Import remains compatible with schema v1.

The snapshot excludes chapter batches and plans, workflow nodes/events, model runs and generation traces, relationship candidates and extraction runs, reproducible model-derived memories, memory usage records, Markdown bindings and unresolved conflicts, Canon candidates/facts and other knowledge indexes, Prompt Assets and project Prompt selection, live generation state, Harness sessions and workspace selection, Recovery Capsules, original database IDs, local workspace or mirrored-file paths, Markdown-sync state, credentials, environment values, logs, and SQLite files. Confirmed relationship evidence is limited to its own allowlisted portable metadata rather than carrying the source Canon table. Restore creates fresh IDs and deliberately clears machine-local workspace configuration.

Use the snapshot only to migrate or duplicate authoring content. For full rollback or disaster recovery, stop Harness and copy the entire `$DSH_HOME/data/novel-studio/` directory, including SQLite WAL/SHM sidecars when present.

## Model context

Generation uses the model provider already selected in Harness. The first full-book-outline, character-system, or story-timeline draft can be generated without any user-written brief. That request sends the project title, genre, audience, the optional brief if present, and approved upstream foundation sections. If the user reviews a draft and chooses to revise it through questions, the provider also receives the current draft and the answers already confirmed in that revision run so it can ask only one to three decisions that would materially change the result. Selected options and custom answers are sent to the same provider on the next evaluation round and, after readiness is confirmed or the bounded intake is closed, as constraints for the revised version. Questions, answers, planning-round numbers, readiness summaries, and structured evaluation outputs are stored in local SQLite, remain scoped to their project and generation run, and are not added to unrelated project prompts. Scene-plan and chapter-draft generation sends the selected Prompt Asset, project writing rules, whichever of the three foundation stages currently have approved versions, current chapter/manuscript state, and applicable Canon/retrieval context. The author may generate without a complete Foundation; missing stages are not fabricated or silently sent. Historical worldbuilding and foreshadowing foundation records remain stored for compatibility but are not silently assembled into the new three-stage chain. Draft or superseded versions are never added to chapter prompts. Recovery context intentionally contains project/chapter pointers, revisions, workflow state, and pending decisions rather than full manuscript text.

Batch planning sends only the selected/current project context needed to propose the requested chapter briefs: approved foundation material, preceding approved chapter context, active author memory, and confirmed relationships. The resulting plan and frozen automation policy are stored locally with the batch. AUTO/YOLO changes approval behavior only; it does not change the selected Harness provider or create a second external service.

Relationship extraction is disabled by default, and leaving it OFF does not disable chapter or YOLO writing. When the author enables AUTO or YOLO, extraction uses approved foundation content, the current approved manuscript, Canon, timeline, and foreshadowing sources for that project. Drafts and historical projects are not scanned by default. Candidates, confidence, entity mappings, and evidence are stored locally; unknown or ambiguous candidates remain pending, candidates never enter later prompts, and extraction warnings do not broaden the data sent to the model. Only confirmed relationships may be included in generation context. No external graph database or vector service is introduced.

Author memory is stored in SQLite with immutable revisions. When optional Markdown synchronization is enabled, project-relative files are a mirror and editable reference rather than the authority for Canon. If both database and file change, the shared base plus both current sides are retained locally; the author sees base→SQLite and base→Markdown diffs, may edit the proposed merge, and saves the resolution as a new immutable revision. ModelRun usage rows record inclusion, truncation, estimated tokens, and omission reason; they do not contain provider credentials. Memory-list and usage-history cursors are local pagination tokens, not external tracking identifiers.

Historical-project original excerpts are disabled by default. Enabling them is an explicit per-project choice; summaries and structural metadata should be preferred where sufficient.

Inline selection rewriting sends the selected fragment, at most 2,400 surrounding characters on each side, project writing rules, approved foundation constraints, and applicable compact long-novel summaries to the current Harness model provider. It does not send the entire editable chapter merely to perform a short rewrite. The model response is treated only as a replacement candidate; it does not update SQLite or create a manuscript version until the Client verifies the frozen text snapshot, applies only the selected range, and the normal save/autosave path creates a new immutable draft version.

## Package boundary

The package `files` whitelist includes only:

- `lib/`
- `cordis.patch.yml`
- `README.md`
- `LICENSE`
- npm-generated package metadata

It must not include databases, manuscripts, exports, backups, logs, credentials, environment files, test fixtures containing user text, or absolute paths from the build machine. Source maps contain project source code for diagnostics but no runtime database or user manuscript data.

Before release, run a dry-run pack audit and inspect the exact tarball file list and built files for credentials and absolute local paths.

## Public source repository boundary

The public Git repository contains source code, tests, and documentation. Git ignore rules exclude local databases, runtime data directories, exports, backups, logs, generated `lib/` output, and release archives. Test fixtures must use fictional sample content owned by the project; real user manuscripts and project-specific production traces must be removed or anonymized before a commit is published.
