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

// src/dsh-adapter/routes.ts
var HOST_ROUTE = "/api/script-studio/v1/host";

// src/client.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var HOST = {
  kind: "dsh",
  name: "DeepSeek Harness",
  hostVersion: "0.1.0-rc.7",
  hostInstanceId: "dsh-client",
  adapterVersion: "0.1.0"
};
var ACTOR = { teamId: "team-1", memberId: "member-writer", role: "writer" };
var PROJECT_ID = "project-1";
function SidebarEntry({ wide, openStudio }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      "aria-label": "\u6253\u5F00\u5267\u672C\u5DE5\u4F5C\u5BA4",
      title: "\u5267\u672C\u5DE5\u4F5C\u5BA4",
      onClick: openStudio,
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
        wide && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5267\u672C\u5DE5\u4F5C\u5BA4" })
      ]
    }
  );
}
function requestEnvelope(invocation) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ contractVersion: HOST_CONTRACT_VERSION, host: HOST, invocation })
  };
}
async function invoke(invocation) {
  const response = await fetch(HOST_ROUTE, requestEnvelope(invocation));
  const body = await response.json();
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
    label
  ] });
}
function StudioOverlay({ closeStudio }) {
  const [hierarchy, setHierarchy] = (0, import_react.useState)(null);
  const [title, setTitle] = (0, import_react.useState)("\u7B2C\u4E8C\u5B63");
  const [episodeTitle, setEpisodeTitle] = (0, import_react.useState)("\u7B2C\u4E00\u96C6");
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const loadHierarchy = async () => {
    setLoading(true);
    try {
      const response = await invoke({ requestId: `dsh-ui-read-${Date.now()}`, operation: "get-project-hierarchy", actor: ACTOR, payload: { projectId: PROJECT_ID } });
      setHierarchy(hierarchyFrom(response));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };
  (0, import_react.useEffect)(() => {
    void loadHierarchy();
  }, []);
  const createSeason = async () => {
    if (!hierarchy || !title.trim() || !episodeTitle.trim()) return;
    setBusy(true);
    try {
      const key = `dsh-ui-season-${hierarchy.seasons.length + 1}`;
      const response = await invoke({
        requestId: `dsh-ui-create-${Date.now()}`,
        operation: "create-season",
        actor: ACTOR,
        payload: {
          projectId: PROJECT_ID,
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
      await loadHierarchy();
      setTitle(`\u7B2C${hierarchy.seasons.length + 2}\u5B63`);
      setEpisodeTitle("\u7B2C\u4E00\u96C6");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "dialog", "aria-modal": "true", "aria-label": "\u5267\u672C\u5DE5\u4F5C\u5BA4", style: { position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 20, background: "rgba(15, 18, 24, .42)" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", { style: { boxSizing: "border-box", width: "min(680px, 100%)", maxHeight: "min(760px, 100%)", overflow: "auto", borderRadius: 12, background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, #24262b)", boxShadow: "0 18px 70px rgba(0, 0, 0, .22)" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 22px 14px", borderBottom: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { style: { margin: 0, fontSize: 18 }, children: "\u5267\u672C\u5DE5\u4F5C\u5BA4" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: "6px 0 0", color: "var(--dsw-alias-label-secondary, #73777f)", fontSize: 12 }, children: "Stage 2 \u672C\u5730\u5F00\u53D1\u5BBF\u4E3B\u7EC4\u5408\u9762\u677F" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "aria-label": "\u5173\u95ED\u5267\u672C\u5DE5\u4F5C\u5BA4", onClick: closeStudio, style: { border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 22, lineHeight: 1 }, children: "\xD7" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: { display: "flex", flexWrap: "wrap", gap: 12, padding: "12px 22px", background: "var(--dsw-alias-bg-layer-1, #f7f8fa)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityBadge, { label: "\u5C42\u7EA7\u8BFB\u53D6", enabled: true }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityBadge, { label: "\u521B\u5EFA Season", enabled: true }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityBadge, { label: "\u4E91\u7AEF\u534F\u4F5C", enabled: false }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityBadge, { label: "\u5B9E\u65F6\u4E8B\u4EF6\u6D41", enabled: false })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: { padding: 22 }, children: [
      loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { "aria-live": "polite", children: "\u6B63\u5728\u8BFB\u53D6\u9879\u76EE\u5C42\u7EA7\u2026" }),
      error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "alert", style: { marginBottom: 14, padding: 10, borderRadius: 7, background: "#fff2f0", color: "#a2382d", fontSize: 12 }, children: error }),
      hierarchy && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 5, marginBottom: 20, fontSize: 13 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: hierarchy.project.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "var(--dsw-alias-label-secondary, #73777f)", fontSize: 12 }, children: [
            hierarchy.team.name,
            " / ",
            hierarchy.ip.name,
            " \xB7 ",
            hierarchy.project.medium === "episodic" ? "\u5267\u96C6" : "\u7535\u5F71",
            " \xB7 revision ",
            hierarchy.project.revision
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "grid", gap: 9 }, children: hierarchy.seasons.map((season) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 12, border: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)", borderRadius: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { style: { fontSize: 13 }, children: [
            "S",
            season.position,
            " \xB7 ",
            season.title
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 6, color: "var(--dsw-alias-label-secondary, #73777f)", fontSize: 12 }, children: hierarchy.episodes.filter((episode) => episode.seasonId === season.id).map((episode) => `E${episode.position} \xB7 ${episode.title}`).join("\uFF1B") || "\u6682\u65E0 Episode" })
        ] }, season.id)) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: (event) => {
          event.preventDefault();
          void createSeason();
        }, style: { display: "grid", gap: 9, marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { fontSize: 13 }, children: "\u521B\u5EFA\u4E0B\u4E00\u5B63\uFF08\u672C\u5730\u5F00\u53D1 API\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "grid", gap: 5, fontSize: 11 }, children: [
            "Season \u6807\u9898",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: title, onChange: (event) => setTitle(event.target.value), style: { minHeight: 32, padding: "0 8px", border: "1px solid #d8dce2", borderRadius: 6, font: "inherit" } })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "grid", gap: 5, fontSize: 11 }, children: [
            "\u7B2C\u4E00\u96C6\u6807\u9898",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: episodeTitle, onChange: (event) => setEpisodeTitle(event.target.value), style: { minHeight: 32, padding: "0 8px", border: "1px solid #d8dce2", borderRadius: 6, font: "inherit" } })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", disabled: busy || loading, style: { justifySelf: "start", minHeight: 34, padding: "0 13px", border: 0, borderRadius: 6, background: "#356dcc", color: "#fff", cursor: busy ? "wait" : "pointer", font: "inherit", fontSize: 12 }, children: busy ? "\u6B63\u5728\u521B\u5EFA\u2026" : "\u521B\u5EFA Season \u4E0E\u7B2C\u4E00\u96C6" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", { style: { padding: "12px 22px 16px", borderTop: "1px solid var(--dsw-alias-border-secondary, #e4e7eb)", color: "var(--dsw-alias-label-tertiary, #969ba4)", fontSize: 11 }, children: "\u4EC5\u7528\u4E8E Stage 2 \u672C\u5730\u7EC4\u5408\u9A8C\u8BC1\uFF1B\u5F53\u524D\u4E0D\u58F0\u660E\u4E91\u7AEF\u6743\u9650\u3001Canon \u63A8\u8FDB\u6216\u751F\u4EA7\u6570\u636E\u80FD\u529B\u3002" })
  ] }) });
}
var inject = ["slots"];
function apply(ctx) {
  let openStudio;
  let closeStudio;
  ctx.effect(() => ctx.slots.register({ name: "sidebar.footer.action", id: "script-studio", order: -20, inject: () => ({ openStudio: () => {
    openStudio?.();
  } }) }, SidebarEntry), "script-studio: sidebar entry");
  ctx.effect(() => ctx.slots.register({
    name: "shell.overlay",
    id: "script-studio",
    order: 20,
    inject: () => {
      const state = { open: false };
      const listeners = /* @__PURE__ */ new Set();
      const notify = () => {
        for (const listener of listeners) listener();
      };
      openStudio = () => {
        state.open = true;
        notify();
      };
      closeStudio = () => {
        state.open = false;
        notify();
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
        return state.open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StudioOverlay, { ...props, closeStudio: () => {
          closeStudio?.();
        } }) : null;
      }
      return { Gate };
    }
  }, ({ Gate, ...props }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Gate, { ...props })), "script-studio: workspace overlay");
}
return module.exports;}});
//# sourceMappingURL=client.js.map
