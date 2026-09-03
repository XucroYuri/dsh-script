import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ScriptStudioApiPort } from './index.js';
export type ScriptStudioHttpHandler = (request: IncomingMessage, response: ServerResponse) => void;
export declare function createScriptStudioHttpHandler(api: ScriptStudioApiPort): ScriptStudioHttpHandler;
//# sourceMappingURL=http.d.ts.map