// src/dsh-adapter/host.ts
import { randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import { CallId } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";

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

// src/dsh-adapter/routes.ts
var HOST_ROUTE = "/api/script-studio/v1/host";
var TOOL_SMOKE_ROUTE = "/api/script-studio/v1/tool-smoke";

// src/dsh-adapter/host.ts
var ScriptStudioHostService = class extends Service {
  fixture;
  identity = {
    kind: "dsh",
    name: "DeepSeek Harness",
    hostVersion: "0.1.0-rc.7",
    hostInstanceId: `dsh-${process.pid}`,
    adapterVersion: "0.1.0"
  };
  constructor(ctx) {
    super(ctx, "scriptStudioHost");
    this.fixture = createStage2DevHostFixture();
  }
  invoke(invocation) {
    return this.fixture.api.handle({ contractVersion: HOST_CONTRACT_VERSION, host: this.identity, invocation });
  }
};
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("validation", `${label} must be an object.`);
  return value;
}
function string(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new DomainError("validation", `${label} must be a non-empty string.`);
  return value;
}
function role(value) {
  const roles = ["owner", "admin", "editor", "writer", "reviewer", "viewer"];
  const candidate = string(value, "actor.role");
  if (!roles.includes(candidate)) throw new DomainError("validation", "actor.role is not supported.");
  return candidate;
}
function actor(value) {
  const input = object(value, "actor");
  return { teamId: asTeamId(string(input.teamId, "actor.teamId")), memberId: asMemberId(string(input.memberId, "actor.memberId")), role: role(input.role) };
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new DomainError("validation", `${label} must be a positive integer.`);
  return value;
}
function requestIdOf(value) {
  try {
    const input = object(value, "request");
    const invocation = object(input.invocation, "invocation");
    return typeof invocation.requestId === "string" && invocation.requestId.trim() ? invocation.requestId : "invalid-request";
  } catch {
    return "invalid-request";
  }
}
function parseHostRequest(value) {
  const input = object(value, "request");
  const contractVersion = string(input.contractVersion, "contractVersion");
  const hostInput = object(input.host, "host");
  if (hostInput.kind !== "dsh") throw new DomainError("validation", "DSH Host requires host.kind=dsh.");
  const host = {
    kind: "dsh",
    name: string(hostInput.name, "host.name"),
    hostVersion: string(hostInput.hostVersion, "host.hostVersion"),
    hostInstanceId: string(hostInput.hostInstanceId, "host.hostInstanceId"),
    adapterVersion: string(hostInput.adapterVersion, "host.adapterVersion")
  };
  const invocationInput = object(input.invocation, "invocation");
  const requestId = string(invocationInput.requestId, "invocation.requestId");
  const operation = string(invocationInput.operation, "invocation.operation");
  if (operation === "capabilities") return { contractVersion, host, invocation: { requestId, operation } };
  const invocationActor = actor(invocationInput.actor);
  const payload = object(invocationInput.payload, "invocation.payload");
  const projectId = asProjectId(string(payload.projectId, "payload.projectId"));
  if (operation === "get-project-hierarchy") {
    return { contractVersion, host, invocation: { requestId, operation, actor: invocationActor, payload: { projectId } } };
  }
  if (operation !== "create-season") throw new DomainError("validation", `Unsupported Host operation: ${operation}.`);
  return {
    contractVersion,
    host,
    invocation: {
      requestId,
      operation,
      actor: invocationActor,
      payload: {
        projectId,
        seasonId: asSeasonId(string(payload.seasonId, "payload.seasonId")),
        title: string(payload.title, "payload.title"),
        firstEpisodeId: asEpisodeId(string(payload.firstEpisodeId, "payload.firstEpisodeId")),
        firstEpisodeTitle: string(payload.firstEpisodeTitle, "payload.firstEpisodeTitle"),
        expectedProjectRevision: positiveInteger(payload.expectedProjectRevision, "payload.expectedProjectRevision"),
        idempotencyKey: asIdempotencyKey(string(payload.idempotencyKey, "payload.idempotencyKey")),
        requestHash: asRequestHash(string(payload.requestHash, "payload.requestHash"))
      }
    }
  };
}
function errorResponse(value, cause) {
  const error = cause instanceof DomainError ? cause : new DomainError("validation", cause instanceof Error ? cause.message : String(cause));
  return {
    requestId: requestIdOf(value),
    contractVersion: HOST_CONTRACT_VERSION,
    ok: false,
    error: { code: error.code, message: error.message, requestId: requestIdOf(value), details: error.details }
  };
}
function sendJson(res, status, body) {
  const encoded = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(encoded));
  res.end(encoded);
}
function statusFor(response) {
  if (response.ok) return 200;
  return { validation: 400, forbidden: 403, "not-found": 404, "invalid-state": 409, "revision-conflict": 409 }[response.error.code];
}
function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    const onData = (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        cleanup();
        reject(new DomainError("validation", "Host request body is too large."));
        req.destroy();
        return;
      }
      body += chunk.toString();
    };
    const onEnd = () => {
      cleanup();
      resolve(body);
    };
    const onError = (cause) => {
      cleanup();
      reject(cause);
    };
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}
function registerHostRoute(ctx, service) {
  return ctx.webServer.register({
    kind: "exact",
    path: HOST_ROUTE,
    async handler(req, res) {
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        sendJson(res, 405, { ok: false, error: { code: "validation", message: "Only POST is supported.", requestId: "method-not-allowed" } });
        return;
      }
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch (cause) {
        const response = errorResponse(void 0, cause);
        sendJson(res, statusFor(response), response);
        return;
      }
      try {
        const response = await service.fixture.api.handle(parseHostRequest(input));
        sendJson(res, statusFor(response), response);
      } catch (cause) {
        const response = errorResponse(input, cause);
        sendJson(res, statusFor(response), response);
      }
    }
  });
}
function registerToolSmokeRoute(ctx) {
  return ctx.webServer.register({
    kind: "exact",
    path: TOOL_SMOKE_ROUTE,
    async handler(req, res) {
      if (req.method !== "GET") {
        res.setHeader("allow", "GET");
        sendJson(res, 405, { ok: false, error: { code: "validation", message: "Only GET is supported.", requestId: "method-not-allowed" } });
        return;
      }
      const controller = new AbortController();
      req.once("aborted", () => {
        controller.abort();
      });
      const result = await ctx.tools.execute({
        callId: CallId(`script-studio-smoke-${Date.now()}`),
        name: "script_studio_capabilities",
        arguments: {},
        signal: controller.signal
      });
      if (result.isError) {
        sendJson(res, 500, { ok: false, error: result.error.message });
        return;
      }
      sendJson(res, 200, { ok: true, toolName: "script_studio_capabilities", value: result.value });
    }
  });
}
function textResponse(response) {
  return JSON.stringify(response);
}
function requestFor(service, invocation) {
  return service.invoke(invocation);
}
function registerTools(ctx, service) {
  const disposers = [
    ctx.tools.register(defineTool({
      name: "script_studio_capabilities",
      description: "Negotiate the Script Studio Host Contract v1 capabilities for this DeepSeek Harness host.",
      parameters: {},
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute() {
        return textResponse(await requestFor(service, { requestId: `dsh-capabilities-${randomUUID()}`, operation: "capabilities" }));
      }
    })),
    ctx.tools.register(defineTool({
      name: "script_studio_get_project_hierarchy",
      description: "Read the Team/IP/Project/Season/Episode hierarchy for a local Script Studio project.",
      parameters: { projectId: { type: "string", required: true } },
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      isConcurrencySafe: () => true,
      async execute(args) {
        const projectId = asProjectId(string(args.projectId, "projectId"));
        return textResponse(await requestFor(service, { requestId: `dsh-hierarchy-${randomUUID()}`, operation: "get-project-hierarchy", actor: STAGE_2_DEV_ACTOR, payload: { projectId } }));
      }
    })),
    ctx.tools.register(defineTool({
      name: "script_studio_create_season",
      description: "Create one episodic Season and its first Episode using an expected Project revision and idempotency key.",
      parameters: {
        projectId: { type: "string", required: true },
        seasonId: { type: "string", required: true },
        title: { type: "string", required: true },
        firstEpisodeId: { type: "string", required: true },
        firstEpisodeTitle: { type: "string", required: true },
        expectedProjectRevision: { type: "integer", required: true },
        idempotencyKey: { type: "string", required: true },
        requestHash: { type: "string", required: true }
      },
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute(args) {
        const input = args;
        return textResponse(await requestFor(service, {
          requestId: `dsh-create-season-${randomUUID()}`,
          operation: "create-season",
          actor: STAGE_2_DEV_ACTOR,
          payload: {
            projectId: asProjectId(string(input.projectId, "projectId")),
            seasonId: asSeasonId(string(input.seasonId, "seasonId")),
            title: string(input.title, "title"),
            firstEpisodeId: asEpisodeId(string(input.firstEpisodeId, "firstEpisodeId")),
            firstEpisodeTitle: string(input.firstEpisodeTitle, "firstEpisodeTitle"),
            expectedProjectRevision: positiveInteger(input.expectedProjectRevision, "expectedProjectRevision"),
            idempotencyKey: asIdempotencyKey(string(input.idempotencyKey, "idempotencyKey")),
            requestHash: asRequestHash(string(input.requestHash, "requestHash"))
          }
        }));
      }
    }))
  ];
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
var name = "script-studio-host";
var inject = ["tools", "webServer"];
function apply(ctx) {
  ctx.plugin(ScriptStudioHostService);
  ctx.inject(["scriptStudioHost"], (readyCtx) => {
    readyCtx.effect(() => registerHostRoute(readyCtx, readyCtx.scriptStudioHost), "script-studio: host HTTP route");
    readyCtx.effect(() => registerToolSmokeRoute(readyCtx), "script-studio: tool smoke route");
    readyCtx.effect(() => registerTools(readyCtx, readyCtx.scriptStudioHost), "script-studio: Host Contract tools");
  });
}

// src/adapter.ts
var DshScriptStudioAdapter = class {
  constructor(api, options) {
    this.api = api;
    this.identity = { kind: "dsh", name: "DeepSeek Harness", ...options };
  }
  identity;
  invoke(invocation) {
    return this.api.handle({ contractVersion: HOST_CONTRACT_VERSION, host: this.identity, invocation });
  }
};
export {
  DshScriptStudioAdapter,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
