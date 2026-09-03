import { HOST_CONTRACT_VERSION } from '@script-studio/contracts/host';
export class CodexScriptStudioAdapter {
    api;
    identity;
    constructor(api, options) {
        this.api = api;
        this.identity = { kind: 'codex', name: 'Codex', ...options };
    }
    invoke(invocation) {
        return this.api.handle({ contractVersion: HOST_CONTRACT_VERSION, host: this.identity, invocation });
    }
}
