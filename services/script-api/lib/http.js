import { randomUUID } from 'node:crypto';
import { SCRIPT_STUDIO_API_VERSION } from './index.js';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function requestId(request) {
    const value = request.headers['x-request-id'];
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}
function requestHeaders(request) {
    return Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]));
}
function pathname(request) {
    try {
        return new URL(request.url ?? '/', 'http://script-studio.invalid').pathname;
    }
    catch {
        return '/';
    }
}
function internalFailure(id) {
    return {
        status: 500,
        body: {
            ok: false,
            contractVersion: SCRIPT_STUDIO_API_VERSION,
            error: { code: 'invalid-state', message: 'Internal server error.', requestId: id },
        },
    };
}
function writeResponse(response, result, fallbackRequestId) {
    if (response.writableEnded)
        return;
    let payload;
    try {
        payload = JSON.stringify(result.body);
    }
    catch {
        result = internalFailure(fallbackRequestId);
        payload = JSON.stringify(result.body);
    }
    response.statusCode = Number.isInteger(result.status) && result.status >= 100 && result.status <= 599 ? result.status : 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-length', Buffer.byteLength(payload));
    response.end(payload);
}
export function createScriptStudioHttpHandler(api) {
    return (request, response) => {
        const id = requestId(request);
        const input = {
            method: request.method ?? '',
            path: pathname(request),
            headers: requestHeaders(request),
            requestId: id,
        };
        void api.handle(input)
            .then(result => writeResponse(response, result, id))
            .catch(() => writeResponse(response, internalFailure(id), id));
    };
}
