import type { HostAdapterPort, HostIdentity, HostInvocation, HostResponseEnvelope, ScriptStudioHostApiPort } from '@script-studio/contracts/host'
export interface DshAdapterOptions { hostVersion: string; hostInstanceId: string; adapterVersion: string }
export declare class DshScriptStudioAdapter implements HostAdapterPort {
  readonly identity: HostIdentity
  constructor(api: ScriptStudioHostApiPort, options: DshAdapterOptions)
  invoke(invocation: HostInvocation): Promise<HostResponseEnvelope>
}
