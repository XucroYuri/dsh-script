import { HOST_CONTRACT_VERSION, type HostAdapterPort, type HostIdentity, type HostInvocation, type HostResponseEnvelope, type ScriptStudioHostApiPort } from '@script-studio/contracts/host'

export interface CodexAdapterOptions {
  hostVersion: string
  hostInstanceId: string
  adapterVersion: string
}

export class CodexScriptStudioAdapter implements HostAdapterPort {
  readonly identity: HostIdentity

  constructor(private readonly api: ScriptStudioHostApiPort, options: CodexAdapterOptions) {
    this.identity = { kind: 'codex', name: 'Codex', ...options }
  }

  invoke(invocation: HostInvocation): Promise<HostResponseEnvelope> {
    return this.api.handle({ contractVersion: HOST_CONTRACT_VERSION, host: this.identity, invocation })
  }
}
