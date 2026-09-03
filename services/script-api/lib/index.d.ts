import type { AccessTokenVerifierPort, ApiError, CloudHierarchyRepositoryPort, GetProjectHierarchyResponse, ScriptStudioApiRequest, ScriptStudioApiResponse } from '@script-studio/contracts';
export declare const SCRIPT_STUDIO_API_VERSION: "1.0.0";
export declare const PROJECT_HIERARCHY_ROUTE = "/api/script-studio/v1/projects/:projectId/hierarchy";
interface ErrorBody {
    ok: false;
    contractVersion: typeof SCRIPT_STUDIO_API_VERSION;
    error: ApiError;
}
interface SuccessBody {
    ok: true;
    contractVersion: typeof SCRIPT_STUDIO_API_VERSION;
    result: GetProjectHierarchyResponse;
}
export type ScriptStudioApiResult = ScriptStudioApiResponse<SuccessBody | ErrorBody>;
export declare class ScriptStudioApi {
    private readonly sessions;
    private readonly hierarchy;
    constructor(sessions: AccessTokenVerifierPort, hierarchy: CloudHierarchyRepositoryPort);
    handle(request: ScriptStudioApiRequest): Promise<ScriptStudioApiResult>;
}
export {};
//# sourceMappingURL=index.d.ts.map