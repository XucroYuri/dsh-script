import { type HostAdapterPort, type HostIdentity, type HostInvocation, type HostResponseEnvelope, type ScriptStudioHostApiPort } from '@script-studio/contracts/host';
export interface CodexAdapterOptions {
    hostVersion: string;
    hostInstanceId: string;
    adapterVersion: string;
}
export declare class CodexScriptStudioAdapter implements HostAdapterPort {
    private readonly api;
    readonly identity: HostIdentity;
    constructor(api: ScriptStudioHostApiPort, options: CodexAdapterOptions);
    invoke(invocation: HostInvocation): Promise<HostResponseEnvelope>;
}
//# sourceMappingURL=index.d.ts.map