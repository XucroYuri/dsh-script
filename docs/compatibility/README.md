# Compatibility matrix

| Component | Supported baseline | Policy |
|---|---:|---|
| Novel Studio Bundle | `0.8.0-author-control.6` | Install the exact GitHub Release `.tgz` |
| DeepSeek Harness | `0.1.0-rc.7` | Exact peer-dependency and release-test baseline |
| Node.js | 24 | Required by Harness and built-in `node:sqlite` |
| Profile | `web` | Other profiles do not expose the Novel Studio Client slot |
| SQLite schema | 1–20 → 20 | Forward migration supported; unknown newer schemas fail closed |
| Operating system | Linux, Windows, macOS | Exact-tarball install/remove/reinstall is a Release matrix gate |

Compatibility is demonstrated by capability checks and real Harness composition, not only version strings. The `v0.8.0-author-control.6` gate performs type checking, 301 unit/integration tests across 37 files, build, pack audit, directory composition, exact-tarball installation, plugin removal, data-preserving reinstallation, clean-manifest verification, SHA-256 verification, and the three-platform package-install matrix.

## Runtime policy

- An incomplete Foundation is advisory, not a chapter-generation gate.
- Malformed scene-plan output falls back to a minimal editable plan.
- Usable prose can be recovered from nonstandard JSON/plain output.
- Provider output limits receive bounded continuation and may end as a yellow author-review draft.
- Optional Foundation digest, Memory, relationship, relationship ambiguity/OFF, and Markdown mirror work may degrade to warnings without invalidating safely persisted prose.
- No usable manuscript, invalid credentials/quota, unrecoverable Provider failure, cancellation, archive state, authority/revision drift, programming errors, and SQLite failure remain hard stops.

The current Harness baseline has no required active conversation-compaction Provider. `novel_doctor` may therefore report Harness compaction unavailable while Novel Studio's own hierarchical long-form memory remains ready.

## Data and migration

Schema 20 removes the former `300–20000` chapter-target database constraint. Target words guide planning and pacing; they do not impose a manuscript acceptance limit. Existing schema 1–19 data migrates in place without deleting projects or manuscripts.

Portable project snapshots v1 and v2 are supported migration inputs. They are allowlisted project packages, not SQLite backups. Full rollback and disaster recovery require a stopped-Harness copy of the complete `$DSH_HOME/data/novel-studio/` directory.

A database upgraded by a newer schema must not be opened with an older Bundle. Harness releases newer than `0.1.0-rc.7` are not claimed compatible until the complete release gate and browser regression pass against that version.

## Release truth

Only the `.tgz`, `SHA256SUMS`, and `release-manifest.json` attached to the matching [GitHub Release](https://github.com/XucroYuri/dsh-script/releases) are formal distribution artifacts. The manifest must identify the tag commit and report `workingTreeDirty: false`. GitHub source archives and a dirty local `pnpm release:pack` output are not formal Bundle releases.
