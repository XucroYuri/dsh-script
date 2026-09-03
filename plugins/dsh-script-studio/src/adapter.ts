import { HOST_CONTRACT_VERSION, type HostAdapterPort, type HostIdentity, type HostInvocation, type HostResponseEnvelope, type ScriptStudioHostApiPort } from '@script-studio/contracts/host'

export interface DshAdapterOptions {
  hostVersion: string
  hostInstanceId: string
  adapterVersion: string
}

export class DshScriptStudioAdapter implements HostAdapterPort {
  readonly identity: HostIdentity

  constructor(private readonly api: ScriptStudioHostApiPort, options: DshAdapterOptions) {
    this.identity = { kind: 'dsh', name: 'DeepSeek Harness', ...options }
  }

  invoke(invocation: HostInvocation): Promise<HostResponseEnvelope> {
    return this.api.handle({ contractVersion: HOST_CONTRACT_VERSION, host: this.identity, invocation })
  }
}
