BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.schema_migrations (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app.current_team_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.team_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app.current_member_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.member_id', true), '')
$$;

CREATE TABLE IF NOT EXISTS app.teams (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.team_members (
  team_id text NOT NULL,
  member_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'writer', 'reviewer', 'viewer')),
  status text NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, member_id),
  FOREIGN KEY (team_id) REFERENCES app.teams (id)
);

CREATE TABLE IF NOT EXISTS app.ips (
  team_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, id),
  FOREIGN KEY (team_id) REFERENCES app.teams (id)
);

CREATE TABLE IF NOT EXISTS app.projects (
  team_id text NOT NULL,
  id text NOT NULL,
  ip_id text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  medium text NOT NULL CHECK (medium IN ('episodic', 'feature-film')),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, id),
  FOREIGN KEY (team_id) REFERENCES app.teams (id),
  FOREIGN KEY (team_id, ip_id) REFERENCES app.ips (team_id, id)
);

CREATE TABLE IF NOT EXISTS app.seasons (
  team_id text NOT NULL,
  id text NOT NULL,
  project_id text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  position integer NOT NULL CHECK (position > 0),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  system boolean NOT NULL DEFAULT false,
  PRIMARY KEY (team_id, id),
  UNIQUE (team_id, id, project_id),
  UNIQUE (team_id, project_id, id),
  UNIQUE (team_id, project_id, position),
  FOREIGN KEY (team_id, project_id) REFERENCES app.projects (team_id, id)
);

CREATE TABLE IF NOT EXISTS app.episodes (
  team_id text NOT NULL,
  id text NOT NULL,
  project_id text NOT NULL,
  season_id text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  position integer NOT NULL CHECK (position > 0),
  story_order integer NOT NULL CHECK (story_order > 0),
  status text NOT NULL CHECK (status IN ('draft', 'in-review', 'approved', 'locked', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  primary_episode boolean NOT NULL DEFAULT false,
  current_draft_version_id text,
  current_approved_version_id text,
  PRIMARY KEY (team_id, id),
  UNIQUE (team_id, id, project_id, season_id),
  UNIQUE (team_id, project_id, id),
  UNIQUE (team_id, project_id, season_id, position),
  UNIQUE (team_id, project_id, story_order),
  FOREIGN KEY (team_id, project_id, season_id) REFERENCES app.seasons (team_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS app.sequences (
  team_id text NOT NULL,
  id text NOT NULL,
  project_id text NOT NULL,
  episode_id text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  position integer NOT NULL CHECK (position > 0),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (team_id, id),
  FOREIGN KEY (team_id, project_id, episode_id) REFERENCES app.episodes (team_id, project_id, id),
  UNIQUE (team_id, project_id, episode_id, id),
  UNIQUE (team_id, episode_id, position)
);

CREATE TABLE IF NOT EXISTS app.scenes (
  team_id text NOT NULL,
  id text NOT NULL,
  project_id text NOT NULL,
  episode_id text NOT NULL,
  sequence_id text,
  heading text NOT NULL CHECK (length(trim(heading)) > 0),
  position integer NOT NULL CHECK (position > 0),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (team_id, id),
  FOREIGN KEY (team_id, project_id, episode_id) REFERENCES app.episodes (team_id, project_id, id),
  FOREIGN KEY (team_id, project_id, episode_id, sequence_id) REFERENCES app.sequences (team_id, project_id, episode_id, id),
  UNIQUE (team_id, project_id, episode_id, id),
  UNIQUE (team_id, episode_id, position)
);

CREATE TABLE IF NOT EXISTS app.beats (
  team_id text NOT NULL,
  id text NOT NULL,
  project_id text NOT NULL,
  episode_id text NOT NULL,
  scene_id text NOT NULL,
  text text NOT NULL CHECK (length(trim(text)) > 0),
  position integer NOT NULL CHECK (position > 0),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (team_id, id),
  FOREIGN KEY (team_id, project_id, episode_id, scene_id) REFERENCES app.scenes (team_id, project_id, episode_id, id),
  UNIQUE (team_id, project_id, episode_id, id),
  UNIQUE (team_id, scene_id, position)
);

CREATE TABLE IF NOT EXISTS app.content_objects (
  team_id text NOT NULL,
  id text NOT NULL,
  project_id text NOT NULL,
  object_key text NOT NULL,
  content_hash text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  media_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, id),
  UNIQUE (team_id, object_key),
  FOREIGN KEY (team_id, project_id) REFERENCES app.projects (team_id, id)
);

CREATE TABLE IF NOT EXISTS app.audit_events (
  team_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, id),
  FOREIGN KEY (team_id, actor_id) REFERENCES app.team_members (team_id, member_id)
);

CREATE TABLE IF NOT EXISTS app.idempotency_keys (
  team_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'completed', 'failed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (team_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS app.outbox_events (
  team_id text NOT NULL,
  id text NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (team_id, id)
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx ON app.outbox_events (available_at, created_at) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS audit_team_time_idx ON app.audit_events (team_id, occurred_at, id);

ALTER TABLE app.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_scope ON app.teams;
CREATE POLICY team_scope ON app.teams
  USING (id = app.current_team_id())
  WITH CHECK (id = app.current_team_id());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'team_members', 'ips', 'projects', 'seasons', 'episodes', 'sequences', 'scenes', 'beats',
    'content_objects', 'audit_events', 'idempotency_keys', 'outbox_events'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS team_scope ON app.%I', table_name);
    EXECUTE format('CREATE POLICY team_scope ON app.%I USING (team_id = app.current_team_id()) WITH CHECK (team_id = app.current_team_id())', table_name);
  END LOOP;
END $$;

INSERT INTO app.schema_migrations (id, checksum)
VALUES ('0001_cloud_authority', '0001_cloud_authority:v1')
ON CONFLICT (id) DO NOTHING;

COMMIT;
