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
  DshScriptStudioAdapter
};
//# sourceMappingURL=adapter.js.map
