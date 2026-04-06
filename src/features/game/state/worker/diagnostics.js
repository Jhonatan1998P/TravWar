export function registerWorkerDiagnostics(workerGlobal) {
    workerGlobal.onerror = function(message, source, lineno, colno, error) {
        const diagnosticPayload = {
            errorType: 'onerror',
            message: error?.message || String(message) || 'Unknown worker error',
            stack: error?.stack || null,
            source: source || null,
            lineno: lineno || null,
            colno: colno || null,
            name: error?.name || null,
        };

        console.error('[WORKER][CRASH]', diagnosticPayload);
        workerGlobal.postMessage({
            type: 'worker:error',
            payload: diagnosticPayload,
        });
        return true;
    };

    workerGlobal.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason;
        const diagnosticPayload = {
            errorType: 'unhandledrejection',
            message: reason?.message || String(reason) || 'Unhandled promise rejection in worker',
            stack: reason?.stack || null,
            source: null,
            lineno: null,
            colno: null,
            name: reason?.name || null,
        };

        console.error('[WORKER][UNHANDLED_REJECTION]', diagnosticPayload);
        workerGlobal.postMessage({
            type: 'worker:error',
            payload: diagnosticPayload,
        });
        event.preventDefault();
    });

    workerGlobal.addEventListener('messageerror', function(event) {
        const diagnosticPayload = {
            errorType: 'messageerror',
            message: 'Worker received malformed message payload',
            stack: null,
            source: null,
            lineno: null,
            colno: null,
            name: null,
            eventDataType: typeof event.data,
        };

        console.error('[WORKER][MESSAGE_ERROR]', diagnosticPayload);
        workerGlobal.postMessage({
            type: 'worker:error',
            payload: diagnosticPayload,
        });
    });
}
