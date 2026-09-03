// ../../packages/script-contracts/src/host-contract.ts
var HOST_CONTRACT_VERSION = "1.0.0";
var STAGE_2_CAPABILITIES = Object.freeze({
  hierarchyRead: true,
  commandCreateSeason: true,
  authSession: false,
  eventStream: false,
  hostModelGateway: false,
  interactiveAppSurface: false,
  telemetry: false
});

// src/index.ts
var CodexScriptStudioAdapter = class {
  constructor(api, options) {
    this.api = api;
    this.identity = { kind: "codex", name: "Codex", ...options };
  }
  identity;
  invoke(invocation) {
    return this.api.handle({ contractVersion: HOST_CONTRACT_VERSION, host: this.identity, invocation });
  }
};

// ../../packages/script-domain/src/errors.ts
var DomainError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "DomainError";
  }
};

// ../../packages/script-domain/src/hierarchy.ts
function invalid(message) {
  throw new DomainError("validation", message);
}
function assertPositive(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${field} must be a positive safe integer.`);
}
function assertContiguous(rows, field) {
  const positions = [...rows].map((row) => row.position).sort((left, right) => left - right);
  positions.forEach((position, index) => {
    assertPositive(position, `${field}.position`);
    if (position !== index + 1) invalid(`${field} positions must be contiguous and one-based.`);
  });
}
function deriveStoryOrder(seasons, episodes) {
  const result = /* @__PURE__ */ new Map();
  const orderedSeasons = [...seasons].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  let storyOrder = 1;
  for (const season of orderedSeasons) {
    const orderedEpisodes = episodes.filter((episode) => episode.seasonId === season.id).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    for (const episode of orderedEpisodes) result.set(episode.id, storyOrder++);
  }
  return result;
}
function assertProjectHierarchy(hierarchy2) {
  const { team, ip, project } = hierarchy2;
  if (ip.teamId !== team.id) invalid("IP must belong to the hierarchy Team.");
  if (project.teamId !== team.id || project.ipId !== ip.id) invalid("Project must belong to the hierarchy Team and IP.");
  if (hierarchy2.seasons.length === 0) invalid("Project must contain at least one Season.");
  assertContiguous(hierarchy2.seasons, "Season");
  const seasonIds = new Set(hierarchy2.seasons.map((season) => season.id));
  if (seasonIds.size !== hierarchy2.seasons.length) invalid("Season IDs must be unique.");
  for (const season of hierarchy2.seasons) if (season.projectId !== project.id) invalid("Season must belong to the hierarchy Project.");
  const episodeIds = new Set(hierarchy2.episodes.map((episode) => episode.id));
  if (episodeIds.size !== hierarchy2.episodes.length) invalid("Episode IDs must be unique.");
  for (const episode of hierarchy2.episodes) {
    if (episode.projectId !== project.id || !seasonIds.has(episode.seasonId)) invalid("Episode must belong to a Season in the hierarchy Project.");
  }
  for (const season of hierarchy2.seasons) assertContiguous(hierarchy2.episodes.filter((episode) => episode.seasonId === season.id), `Episode in Season ${season.id}`);
  if (project.medium === "episodic" && hierarchy2.seasons.some((season) => !hierarchy2.episodes.some((episode) => episode.seasonId === season.id))) {
    invalid("Every episodic Season must contain at least one Episode.");
  }
  const expectedStoryOrder = deriveStoryOrder(hierarchy2.seasons, hierarchy2.episodes);
  for (const episode of hierarchy2.episodes) {
    assertPositive(episode.storyOrder, "Episode.storyOrder");
    if (episode.storyOrder !== expectedStoryOrder.get(episode.id)) invalid("Episode storyOrder must follow Season and Episode positions.");
  }
  if (project.medium === "feature-film") {
    if (hierarchy2.seasons.length !== 1 || hierarchy2.seasons[0]?.system !== true) invalid("Feature film must have exactly one system Season.");
    if (hierarchy2.episodes.length !== 1 || hierarchy2.episodes[0]?.primary !== true) invalid("Feature film must have exactly one primary Episode.");
  }
  const sequenceIds = new Set(hierarchy2.sequences.map((sequence) => sequence.id));
  if (sequenceIds.size !== hierarchy2.sequences.length) invalid("Sequence IDs must be unique.");
  for (const sequence of hierarchy2.sequences) {
    if (sequence.projectId !== project.id || !episodeIds.has(sequence.episodeId)) invalid("Sequence must belong to an Episode in the hierarchy Project.");
  }
  for (const episode of hierarchy2.episodes) assertContiguous(hierarchy2.sequences.filter((sequence) => sequence.episodeId === episode.id), `Sequence in Episode ${episode.id}`);
  const sceneIds = new Set(hierarchy2.scenes.map((scene) => scene.id));
  if (sceneIds.size !== hierarchy2.scenes.length) invalid("Scene IDs must be unique.");
  for (const scene of hierarchy2.scenes) {
    if (scene.projectId !== project.id || !episodeIds.has(scene.episodeId)) invalid("Scene must belong to an Episode in the hierarchy Project.");
    if (scene.sequenceId !== null && !sequenceIds.has(scene.sequenceId)) invalid("Scene sequence must belong to the hierarchy.");
    const sequence = scene.sequenceId === null ? null : hierarchy2.sequences.find((candidate) => candidate.id === scene.sequenceId);
    if (sequence && sequence.episodeId !== scene.episodeId) invalid("Scene and Sequence must belong to the same Episode.");
  }
  for (const episode of hierarchy2.episodes) assertContiguous(hierarchy2.scenes.filter((scene) => scene.episodeId === episode.id), `Scene in Episode ${episode.id}`);
  const beatIds = new Set(hierarchy2.beats.map((beat) => beat.id));
  if (beatIds.size !== hierarchy2.beats.length) invalid("Beat IDs must be unique.");
  for (const beat of hierarchy2.beats) {
    const scene = hierarchy2.scenes.find((candidate) => candidate.id === beat.sceneId);
    if (beat.projectId !== project.id || !episodeIds.has(beat.episodeId) || !sceneIds.has(beat.sceneId)) invalid("Beat must belong to a Scene in the hierarchy Project.");
    if (scene?.episodeId !== beat.episodeId) invalid("Beat and Scene must belong to the same Episode.");
  }
  for (const scene of hierarchy2.scenes) assertContiguous(hierarchy2.beats.filter((beat) => beat.sceneId === scene.id), `Beat in Scene ${scene.id}`);
}
function createSeason(input) {
  if (input.project.revision !== input.expectedProjectRevision) throw new DomainError("revision-conflict", "Project revision changed before Season creation.");
  if (input.project.status !== "active") throw new DomainError("invalid-state", "Archived Project cannot create a Season.");
  if (input.project.medium !== "episodic") throw new DomainError("invalid-state", "Feature film cannot create another Season.");
  assertContiguous(input.existingSeasons, "Season");
  if (input.existingSeasons.some((season) => season.projectId !== input.project.id)) invalid("Every existing Season must belong to the Project.");
  if (input.existingSeasons.some((season) => season.id === input.seasonId)) invalid("Season ID already exists.");
  if (input.existingEpisodes.some((episode) => episode.id === input.firstEpisodeId)) invalid("Episode ID already exists.");
  const title = input.title.trim();
  if (!title) invalid("Season title is required.");
  const episodeTitle = input.firstEpisodeTitle.trim();
  if (!episodeTitle) invalid("First Episode title is required.");
  const seasonPosition = input.existingSeasons.length + 1;
  return {
    project: { ...input.project, revision: input.project.revision + 1 },
    season: {
      id: input.seasonId,
      projectId: input.project.id,
      title,
      position: seasonPosition,
      status: "active",
      revision: 1,
      system: false
    },
    episode: {
      id: input.firstEpisodeId,
      projectId: input.project.id,
      seasonId: input.seasonId,
      title: episodeTitle,
      position: 1,
      storyOrder: input.existingEpisodes.length + 1,
      status: "draft",
      revision: 1,
      primary: false,
      currentDraftVersionId: null,
      currentApprovedVersionId: null
    }
  };
}

// ../../packages/script-domain/src/authorization.ts
var ROLE_ACTIONS = {
  owner: ["read", "write", "approve", "promote-ip-canon", "approve-ip-promotion", "manage-ip-grants", "manage-members"],
  admin: ["read", "write", "approve", "promote-ip-canon", "approve-ip-promotion", "manage-ip-grants", "manage-members"],
  editor: ["read", "write", "approve", "promote-ip-canon"],
  writer: ["read", "write"],
  reviewer: ["read", "approve"],
  viewer: ["read"]
};
function isArchived(status) {
  return status === "archived";
}
function authorize(member, requiredTeamId, action, statuses, revision) {
  if (!member) return { allowed: false, reason: "not-a-member" };
  if (member.status !== "active") return { allowed: false, reason: "member-suspended" };
  if (member.teamId !== requiredTeamId) return { allowed: false, reason: "not-a-member" };
  if (action !== "read" && statuses.some(isArchived)) return { allowed: false, reason: "archived" };
  if (revision && revision.expected !== revision.actual) return { allowed: false, reason: "revision-conflict" };
  if (!ROLE_ACTIONS[member.role].includes(action)) return { allowed: false, reason: "role-denied" };
  return { allowed: true, reason: "allowed" };
}

// ../../packages/script-domain/src/ids.ts
function identifier(value, field) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(normalized)) {
    throw new DomainError("validation", `${field} must be a stable identifier.`);
  }
  return normalized;
}
var asTeamId = (value) => identifier(value, "teamId");
var asIpId = (value) => identifier(value, "ipId");
var asProjectId = (value) => identifier(value, "projectId");
var asSeasonId = (value) => identifier(value, "seasonId");
var asEpisodeId = (value) => identifier(value, "episodeId");
var asMemberId = (value) => identifier(value, "memberId");
var asIdempotencyKey = (value) => identifier(value, "idempotencyKey");
var asRequestHash = (value) => identifier(value, "requestHash");

// ../../packages/script-application/src/dev-host-api.ts
var DevHostApi = class {
  hierarchies = /* @__PURE__ */ new Map();
  members = /* @__PURE__ */ new Map();
  completed = /* @__PURE__ */ new Map();
  inProgress = /* @__PURE__ */ new Set();
  constructor(input) {
    for (const hierarchy2 of input.hierarchies) {
      assertProjectHierarchy(hierarchy2);
      this.hierarchies.set(`${hierarchy2.team.id}:${hierarchy2.project.id}`, structuredClone(hierarchy2));
    }
    for (const member of input.members) this.members.set(`${member.teamId}:${member.memberId}`, structuredClone(member));
  }
  async handle(request) {
    const requestId = request.invocation.requestId;
    try {
      if (request.contractVersion.split(".")[0] !== HOST_CONTRACT_VERSION.split(".")[0]) {
        throw new DomainError("validation", `Unsupported Host Contract ${request.contractVersion}.`);
      }
      const result = this.execute(request);
      return { requestId, contractVersion: HOST_CONTRACT_VERSION, ok: true, result };
    } catch (cause) {
      const error = cause instanceof DomainError ? cause : new DomainError("invalid-state", cause instanceof Error ? cause.message : String(cause));
      return {
        requestId,
        contractVersion: HOST_CONTRACT_VERSION,
        ok: false,
        error: { code: error.code, message: error.message, requestId, details: error.details }
      };
    }
  }
  execute(request) {
    const { invocation } = request;
    if (invocation.operation === "capabilities") {
      return { operation: "capabilities", capabilities: STAGE_2_CAPABILITIES, host: request.host };
    }
    const member = this.members.get(`${invocation.actor.teamId}:${invocation.actor.memberId}`);
    if (!member || member.status !== "active" || member.role !== invocation.actor.role) {
      throw new DomainError("forbidden", "Host actor is not an active Team member.", { permissionReason: "not-a-member" });
    }
    const key = `${invocation.actor.teamId}:${invocation.payload.projectId}`;
    const hierarchy2 = this.hierarchies.get(key);
    if (!hierarchy2) throw new DomainError("not-found", "Project hierarchy was not found.");
    if (invocation.operation === "get-project-hierarchy") {
      const decision2 = authorize(member, hierarchy2.team.id, "read", [hierarchy2.team.status, hierarchy2.ip.status, hierarchy2.project.status]);
      if (!decision2.allowed) throw new DomainError("forbidden", `Hierarchy read denied: ${decision2.reason}.`, { permissionReason: decision2.reason });
      return { operation: "get-project-hierarchy", hierarchy: structuredClone(hierarchy2) };
    }
    const decision = authorize(member, hierarchy2.team.id, "write", [hierarchy2.team.status, hierarchy2.ip.status, hierarchy2.project.status]);
    if (!decision.allowed) {
      const code = decision.reason === "archived" ? "invalid-state" : "forbidden";
      throw new DomainError(code, `Create Season denied: ${decision.reason}.`, { permissionReason: decision.reason });
    }
    return this.createSeason(hierarchy2, invocation.payload);
  }
  createSeason(hierarchy2, payload) {
    const scope = `${hierarchy2.team.id}:${hierarchy2.project.id}:create-season:${payload.idempotencyKey}`;
    const replay = this.completed.get(scope);
    if (replay) {
      if (replay.requestHash !== payload.requestHash) throw new DomainError("revision-conflict", "Idempotency key was already used with another request.");
      return structuredClone(replay.result);
    }
    if (this.inProgress.has(scope)) throw new DomainError("invalid-state", "Create Season is already in progress.");
    this.inProgress.add(scope);
    try {
      const created = createSeason({
        project: hierarchy2.project,
        existingSeasons: hierarchy2.seasons,
        existingEpisodes: hierarchy2.episodes,
        seasonId: payload.seasonId,
        title: payload.title,
        firstEpisodeId: payload.firstEpisodeId,
        firstEpisodeTitle: payload.firstEpisodeTitle,
        expectedProjectRevision: payload.expectedProjectRevision
      });
      const updated = {
        ...hierarchy2,
        project: created.project,
        seasons: [...hierarchy2.seasons, created.season],
        episodes: [...hierarchy2.episodes, created.episode]
      };
      assertProjectHierarchy(updated);
      this.hierarchies.set(`${hierarchy2.team.id}:${hierarchy2.project.id}`, updated);
      const result = { operation: "create-season", season: created.season, episode: created.episode, projectRevision: created.project.revision };
      this.completed.set(scope, { requestHash: payload.requestHash, result: structuredClone(result) });
      return result;
    } finally {
      this.inProgress.delete(scope);
    }
  }
};

// ../../packages/script-application/src/dev-host-fixture.ts
var STAGE_2_DEV_PROJECT_ID = asProjectId("project-1");
var STAGE_2_DEV_ACTOR = {
  teamId: asTeamId("team-1"),
  memberId: asMemberId("member-writer"),
  role: "writer"
};
function hierarchy() {
  const teamId = STAGE_2_DEV_ACTOR.teamId;
  const ipId = asIpId("ip-1");
  const seasonId = asSeasonId("season-1");
  const episodeId = asEpisodeId("episode-1");
  return {
    team: { id: teamId, name: "\u7B2C\u4E00\u5DE5\u4F5C\u5BA4", status: "active", revision: 1 },
    ip: { id: ipId, teamId, name: "\u6F6E\u6C50 IP", status: "active", revision: 1 },
    project: { id: STAGE_2_DEV_PROJECT_ID, teamId, ipId, title: "\u6F6E\u6C50\u5C3D\u5934", medium: "episodic", status: "active", revision: 1 },
    seasons: [{ id: seasonId, projectId: STAGE_2_DEV_PROJECT_ID, title: "\u7B2C\u4E00\u5B63", position: 1, status: "active", revision: 1, system: false }],
    episodes: [{ id: episodeId, projectId: STAGE_2_DEV_PROJECT_ID, seasonId, title: "\u7B2C\u4E00\u96C6", position: 1, storyOrder: 1, status: "draft", revision: 1, primary: false, currentDraftVersionId: null, currentApprovedVersionId: null }],
    sequences: [],
    scenes: [],
    beats: []
  };
}
function createStage2DevHostFixture() {
  const member = { ...STAGE_2_DEV_ACTOR, status: "active" };
  return {
    api: new DevHostApi({ hierarchies: [hierarchy()], members: [member] }),
    actor: STAGE_2_DEV_ACTOR,
    projectId: STAGE_2_DEV_PROJECT_ID
  };
}

// mcp/server.ts
var fixture = createStage2DevHostFixture();
var adapter = new CodexScriptStudioAdapter(fixture.api, {
  hostVersion: "0.150.1",
  hostInstanceId: "codex-mcp-stdio",
  adapterVersion: "0.1.0"
});
var TOOLS = [
  {
    name: "script_studio_capabilities",
    description: "Negotiate the Script Studio Host Contract capabilities for this Codex adapter.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "script_studio_get_project_hierarchy",
    description: "Read the Team, IP, Project, Season, and Episode hierarchy for a Script Studio project.",
    inputSchema: { type: "object", additionalProperties: false, required: ["projectId"], properties: { projectId: { type: "string", minLength: 1 } } }
  },
  {
    name: "script_studio_create_season",
    description: "Create one episodic Season and its first Episode using an expected Project revision and idempotency key.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projectId", "seasonId", "title", "firstEpisodeId", "firstEpisodeTitle", "expectedProjectRevision", "idempotencyKey", "requestHash"],
      properties: {
        projectId: { type: "string", minLength: 1 },
        seasonId: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        firstEpisodeId: { type: "string", minLength: 1 },
        firstEpisodeTitle: { type: "string", minLength: 1 },
        expectedProjectRevision: { type: "integer", minimum: 1 },
        idempotencyKey: { type: "string", minLength: 1 },
        requestHash: { type: "string", minLength: 1 }
      }
    }
  }
];
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be an object");
  return value;
}
function requiredString(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}
function expectedRevision(args) {
  const value = args.expectedProjectRevision;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("expectedProjectRevision must be a positive integer");
  return value;
}
function invocationFor(name, rawArgs, currentFixture) {
  const args = record(rawArgs);
  if (name === "script_studio_capabilities") return { requestId: `mcp-capabilities-${Date.now()}`, operation: "capabilities" };
  const projectId = requiredString(args, "projectId");
  if (name === "script_studio_get_project_hierarchy") {
    return {
      requestId: `mcp-hierarchy-${Date.now()}`,
      operation: "get-project-hierarchy",
      actor: currentFixture.actor,
      payload: { projectId: asProjectId(projectId) }
    };
  }
  if (name !== "script_studio_create_season") throw new Error(`Unknown Script Studio tool: ${name}`);
  return {
    requestId: `mcp-create-season-${Date.now()}`,
    operation: "create-season",
    actor: currentFixture.actor,
    payload: {
      projectId: asProjectId(projectId),
      seasonId: asSeasonId(requiredString(args, "seasonId")),
      title: requiredString(args, "title"),
      firstEpisodeId: asEpisodeId(requiredString(args, "firstEpisodeId")),
      firstEpisodeTitle: requiredString(args, "firstEpisodeTitle"),
      expectedProjectRevision: expectedRevision(args),
      idempotencyKey: asIdempotencyKey(requiredString(args, "idempotencyKey")),
      requestHash: asRequestHash(requiredString(args, "requestHash"))
    }
  };
}
async function invoke(name, args) {
  return adapter.invoke(invocationFor(name, args, fixture));
}
function textResult(response) {
  return response.ok ? { content: [{ type: "text", text: JSON.stringify(response.result) }] } : { content: [{ type: "text", text: JSON.stringify({ code: response.error.code, message: response.error.message, requestId: response.error.requestId }) }], isError: true };
}
async function handle(request) {
  if (request.method.startsWith("notifications/")) return null;
  if (request.id === void 0) return null;
  try {
    switch (request.method) {
      case "initialize":
        return { jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "script-studio", version: HOST_CONTRACT_VERSION } } };
      case "ping":
        return { jsonrpc: "2.0", id: request.id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id: request.id, result: { tools: TOOLS } };
      case "tools/call": {
        const params = request.params ?? {};
        const name = typeof params.name === "string" ? params.name : "";
        if (!TOOLS.some((tool) => tool.name === name)) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: `Unknown tool: ${name}` } };
        const response = await invoke(name, params.arguments ?? {});
        return { jsonrpc: "2.0", id: request.id, result: textResult(response) };
      }
      default:
        return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
  } catch (cause) {
    return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: cause instanceof Error ? cause.message : String(cause) } };
  }
}
function write(response) {
  process.stdout.write(`${JSON.stringify(response)}
`);
}
var buffer = "";
var queue = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    queue = queue.then(async () => {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }
      const response = await handle(request);
      if (response) write(response);
    });
  }
});
process.stdin.on("end", () => {
  void queue;
});
