window.__ModuleLoader__.load({id:"@script-studio/dsh-adapter",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");

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

// src/dsh-adapter/dev-fixture.ts
var DEV_HOST = Object.freeze({
  kind: "dsh",
  name: "DeepSeek Harness",
  hostVersion: "0.1.0-rc.7",
  hostInstanceId: "dsh-client",
  adapterVersion: "0.1.0"
});
var DEV_ACTOR = Object.freeze({ teamId: "team-1", memberId: "member-writer", role: "writer" });
var DEV_PROJECT_ID = "project-1";

// src/dsh-adapter/locale.ts
var zhCN = {
  entry: "\u5267\u672C\u5DE5\u4F5C\u5BA4 \xB7 \u5F00\u53D1\u9A8C\u8BC1",
  title: "\u5267\u672C\u5DE5\u4F5C\u5BA4",
  description: "Stage 2 / \u672C\u5730\u5F00\u53D1 fixture",
  close: "\u5173\u95ED\u5267\u672C\u5DE5\u4F5C\u5BA4",
  loading: "\u6B63\u5728\u534F\u5546\u80FD\u529B\u5E76\u8BFB\u53D6\u9879\u76EE\u5C42\u7EA7\u2026",
  ready: "\u5F00\u53D1\u9762\u677F\u5DF2\u5C31\u7EEA",
  retry: "\u91CD\u65B0\u52A0\u8F7D",
  error: "\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u540E\u91CD\u8BD5\u3002",
  unavailable: "\u670D\u52A1\u7AEF\u672A\u5F00\u653E\u6B64\u80FD\u529B\u3002",
  enabled: "\u53EF\u7528",
  disabled: "\u4E0D\u53EF\u7528",
  unknown: "\u5F85\u534F\u5546",
  footer: "\u4EC5\u7528\u4E8E Stage 2 \u672C\u5730\u7EC4\u5408\u9A8C\u8BC1\uFF1B\u5F53\u524D\u4E0D\u58F0\u660E\u4E91\u7AEF\u6743\u9650\u3001Canon \u63A8\u8FDB\u6216\u751F\u4EA7\u6570\u636E\u80FD\u529B\u3002",
  createHeading: "\u521B\u5EFA\u4E0B\u4E00\u5B63\uFF08\u672C\u5730\u5F00\u53D1 API\uFF09",
  seasonTitle: "Season \u6807\u9898",
  episodeTitle: "\u7B2C\u4E00\u96C6\u6807\u9898",
  firstEpisode: "\u7B2C\u4E00\u96C6",
  create: "\u521B\u5EFA Season \u4E0E\u7B2C\u4E00\u96C6",
  busy: "\u6B63\u5728\u521B\u5EFA\u2026",
  noEpisodes: "\u6682\u65E0 Episode",
  episodic: "\u5267\u96C6",
  film: "\u7535\u5F71",
  revision: "\u4FEE\u8BA2",
  season: (position) => `\u7B2C${position}\u5B63`,
  seasonLabel: (position, title) => `S${position} \xB7 ${title}`,
  episodeLabel: (position, title) => `E${position} \xB7 ${title}`,
  capabilities: {
    hierarchyRead: "\u5C42\u7EA7\u8BFB\u53D6",
    commandCreateSeason: "\u521B\u5EFA Season",
    authSession: "\u8BA4\u8BC1\u4F1A\u8BDD",
    eventStream: "\u5B9E\u65F6\u4E8B\u4EF6\u6D41",
    hostModelGateway: "\u5BBF\u4E3B\u6A21\u578B",
    interactiveAppSurface: "\u4EA4\u4E92\u5E94\u7528",
    telemetry: "\u9065\u6D4B"
  }
};

// src/dsh-adapter/routes.ts
var HOST_ROUTE = "/api/script-studio/v1/host";

// src/client.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function SidebarEntry({ wide, openStudio }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      "aria-label": zhCN.entry,
      title: zhCN.entry,
      onClick: (event) => openStudio(event.currentTarget),
      style: {
        width: "100%",
        minHeight: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: wide ? "flex-start" : "center",
        gap: 8,
        padding: wide ? "8px 10px" : 8,
        border: 0,
        borderRadius: 6,
        background: "transparent",
        color: "var(--dsw-alias-label-primary, #24262b)",
        cursor: "pointer",
        font: "inherit",
        fontSize: 12
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", style: { fontSize: 16, lineHeight: 1 }, children: "\u25A4" }),
        wide && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: zhCN.entry })
      ]
    }
  );
}
function requestEnvelope(invocation) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ contractVersion: HOST_CONTRACT_VERSION, host: DEV_HOST, invocation })
  };
}
async function invoke(invocation) {
  const response = await fetch(HOST_ROUTE, requestEnvelope(invocation));
  const body = await response.json();
  if (body.contractVersion?.split(".")[0] !== HOST_CONTRACT_VERSION.split(".")[0]) throw new Error("Unsupported contract version.");
  if (!response.ok && body.ok) throw new Error(`Host request failed with HTTP ${response.status}.`);
  return body;
}
function responseError(response) {
  if (response.ok) throw new Error("Expected a failed Host response.");
  throw new Error(`${response.error.code}: ${response.error.message}`);
}
function hierarchyFrom(response) {
  if (!response.ok) return responseError(response);
  if (response.result.operation !== "get-project-hierarchy") throw new Error("Host returned an unexpected operation.");
  return response.result.hierarchy;
}
function CapabilityBadge({ label, enabled }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 5, color: enabled ? "#236b45" : "#73777f", fontSize: 11 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", style: { width: 7, height: 7, borderRadius: 99, background: enabled ? "#46a56f" : "#b6bbc3" } }),
    label,
    " \xB7 ",
    enabled === void 0 ? zhCN.unknown : enabled ? zhCN.enabled : zhCN.disabled
  ] });
}
function StudioOverlay({ closeStudio }) {
  const [hierarchy, setHierarchy] = (0, import_react.useState)(null);
  const [title, setTitle] = (0, import_react.useState)(zhCN.season(2));
  const [episodeTitle, setEpisodeTitle] = (0, import_react.useState)(zhCN.firstEpisode);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [capabilities, setCapabilities] = (0, import_react.useState)(null);
  const requestGeneration = (0, import_react.useRef)(0);
  const pendingWrite = (0, import_react.useRef)(false);
  const mounted = (0, import_react.useRef)(false);
  const titleId = (0, import_react.useId)();
  const descriptionId = (0, import_react.useId)();
  const [error, setError] = (0, import_react.useState)(null);
  const loadHierarchy = async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    setHierarchy(null);
    setCapabilities(null);
    try {
      const negotiated = await invoke({ requestId: `dsh-ui-capabilities-${Date.now()}`, operation: "capabilities" });
      if (!negotiated.ok) return responseError(negotiated);
      if (negotiated.result.operation !== "capabilities") throw new Error("Unexpected operation.");
      const received = negotiated.result.capabilities;
      if (!received || typeof received !== "object") throw new Error("Invalid capabilities.");
      const available = Object.fromEntries(Object.keys(zhCN.capabilities).map((key) => [key, received[key] === true]));
      let loaded = null;
      if (available.hierarchyRead === true) {
        loaded = hierarchyFrom(await invoke({ requestId: `dsh-ui-read-${Date.now()}`, operation: "get-project-hierarchy", actor: DEV_ACTOR, payload: { projectId: DEV_PROJECT_ID } }));
      }
      if (generation !== requestGeneration.current) return;
      setCapabilities(available);
      setHierarchy(loaded);
    } catch {
      if (generation === requestGeneration.current) setError(zhCN.error);
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  };
  (0, import_react.useEffect)(() => {
    mounted.current = true;
    void loadHierarchy();
    return () => {
      mounted.current = false;
      requestGeneration.current++;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeStudio();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [closeStudio]);
  const createSeason = async () => {
    if (pendingWrite.current || loading || error || capabilities?.commandCreateSeason !== true || !hierarchy || !title.trim() || !episodeTitle.trim()) return;
    pendingWrite.current = true;
    setBusy(true);
    try {
      const key = `dsh-ui-season-${hierarchy.seasons.length + 1}`;
      const response = await invoke({
        requestId: `dsh-ui-create-${Date.now()}`,
        operation: "create-season",
        actor: DEV_ACTOR,
        payload: {
          projectId: DEV_PROJECT_ID,
          seasonId: `season-${hierarchy.seasons.length + 1}`,
          title,
          firstEpisodeId: `episode-${hierarchy.episodes.length + 1}`,
          firstEpisodeTitle: episodeTitle,
          expectedProjectRevision: hierarchy.project.revision,
          idempotencyKey: key,
          requestHash: key
        }
      });
      if (!response.ok) return responseError(response);
      if (!mounted.current) return;
      if (response.result.operation !== "create-season") throw new Error("Unexpected operation.");
      await loadHierarchy();
      setTitle(zhCN.season(hierarchy.seasons.length + 2));
      setEpisodeTitle(zhCN.firstEpisode);
    } catch {
      if (mounted.current) setError(zhCN.error);
    } finally {
      pendingWrite.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { position: "fixed", inset: 0, zIndex: 100, pointerEvents: "none" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { role: "dialog", "aria-labelledby": titleId, "aria-describedby": descriptionId, "aria-busy": loading || busy, style: { position: "absolute", insetBlock: 0, right: 0, boxSizing: "border-box", width: "min(440px, 100%)", overflow: "auto", overflowWrap: "anywhere", pointerEvents: "auto", background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, #24262b)", boxShadow: "-4px 0 24px rgba(0, 0, 0, .14)" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 22px 14px", borderBottom: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { id: titleId, style: { margin: 0, fontSize: 18 }, children: zhCN.title }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { id: descriptionId, style: { margin: "6px 0 0", color: "var(--dsw-alias-label-secondary, #73777f)", fontSize: 12 }, children: zhCN.description })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "aria-label": zhCN.close, onClick: closeStudio, style: { border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 22, lineHeight: 1 }, children: "\xD7" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { style: { display: "flex", flexWrap: "wrap", gap: 12, padding: "12px 22px", background: "var(--dsw-alias-bg-layer-1, #f7f8fa)" }, children: Object.keys(zhCN.capabilities).map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityBadge, { label: zhCN.capabilities[key], enabled: capabilities?.[key] }, key)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: { padding: 22 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: busy ? zhCN.busy : loading ? zhCN.loading : error ? null : zhCN.ready }),
      !loading && !error && capabilities?.hierarchyRead !== true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: zhCN.unavailable }),
      error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", style: { marginBottom: 14, padding: 10, borderRadius: 7, background: "#fff2f0", color: "#a2382d", fontSize: 12 }, children: [
        error,
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: loading || busy, onClick: () => {
          void loadHierarchy();
        }, children: zhCN.retry })
      ] }),
      hierarchy && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 5, marginBottom: 20, fontSize: 13 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: hierarchy.project.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "var(--dsw-alias-label-secondary, #73777f)", fontSize: 12 }, children: [
            hierarchy.team.name,
            " / ",
            hierarchy.ip.name,
            " \xB7 ",
            hierarchy.project.medium === "episodic" ? zhCN.episodic : zhCN.film,
            " \xB7 ",
            zhCN.revision,
            " ",
            hierarchy.project.revision
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "grid", gap: 9 }, children: hierarchy.seasons.map((season) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 12, border: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)", borderRadius: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { fontSize: 13 }, children: zhCN.seasonLabel(season.position, season.title) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 6, color: "var(--dsw-alias-label-secondary, #73777f)", fontSize: 12 }, children: hierarchy.episodes.filter((episode) => episode.seasonId === season.id).map((episode) => zhCN.episodeLabel(episode.position, episode.title)).join("\uFF1B") || zhCN.noEpisodes })
        ] }, season.id)) }),
        capabilities?.commandCreateSeason === true ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: (event) => {
          event.preventDefault();
          void createSeason();
        }, style: { display: "grid", gap: 9, marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { fontSize: 13 }, children: zhCN.createHeading }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "grid", gap: 5, fontSize: 11 }, children: [
            zhCN.seasonTitle,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: busy || loading, value: title, onChange: (event) => setTitle(event.target.value), style: { minHeight: 32, padding: "0 8px", border: "1px solid #d8dce2", borderRadius: 6, font: "inherit" } })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "grid", gap: 5, fontSize: 11 }, children: [
            zhCN.episodeTitle,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: busy || loading, value: episodeTitle, onChange: (event) => setEpisodeTitle(event.target.value), style: { minHeight: 32, padding: "0 8px", border: "1px solid #d8dce2", borderRadius: 6, font: "inherit" } })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", disabled: busy || loading || !!error || !title.trim() || !episodeTitle.trim(), style: { justifySelf: "start", minHeight: 34, padding: "0 13px", border: 0, borderRadius: 6, background: "#356dcc", color: "#fff", cursor: busy ? "wait" : "pointer", font: "inherit", fontSize: 12 }, children: busy ? zhCN.busy : zhCN.create })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
          zhCN.capabilities.commandCreateSeason,
          "\uFF1A",
          zhCN.unavailable
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", { style: { padding: "12px 22px 16px", borderTop: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)", color: "var(--dsw-alias-label-tertiary, #969ba4)", fontSize: 11 }, children: zhCN.footer })
  ] }) });
}
var inject = ["slots"];
function apply(ctx) {
  let trigger;
  const state = { open: false };
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const openStudio = (button) => {
    trigger = button;
    state.open = true;
    notify();
  };
  const closeStudio = () => {
    state.open = false;
    notify();
    if (trigger?.isConnected) trigger.focus();
  };
  function Gate(props) {
    const [, render] = (0, import_react.useState)(0);
    (0, import_react.useEffect)(() => {
      const listener = () => {
        render((value) => value + 1);
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);
    return state.open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StudioOverlay, { ...props, closeStudio }) : null;
  }
  ctx.effect(() => ctx.slots.register({ name: "sidebar.footer.action", id: "script-studio", order: -20, inject: () => ({ openStudio }) }, SidebarEntry), "script-studio: sidebar entry");
  ctx.effect(() => ctx.slots.register({ name: "shell.overlay", id: "script-studio", order: 20, inject: () => ({}) }, Gate), "script-studio: workspace overlay");
}
return module.exports;}});
//# sourceMappingURL=client.js.map
