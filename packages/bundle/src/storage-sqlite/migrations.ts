export const EXPECTED_SCHEMA_VERSION = 20

export interface Migration {
  version: number
  name: string
  sql: string
  disableForeignKeys?: boolean
}

export const migrations: Migration[] = [{
  version: 1,
  name: 'phase-1-project-and-manuscript-core',
  sql: `
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      language TEXT NOT NULL DEFAULT 'zh-CN',
      genre TEXT,
      audience TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      target_word_count INTEGER,
      chapter_target_words INTEGER,
      current_book_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    ) STRICT;

    CREATE TABLE books (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, position)
    ) STRICT;

    CREATE TABLE volumes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      book_id TEXT NOT NULL REFERENCES books(id),
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(book_id, position)
    ) STRICT;

    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      book_id TEXT NOT NULL REFERENCES books(id),
      volume_id TEXT REFERENCES volumes(id),
      chapter_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
      current_draft_version_id TEXT,
      current_approved_version_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(book_id, chapter_number)
    ) STRICT;

    CREATE TABLE manuscript_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      parent_version_id TEXT REFERENCES manuscript_versions(id),
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'superseded')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('user', 'autosave')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT
    ) STRICT;

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      manuscript_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
      decision TEXT NOT NULL CHECK (decision = 'approved'),
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE workspace_states (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      selected_project_id TEXT REFERENCES projects(id),
      selected_chapter_id TEXT REFERENCES chapters(id),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX manuscript_versions_chapter_created
      ON manuscript_versions(chapter_id, created_at DESC);
    CREATE INDEX chapters_project_number
      ON chapters(project_id, chapter_number);
  `,
}, {
  version: 2,
  name: 'phase-2-prompt-assets-and-generation-trace',
  disableForeignKeys: true,
  sql: `
    DROP INDEX manuscript_versions_chapter_created;
    ALTER TABLE approvals RENAME TO approvals_phase1;
    ALTER TABLE manuscript_versions RENAME TO manuscript_versions_phase1;

    CREATE TABLE manuscript_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      parent_version_id TEXT REFERENCES manuscript_versions(id),
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'superseded')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('user', 'autosave', 'model')),
      created_by TEXT NOT NULL CHECK (created_by IN ('user', 'model')),
      prompt_asset_version_id TEXT,
      model_run_id TEXT,
      created_at TEXT NOT NULL,
      approved_at TEXT
    ) STRICT;

    INSERT INTO manuscript_versions(
      id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,created_at,approved_at
    ) SELECT id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,created_at,approved_at
      FROM manuscript_versions_phase1;

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      manuscript_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
      decision TEXT NOT NULL CHECK (decision = 'approved'),
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO approvals SELECT * FROM approvals_phase1;
    DROP TABLE approvals_phase1;
    DROP TABLE manuscript_versions_phase1;

    CREATE TABLE prompt_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      locale TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('builtin', 'user')),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE prompt_assets (
      id TEXT PRIMARY KEY,
      prompt_pack_id TEXT NOT NULL REFERENCES prompt_packs(id),
      asset_key TEXT NOT NULL,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('scene-plan', 'chapter-draft')),
      active_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(prompt_pack_id, asset_key)
    ) STRICT;

    CREATE TABLE prompt_asset_versions (
      id TEXT PRIMARY KEY,
      prompt_asset_id TEXT NOT NULL REFERENCES prompt_assets(id),
      version INTEGER NOT NULL,
      locale TEXT NOT NULL,
      template TEXT NOT NULL,
      input_schema_json TEXT NOT NULL,
      output_schema_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('builtin', 'user')),
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(prompt_asset_id, version)
    ) STRICT;

    CREATE TABLE project_rules (
      project_id TEXT PRIMARY KEY REFERENCES projects(id),
      style_rules TEXT NOT NULL,
      chapter_goal TEXT NOT NULL,
      forbidden_content TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE project_prompt_overrides (
      project_id TEXT NOT NULL REFERENCES projects(id),
      purpose TEXT NOT NULL CHECK (purpose IN ('scene-plan', 'chapter-draft')),
      prompt_asset_version_id TEXT NOT NULL REFERENCES prompt_asset_versions(id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, purpose)
    ) STRICT;

    CREATE TABLE model_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      purpose TEXT NOT NULL CHECK (purpose IN ('scene-plan', 'chapter-draft')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_asset_version_id TEXT NOT NULL REFERENCES prompt_asset_versions(id),
      input_manuscript_version_id TEXT REFERENCES manuscript_versions(id),
      project_revision INTEGER NOT NULL,
      chapter_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      input_snapshot_json TEXT NOT NULL,
      output_json TEXT,
      usage_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE scene_plans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      model_run_id TEXT NOT NULL UNIQUE REFERENCES model_runs(id),
      prompt_asset_version_id TEXT NOT NULL REFERENCES prompt_asset_versions(id),
      input_manuscript_version_id TEXT REFERENCES manuscript_versions(id),
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX manuscript_versions_chapter_created
      ON manuscript_versions(chapter_id, created_at DESC);
    CREATE INDEX model_runs_chapter_created
      ON model_runs(chapter_id, created_at DESC);
    CREATE INDEX scene_plans_chapter_created
      ON scene_plans(chapter_id, created_at DESC);
  `,
}, {
  version: 3,
  name: 'phase-3-persistent-workflows-approval-and-canon',
  sql: `
    ALTER TABLE manuscript_versions ADD COLUMN workflow_run_id TEXT;
    ALTER TABLE manuscript_versions ADD COLUMN workflow_node_run_id TEXT;

    CREATE TABLE workflow_definitions (
      id TEXT PRIMARY KEY,
      definition_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE workflow_definition_versions (
      id TEXT PRIMARY KEY,
      workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
      version INTEGER NOT NULL,
      definition_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workflow_definition_id, version)
    ) STRICT;

    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      definition_version_id TEXT NOT NULL REFERENCES workflow_definition_versions(id),
      status TEXT NOT NULL CHECK (status IN ('running','paused','waiting_approval','succeeded','failed','cancel_requested','cancelled')),
      current_node_key TEXT,
      input_snapshot_json TEXT NOT NULL,
      project_revision_at_start INTEGER NOT NULL,
      chapter_revision_at_start INTEGER NOT NULL,
      approved_version_id TEXT REFERENCES manuscript_versions(id),
      revision_round INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_json TEXT
    ) STRICT;

    CREATE TABLE workflow_node_runs (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      node_key TEXT NOT NULL,
      node_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','ready','running','waiting_approval','succeeded','failed_retryable','failed_terminal','cancel_requested','cancelled','skipped')),
      attempt INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      input_json TEXT NOT NULL,
      output_json TEXT,
      started_at TEXT,
      finished_at TEXT,
      error_json TEXT
    ) STRICT;

    CREATE TABLE workflow_events (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      node_run_id TEXT REFERENCES workflow_node_runs(id),
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE workflow_approvals (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      manuscript_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
      status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
      decision_note TEXT NOT NULL DEFAULT '',
      decided_at TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE review_reports (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id),
      manuscript_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
      review_kind TEXT NOT NULL CHECK (review_kind IN ('plot','character','timeline','style','aggregate')),
      verdict TEXT NOT NULL CHECK (verdict IN ('pass','revise')),
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workflow_run_id, node_run_id, review_kind)
    ) STRICT;

    CREATE TABLE canon_candidates (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      manuscript_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('candidate','validated','committed','rejected')),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE canon_facts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      source_manuscript_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
      candidate_id TEXT NOT NULL UNIQUE REFERENCES canon_candidates(id),
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX workflow_runs_chapter_created ON workflow_runs(chapter_id, created_at DESC);
    CREATE INDEX workflow_node_runs_run_node ON workflow_node_runs(workflow_run_id, node_key, attempt DESC);
    CREATE INDEX workflow_events_run_created ON workflow_events(workflow_run_id, created_at);
    CREATE INDEX workflow_approvals_run_created ON workflow_approvals(workflow_run_id, created_at DESC);
    CREATE INDEX canon_facts_project_created ON canon_facts(project_id, created_at DESC);
  `,
}, {
  version: 4,
  name: 'phase-4-knowledge-retrieval-and-history',
  sql: `
    ALTER TABLE workflow_runs ADD COLUMN knowledge_selection_snapshot_id TEXT;

    CREATE TABLE story_entities (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), entity_type TEXT NOT NULL,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source_manuscript_version_id TEXT REFERENCES manuscript_versions(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, entity_type, name)
    ) STRICT;
    CREATE TABLE entity_aliases (
      id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
      alias TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(entity_id, alias)
    ) STRICT;
    CREATE TABLE timeline_events (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), chapter_id TEXT NOT NULL REFERENCES chapters(id),
      source_manuscript_version_id TEXT NOT NULL REFERENCES manuscript_versions(id), title TEXT NOT NULL, summary TEXT NOT NULL,
      story_order INTEGER NOT NULL, status TEXT NOT NULL CHECK(status='canon'), created_at TEXT NOT NULL,
      UNIQUE(source_manuscript_version_id)
    ) STRICT;
    CREATE TABLE timeline_event_entities (
      timeline_event_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
      PRIMARY KEY(timeline_event_id, entity_id)
    ) STRICT;
    CREATE TABLE foreshadowing_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('planned','planted','reinforced','resolved','abandoned')),
      source_manuscript_version_id TEXT REFERENCES manuscript_versions(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE foreshadowing_transitions (
      id TEXT PRIMARY KEY, foreshadowing_id TEXT NOT NULL REFERENCES foreshadowing_items(id) ON DELETE CASCADE,
      from_status TEXT, to_status TEXT NOT NULL, source_manuscript_version_id TEXT REFERENCES manuscript_versions(id),
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE knowledge_summaries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), summary_scope TEXT NOT NULL,
      source_id TEXT NOT NULL, source_version_id TEXT, content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('current','stale')), updated_at TEXT NOT NULL,
      UNIQUE(project_id, summary_scope, source_id)
    ) STRICT;
    CREATE TABLE historical_source_settings (
      project_id TEXT NOT NULL REFERENCES projects(id), source_project_id TEXT NOT NULL REFERENCES projects(id),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), scopes_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, source_project_id), CHECK(project_id != source_project_id)
    ) STRICT;
    CREATE TABLE knowledge_selection_snapshots (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), project_revision INTEGER NOT NULL,
      excluded_source_ids_json TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE knowledge_selection_items (
      id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES knowledge_selection_snapshots(id) ON DELETE CASCADE,
      source_project_id TEXT NOT NULL REFERENCES projects(id), source_project_title TEXT NOT NULL, scopes_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE retrieval_runs (
      id TEXT PRIMARY KEY, workflow_run_id TEXT NOT NULL UNIQUE REFERENCES workflow_runs(id), project_id TEXT NOT NULL REFERENCES projects(id),
      purpose TEXT NOT NULL, project_revision INTEGER NOT NULL, selection_snapshot_id TEXT NOT NULL REFERENCES knowledge_selection_snapshots(id),
      conflicts_json TEXT NOT NULL, truncated INTEGER NOT NULL CHECK(truncated IN (0,1)), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE retrieval_items (
      id TEXT PRIMARY KEY, retrieval_run_id TEXT NOT NULL REFERENCES retrieval_runs(id) ON DELETE CASCADE,
      item_kind TEXT NOT NULL, content TEXT NOT NULL, source_id TEXT NOT NULL, source_version_id TEXT,
      source_project_id TEXT NOT NULL REFERENCES projects(id), source_project_title TEXT NOT NULL,
      authority TEXT NOT NULL, citation_label TEXT NOT NULL, rank INTEGER NOT NULL
    ) STRICT;
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(
      project_id UNINDEXED, source_type UNINDEXED, source_id UNINDEXED, source_version_id UNINDEXED, content,
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE INDEX story_entities_project_type ON story_entities(project_id, entity_type, name);
    CREATE INDEX timeline_events_project_order ON timeline_events(project_id, story_order);
    CREATE INDEX knowledge_summaries_project_scope ON knowledge_summaries(project_id, summary_scope);
    CREATE INDEX retrieval_items_run_rank ON retrieval_items(retrieval_run_id, rank);
  `,
}, {
  version: 5,
  name: 'phase-5-session-recovery-capsules',
  sql: `
    CREATE TABLE session_project_bindings (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT REFERENCES chapters(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE recovery_capsules (
      session_id TEXT PRIMARY KEY REFERENCES session_project_bindings(session_id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL CHECK(schema_version = 1),
      project_id TEXT NOT NULL REFERENCES projects(id),
      book_id TEXT REFERENCES books(id),
      chapter_id TEXT REFERENCES chapters(id),
      active_draft_version_id TEXT REFERENCES manuscript_versions(id),
      workflow_run_id TEXT REFERENCES workflow_runs(id),
      workflow_node TEXT,
      knowledge_selection_snapshot_id TEXT REFERENCES knowledge_selection_snapshots(id),
      prompt_pack_id TEXT NOT NULL REFERENCES prompt_packs(id),
      last_approved_project_revision INTEGER NOT NULL,
      pending_user_decisions_json TEXT NOT NULL,
      recovery_generated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX session_project_bindings_project ON session_project_bindings(project_id, updated_at DESC);
    CREATE INDEX recovery_capsules_project ON recovery_capsules(project_id, recovery_generated_at DESC);
  `,
}, {
  version: 6,
  name: 'phase-5-5-outline-graph-and-story-growth',
  sql: `
    CREATE TABLE outline_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      source_text TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      output_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      UNIQUE(project_id, version)
    ) STRICT;

    CREATE TABLE outline_nodes (
      id TEXT PRIMARY KEY,
      outline_version_id TEXT NOT NULL REFERENCES outline_versions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      node_type TEXT NOT NULL CHECK(node_type IN ('plot_beat','character_change','conflict','reveal','foreshadow','payoff','worldbuilding','transition')),
      dramatic_function TEXT NOT NULL,
      characters_json TEXT NOT NULL,
      locations_json TEXT NOT NULL,
      causes_json TEXT NOT NULL,
      effects_json TEXT NOT NULL,
      foreshadowing_json TEXT NOT NULL,
      must_happen INTEGER NOT NULL CHECK(must_happen IN (0,1)),
      planned_weight INTEGER NOT NULL CHECK(planned_weight BETWEEN 1 AND 100),
      UNIQUE(outline_version_id, position)
    ) STRICT;

    CREATE TABLE outline_node_edges (
      id TEXT PRIMARY KEY,
      outline_version_id TEXT NOT NULL REFERENCES outline_versions(id) ON DELETE CASCADE,
      from_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
      to_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK(relation IN ('sequence','causes','foreshadows','pays_off')),
      UNIQUE(outline_version_id, from_node_id, to_node_id, relation),
      CHECK(from_node_id != to_node_id)
    ) STRICT;

    CREATE TABLE scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      scene_plan_id TEXT REFERENCES scene_plans(id),
      scene_key TEXT NOT NULL,
      label TEXT NOT NULL,
      position INTEGER NOT NULL,
      estimated_words INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(chapter_id, scene_plan_id, scene_key)
    ) STRICT;

    CREATE TABLE outline_fulfillment_links (
      id TEXT PRIMARY KEY,
      outline_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      scene_id TEXT REFERENCES scenes(id),
      manuscript_version_id TEXT REFERENCES manuscript_versions(id),
      segment_start INTEGER,
      segment_end INTEGER,
      word_count INTEGER NOT NULL DEFAULT 0,
      alignment_source TEXT NOT NULL CHECK(alignment_source IN ('generation_trace','scene_plan','manual','ai_suggestion')),
      confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
      confirmed INTEGER NOT NULL CHECK(confirmed IN (0,1)),
      created_at TEXT NOT NULL,
      UNIQUE(outline_node_id, chapter_id, scene_id, manuscript_version_id)
    ) STRICT;

    CREATE INDEX outline_versions_project_version ON outline_versions(project_id, version DESC);
    CREATE INDEX outline_nodes_version_position ON outline_nodes(outline_version_id, position);
    CREATE INDEX outline_fulfillment_node ON outline_fulfillment_links(outline_node_id, confirmed, chapter_id);
    CREATE INDEX outline_fulfillment_chapter ON outline_fulfillment_links(chapter_id, confirmed, outline_node_id);
    CREATE INDEX scenes_chapter_position ON scenes(chapter_id, position);
  `,
}, {
  version: 7,
  name: 'project-foundation-and-dynamic-prompt-assembly',
  sql: `
    CREATE TABLE project_foundation_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      foundation_kind TEXT NOT NULL CHECK(foundation_kind IN ('outline','characters','worldbuilding','timeline','foreshadowing')),
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      dependency_version_ids_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      UNIQUE(project_id, foundation_kind, version)
    ) STRICT;

    CREATE INDEX project_foundation_project_kind_version
      ON project_foundation_versions(project_id, foundation_kind, version DESC);
    CREATE INDEX project_foundation_approved
      ON project_foundation_versions(project_id, foundation_kind, status);
  `,
}, {
  version: 8,
  name: 'guided-foundation-planner-and-progress',
  sql: `
    CREATE TABLE project_foundation_generation_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      foundation_kind TEXT NOT NULL CHECK(foundation_kind IN ('outline','characters','worldbuilding','timeline','foreshadowing')),
      guided INTEGER NOT NULL CHECK(guided IN (0,1)),
      status TEXT NOT NULL CHECK(status IN ('planning','waiting_input','generating','succeeded','failed','cancelled')),
      phase TEXT NOT NULL,
      progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
      brief TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      dependency_version_ids_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      question_prompt_hash TEXT,
      question_output_json TEXT,
      streamed_characters INTEGER NOT NULL DEFAULT 0,
      result_version_id TEXT REFERENCES project_foundation_versions(id),
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    ALTER TABLE project_foundation_versions
      ADD COLUMN generation_run_id TEXT REFERENCES project_foundation_generation_runs(id);

    CREATE UNIQUE INDEX project_foundation_active_generation
      ON project_foundation_generation_runs(project_id)
      WHERE status IN ('planning','waiting_input','generating');
    CREATE INDEX project_foundation_generation_project_kind
      ON project_foundation_generation_runs(project_id, foundation_kind, created_at DESC);
    CREATE UNIQUE INDEX project_foundation_version_generation_run
      ON project_foundation_versions(generation_run_id)
      WHERE generation_run_id IS NOT NULL;
  `,
}, {
  version: 9,
  name: 'multi-round-foundation-information-readiness',
  sql: `
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN planning_round INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN information_ready INTEGER NOT NULL DEFAULT 0 CHECK(information_ready IN (0,1));
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN readiness_summary TEXT NOT NULL DEFAULT '';
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN planning_history_json TEXT NOT NULL DEFAULT '[]';

    UPDATE project_foundation_generation_runs
      SET planning_round=1,
          readiness_summary='已恢复旧版本规划问题；请完成当前回答后继续检查信息充分性。'
      WHERE planning_round=0 AND questions_json<>'[]';
  `,
}, {
  version: 10,
  name: 'native-harness-foundation-interaction',
  sql: `
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN interaction_session_id TEXT;

    CREATE INDEX project_foundation_generation_interaction_session
      ON project_foundation_generation_runs(interaction_session_id, status, updated_at DESC)
      WHERE interaction_session_id IS NOT NULL;
  `,
}, {
  version: 11,
  name: 'recoverable-live-generation-manuscripts',
  sql: `
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN streamed_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN streamed_text_updated_at TEXT;

    ALTER TABLE model_runs
      ADD COLUMN streamed_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE model_runs
      ADD COLUMN streamed_text_updated_at TEXT;
  `,
}, {
  version: 12,
  name: 'generation-pulse-and-layered-long-novel-memory',
  sql: `
    ALTER TABLE project_foundation_generation_runs
      ADD COLUMN generation_telemetry_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE model_runs
      ADD COLUMN generation_telemetry_json TEXT NOT NULL DEFAULT '{}';

    ALTER TABLE knowledge_summaries
      ADD COLUMN structured_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE knowledge_summaries
      ADD COLUMN compact_narrative TEXT NOT NULL DEFAULT '';
    ALTER TABLE knowledge_summaries
      ADD COLUMN source_start_chapter INTEGER;
    ALTER TABLE knowledge_summaries
      ADD COLUMN source_end_chapter INTEGER;
    ALTER TABLE knowledge_summaries
      ADD COLUMN source_version_ids_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE knowledge_summaries
      ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
    ALTER TABLE knowledge_summaries
      ADD COLUMN provider TEXT;
    ALTER TABLE knowledge_summaries
      ADD COLUMN model TEXT;
    ALTER TABLE knowledge_summaries
      ADD COLUMN prompt_hash TEXT;
  `,
}, {
  version: 13,
  name: 'bounded-foundation-intake-recovery',
  sql: `
    UPDATE project_foundation_generation_runs
      SET status='generating',
          phase='information_ready',
          progress=CASE WHEN progress < 42 THEN 42 ELSE progress END,
          information_ready=1,
          readiness_summary=CASE
            WHEN trim(readiness_summary)='' THEN '有界需求采集已达到 4 轮或 12 项确认上限。系统将使用已保存的回答生成正式草稿；剩余细节不再阻塞生成。'
            ELSE readiness_summary || char(10) || char(10) || '有界需求采集已达到 4 轮或 12 项确认上限。系统将使用已保存的回答生成正式草稿；剩余细节不再阻塞生成。'
          END,
          error_json=NULL,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          finished_at=NULL
      WHERE guided=1
        AND status IN ('planning','waiting_input')
        AND json_array_length(answers_json) > 0
        AND (planning_round >= 4 OR json_array_length(answers_json) >= 12);
  `,
}, {
  version: 14,
  name: 'three-stage-foundation-and-draft-first',
  sql: `
    UPDATE project_foundation_generation_runs
      SET status='cancelled',
          phase='cancelled',
          error_json=NULL,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE foundation_kind IN ('worldbuilding','foreshadowing')
        AND status IN ('planning','waiting_input','generating');
  `,
}, {
  version: 15,
  name: 'structured-writing-style-profiles',
  sql: `
    ALTER TABLE project_rules
      ADD COLUMN style_profile_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE project_rules
      ADD COLUMN style_profile_version INTEGER NOT NULL DEFAULT 0;
  `,
}, {
  version: 16,
  name: 'filesystem-markdown-project-mirror',
  sql: `
    ALTER TABLE projects
      ADD COLUMN project_root_path TEXT;
    ALTER TABLE projects
      ADD COLUMN markdown_sync_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE projects
      ADD COLUMN memory_updated_at TEXT;
  `,
}, {
  version: 17,
  name: 'recoverable-chapter-generation-batches',
  sql: `
    CREATE TABLE project_automation_policies (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      relationship_mode TEXT NOT NULL DEFAULT 'off' CHECK(relationship_mode IN ('off','auto','yolo')),
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE chapter_generation_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK(mode IN ('selected','continuous')),
      automation_mode TEXT NOT NULL CHECK(automation_mode IN ('auto','yolo')),
      status TEXT NOT NULL CHECK(status IN ('planning','awaiting_plan_approval','queued','running','waiting_approval','pause_requested','paused','blocked','succeeded','completed_with_skips','cancelled')),
      requested_count INTEGER NOT NULL CHECK(requested_count BETWEEN 1 AND 20),
      policy_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 0,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE chapter_generation_batch_plans (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL UNIQUE REFERENCES chapter_generation_batches(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('planning','succeeded','failed','cancelled')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      input_snapshot_json TEXT NOT NULL,
      output_json TEXT,
      streamed_text TEXT NOT NULL DEFAULT '',
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE chapter_generation_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES chapter_generation_batches(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id),
      position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 40),
      planned_title TEXT NOT NULL,
      writing_goal TEXT NOT NULL DEFAULT '',
      opening_continuity TEXT NOT NULL DEFAULT '',
      ending_hook TEXT NOT NULL DEFAULT '',
      target_words INTEGER NOT NULL DEFAULT 3000 CHECK(target_words BETWEEN 300 AND 20000),
      queue_state TEXT NOT NULL CHECK(queue_state IN ('planned','queued','dispatched','blocked','skipped','cancelled')),
      workflow_run_id TEXT UNIQUE REFERENCES workflow_runs(id),
      chapter_revision_at_enqueue INTEGER,
      blocked_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id, position),
      UNIQUE(batch_id, chapter_id)
    ) STRICT;

    CREATE TABLE chapter_generation_batch_events (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES chapter_generation_batches(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES chapter_generation_batch_items(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE chapter_writing_briefs (
      chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
      writing_goal TEXT NOT NULL,
      opening_continuity TEXT NOT NULL DEFAULT '',
      ending_hook TEXT NOT NULL DEFAULT '',
      target_words INTEGER NOT NULL CHECK(target_words BETWEEN 300 AND 20000),
      source TEXT NOT NULL CHECK(source IN ('user','batch-plan')),
      revision INTEGER NOT NULL DEFAULT 1,
      batch_item_id TEXT REFERENCES chapter_generation_batch_items(id),
      provider TEXT,
      model TEXT,
      prompt_hash TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX chapter_batches_project_status ON chapter_generation_batches(project_id, status, created_at DESC);
    CREATE INDEX chapter_batch_items_queue ON chapter_generation_batch_items(batch_id, queue_state, position);
    CREATE INDEX chapter_batch_events_batch_created ON chapter_generation_batch_events(batch_id, created_at);
  `,
}, {
  version: 18,
  name: 'versioned-memory-browser',
  sql: `
    CREATE TABLE memory_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      origin TEXT NOT NULL CHECK(origin IN ('derived','user')),
      storage TEXT NOT NULL CHECK(storage IN ('database','markdown')),
      scope TEXT NOT NULL CHECK(scope IN ('foundation','chapter','arc','volume','book','project')),
      category TEXT NOT NULL CHECK(category IN ('continuity','constraint','character','world','timeline','foreshadowing','idea','research','other')),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived','conflicted')),
      prompt_policy TEXT NOT NULL CHECK(prompt_policy IN ('auto','manual','excluded')),
      source_key TEXT NOT NULL,
      current_revision_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, origin, source_key)
    ) STRICT;

    CREATE TABLE memory_revisions (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      content TEXT NOT NULL,
      structured_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL,
      actor TEXT NOT NULL CHECK(actor IN ('model','user','filesystem','migration')),
      parent_revision_id TEXT REFERENCES memory_revisions(id),
      provider TEXT,
      model TEXT,
      prompt_hash TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(item_id, revision)
    ) STRICT;

    CREATE TABLE memory_revision_sources (
      id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_version_id TEXT,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE memory_usage_events (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
      model_run_id TEXT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
      section_key TEXT NOT NULL DEFAULT '',
      included INTEGER NOT NULL CHECK(included IN (0,1)),
      truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN (0,1)),
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(revision_id, model_run_id)
    ) STRICT;

    CREATE TABLE memory_file_bindings (
      item_id TEXT PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      base_hash TEXT NOT NULL DEFAULT '',
      file_hash TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL CHECK(state IN ('clean','changed','missing','conflicted')),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE memory_conflicts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
      base_revision_id TEXT REFERENCES memory_revisions(id),
      base_content TEXT NOT NULL,
      database_revision_id TEXT NOT NULL REFERENCES memory_revisions(id),
      file_content TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','resolved')),
      resolution TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    ) STRICT;

    CREATE VIRTUAL TABLE memory_browser_fts USING fts5(
      item_id UNINDEXED,
      project_id UNINDEXED,
      content,
      tokenize='unicode61'
    );

    INSERT INTO memory_items(id,project_id,origin,storage,scope,category,state,prompt_policy,source_key,revision,created_at,updated_at)
      SELECT 'memory-derived-' || id,project_id,'derived','database',summary_scope,
        CASE summary_scope WHEN 'foundation' THEN 'constraint' WHEN 'chapter' THEN 'continuity' WHEN 'arc' THEN 'continuity' ELSE 'other' END,
        CASE status WHEN 'current' THEN 'active' ELSE 'archived' END,'auto',id,1,updated_at,updated_at
      FROM knowledge_summaries;

    INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,provider,model,prompt_hash,created_at)
      SELECT 'memory-revision-' || id,'memory-derived-' || id,1,
        CASE WHEN trim(compact_narrative)<>'' THEN compact_narrative ELSE content END,
        structured_json,content_hash,'migration',provider,model,prompt_hash,updated_at
      FROM knowledge_summaries;

    UPDATE memory_items
      SET current_revision_id='memory-revision-' || source_key
      WHERE origin='derived';

    INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at)
      SELECT 'memory-source-' || id,'memory-revision-' || id,'knowledge-summary',source_id,source_version_id,summary_scope || ' summary',updated_at
      FROM knowledge_summaries;

    INSERT INTO memory_browser_fts(item_id,project_id,content)
      SELECT mi.id,mi.project_id,mr.content FROM memory_items mi JOIN memory_revisions mr ON mr.id=mi.current_revision_id;

    CREATE INDEX memory_items_project_state ON memory_items(project_id, state, scope, category, updated_at DESC);
    CREATE INDEX memory_revisions_item_revision ON memory_revisions(item_id, revision DESC);
    CREATE INDEX memory_sources_revision ON memory_revision_sources(revision_id, created_at);
    CREATE INDEX memory_usage_item_created ON memory_usage_events(item_id, created_at DESC);
    CREATE INDEX memory_conflicts_item_status ON memory_conflicts(item_id, status);
  `,
}, {
  version: 19,
  name: 'bounded-entity-relationship-graph',
  sql: `
    CREATE TABLE relationship_extraction_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      automation_mode TEXT NOT NULL CHECK(automation_mode IN ('auto','yolo')),
      status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_review','succeeded','blocked','failed','cancelled')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      source_snapshot_json TEXT NOT NULL,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE relationship_extraction_sources (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES relationship_extraction_runs(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_version_id TEXT,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','succeeded','failed')),
      error_json TEXT,
      UNIQUE(run_id, source_type, source_id, source_version_id)
    ) STRICT;

    CREATE TABLE relationship_candidates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES relationship_extraction_runs(id) ON DELETE CASCADE,
      source_entity_id TEXT REFERENCES story_entities(id),
      target_entity_id TEXT REFERENCES story_entities(id),
      source_label TEXT NOT NULL,
      target_label TEXT NOT NULL,
      predicate_key TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('family','emotion','alliance','conflict','membership','possession','location','knowledge','causality','other')),
      directionality TEXT NOT NULL CHECK(directionality IN ('directed','symmetric')),
      fact_layer TEXT NOT NULL CHECK(fact_layer IN ('planned','canon','author_asserted')),
      valid_from_story_order INTEGER,
      valid_to_story_order INTEGER,
      confidence REAL NOT NULL DEFAULT 0 CHECK(confidence BETWEEN 0 AND 1),
      status TEXT NOT NULL CHECK(status IN ('pending','ambiguous','confirmed','rejected')),
      evidence_json TEXT NOT NULL DEFAULT '[]',
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE entity_relationships (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_entity_id TEXT NOT NULL REFERENCES story_entities(id),
      target_entity_id TEXT NOT NULL REFERENCES story_entities(id),
      predicate_key TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('family','emotion','alliance','conflict','membership','possession','location','knowledge','causality','other')),
      directionality TEXT NOT NULL CHECK(directionality IN ('directed','symmetric')),
      fact_layer TEXT NOT NULL CHECK(fact_layer IN ('planned','canon','author_asserted')),
      valid_from_story_order INTEGER,
      valid_to_story_order INTEGER,
      status TEXT NOT NULL CHECK(status IN ('active','superseded')),
      supersedes_relationship_id TEXT REFERENCES entity_relationships(id),
      created_by TEXT NOT NULL CHECK(created_by IN ('user','ai_confirmed','ai_yolo')),
      fingerprint TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE entity_relationship_evidence (
      id TEXT PRIMARY KEY,
      relationship_id TEXT NOT NULL REFERENCES entity_relationships(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_version_id TEXT,
      label TEXT NOT NULL,
      excerpt_start INTEGER,
      excerpt_end INTEGER,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE UNIQUE INDEX entity_relationship_active_fingerprint ON entity_relationships(project_id, fingerprint) WHERE status='active';
    CREATE INDEX relationship_source_active ON entity_relationships(project_id, status, source_entity_id);
    CREATE INDEX relationship_target_active ON entity_relationships(project_id, status, target_entity_id);
    CREATE INDEX relationship_category_active ON entity_relationships(project_id, status, category, predicate_key);
    CREATE INDEX relationship_candidates_run_status ON relationship_candidates(run_id, status, created_at);
    CREATE INDEX relationship_runs_project_status ON relationship_extraction_runs(project_id, status, created_at DESC);
  `,
}, {
  version: 20,
  name: 'positive-unbounded-chapter-word-targets',
  disableForeignKeys: true,
  sql: `
    CREATE TABLE chapter_generation_batch_items_v20 (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES chapter_generation_batches(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id),
      position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 40),
      planned_title TEXT NOT NULL,
      writing_goal TEXT NOT NULL DEFAULT '',
      opening_continuity TEXT NOT NULL DEFAULT '',
      ending_hook TEXT NOT NULL DEFAULT '',
      target_words INTEGER NOT NULL DEFAULT 3000 CHECK(target_words >= 1),
      queue_state TEXT NOT NULL CHECK(queue_state IN ('planned','queued','dispatched','blocked','skipped','cancelled')),
      workflow_run_id TEXT UNIQUE REFERENCES workflow_runs(id),
      chapter_revision_at_enqueue INTEGER,
      blocked_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id, position),
      UNIQUE(batch_id, chapter_id)
    ) STRICT;

    INSERT INTO chapter_generation_batch_items_v20(
      id,batch_id,chapter_id,position,planned_title,writing_goal,opening_continuity,ending_hook,target_words,
      queue_state,workflow_run_id,chapter_revision_at_enqueue,blocked_reason,created_at,updated_at
    ) SELECT
      id,batch_id,chapter_id,position,planned_title,writing_goal,opening_continuity,ending_hook,target_words,
      queue_state,workflow_run_id,chapter_revision_at_enqueue,blocked_reason,created_at,updated_at
    FROM chapter_generation_batch_items;

    CREATE TABLE chapter_writing_briefs_v20 (
      chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
      writing_goal TEXT NOT NULL,
      opening_continuity TEXT NOT NULL DEFAULT '',
      ending_hook TEXT NOT NULL DEFAULT '',
      target_words INTEGER NOT NULL CHECK(target_words >= 1),
      source TEXT NOT NULL CHECK(source IN ('user','batch-plan')),
      revision INTEGER NOT NULL DEFAULT 1,
      batch_item_id TEXT REFERENCES chapter_generation_batch_items_v20(id),
      provider TEXT,
      model TEXT,
      prompt_hash TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO chapter_writing_briefs_v20(
      chapter_id,writing_goal,opening_continuity,ending_hook,target_words,source,revision,batch_item_id,
      provider,model,prompt_hash,updated_at
    ) SELECT
      chapter_id,writing_goal,opening_continuity,ending_hook,target_words,source,revision,batch_item_id,
      provider,model,prompt_hash,updated_at
    FROM chapter_writing_briefs;

    DROP TABLE chapter_writing_briefs;
    DROP INDEX chapter_batch_items_queue;
    DROP TABLE chapter_generation_batch_items;
    ALTER TABLE chapter_generation_batch_items_v20 RENAME TO chapter_generation_batch_items;
    ALTER TABLE chapter_writing_briefs_v20 RENAME TO chapter_writing_briefs;

    CREATE INDEX chapter_batch_items_queue ON chapter_generation_batch_items(batch_id, queue_state, position);
  `,
}]
