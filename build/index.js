"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ws_1 = require("ws");
const axios_1 = __importDefault(require("axios"));
const dotenv = __importStar(require("dotenv"));
const provider_factory_1 = require("./providers/provider.factory");
const provider_interface_1 = require("./providers/provider.interface");
// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────
const VERSION = '1.0.0';
// ─────────────────────────────────────────────────────────────────────────────
// APP ROOT
// Development  (__dirname = <project>/src/)   → appRoot = <project>/
// Production   (__dirname = <install>/build/) → appRoot = <install>/
// ─────────────────────────────────────────────────────────────────────────────
const APP_ROOT = path_1.default.resolve(__dirname, '..');
// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT — try config/.env (production), then .env (development)
// ─────────────────────────────────────────────────────────────────────────────
const envCandidates = [
    path_1.default.join(APP_ROOT, 'config', '.env'),
    path_1.default.join(APP_ROOT, '.env'),
    path_1.default.join(process.cwd(), '.env'),
];
for (const envPath of envCandidates) {
    if (fs_1.default.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// FILE LOGGING — 5 MB rotation. NEVER log biometric templates or tokens.
// ─────────────────────────────────────────────────────────────────────────────
const LOG_DIR = path_1.default.join(APP_ROOT, 'logs');
const LOG_FILE = path_1.default.join(LOG_DIR, 'bridge.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;
function ensureLogDir() {
    if (!fs_1.default.existsSync(LOG_DIR)) {
        try {
            fs_1.default.mkdirSync(LOG_DIR, { recursive: true });
        }
        catch { /* ignore */ }
    }
}
function writeLog(level, message) {
    try {
        ensureLogDir();
        if (fs_1.default.existsSync(LOG_FILE) && fs_1.default.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
            const backup = `${LOG_FILE}.1`;
            if (fs_1.default.existsSync(backup))
                fs_1.default.unlinkSync(backup);
            fs_1.default.renameSync(LOG_FILE, backup);
        }
        fs_1.default.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level}] ${message}\n`, 'utf8');
    }
    catch { /* continue if log write fails */ }
}
const _stdLog = console.log.bind(console);
const _stdWarn = console.warn.bind(console);
const _stdError = console.error.bind(console);
console.log = (...args) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    _stdLog(...args);
    writeLog('INFO', msg);
};
console.warn = (...args) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    _stdWarn(...args);
    writeLog('WARN', msg);
};
console.error = (...args) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    _stdError(...args);
    writeLog('ERROR', msg);
};
// ─────────────────────────────────────────────────────────────────────────────
// CRASH HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error(`[Bridge] Uncaught exception: ${err.message}`);
    console.error(err.stack || '(no stack)');
});
process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`[Bridge] Unhandled rejection: ${msg}`);
});
// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.HARDWARE_BRIDGE_PORT || 8765);
const HOST = '127.0.0.1'; // loopback only
const BACKEND_URL = process.env.BACKEND_API || 'http://localhost:8080/api';
const fingerprintMode = process.env.FINGERPRINT_MODE || 'mock';
console.log([
    '',
    '========================================',
    ` UPLODD HARDWARE BRIDGE v${VERSION}`,
    '========================================',
    ` Platform:    ${process.platform}/${process.arch}`,
    ` Node.js:     ${process.version}`,
    ` WebSocket:   ws://${HOST}:${PORT}`,
    ` Fingerprint: ${fingerprintMode}`,
    ` Backend:     ${BACKEND_URL}`,
    ` App root:    ${APP_ROOT}`,
    ` Log file:    ${LOG_FILE}`,
    '========================================',
    '',
].join('\n'));
console.log(`Starting Uplodd Hardware Bridge on ws://${HOST}:${PORT}`);
console.log(`Backend API endpoint configured: ${BACKEND_URL}`);
console.log(`Fingerprint mode: ${fingerprintMode}`);
// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────────────────────────────────────
const provider = provider_factory_1.FingerprintProviderFactory.getProvider();
const mockProvider = provider_factory_1.FingerprintProviderFactory.getMockProvider();
// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET SERVER
// ─────────────────────────────────────────────────────────────────────────────
const wss = new ws_1.WebSocketServer({ port: PORT, host: HOST });
wss.on('listening', () => {
    console.log(`[Bridge] WebSocket server ready on ws://${HOST}:${PORT}`);
});
wss.on('error', (err) => {
    console.error(`[Bridge] WebSocket server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
        console.error(`[Bridge] Port ${PORT} already in use — is another bridge instance running?`);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE FETCHER — DO NOT log credentialReference values
// ─────────────────────────────────────────────────────────────────────────────
async function fetchCandidates() {
    const token = process.env.TERMINAL_TOKEN;
    if (!token) {
        throw new provider_interface_1.FingerprintError('FINGERPRINT_NO_MATCH', 'TERMINAL_TOKEN is not configured. Please generate a terminal token from Admin panel and update the bridge .env file.');
    }
    try {
        const response = await axios_1.default.get(`${BACKEND_URL}/biometric/terminal/candidates`, {
            headers: { 'X-Terminal-Token': token },
            timeout: 10_000,
        });
        const candidates = response.data?.data || [];
        console.log(`[Bridge] Fetched ${candidates.length} candidate(s) from backend`);
        return candidates;
    }
    catch (err) {
        const status = err?.response?.status;
        if (status === 401) {
            console.error(`[Bridge] Terminal token rejected by backend (401). Token may be expired or the backend JWT secret has changed.`);
            throw new provider_interface_1.FingerprintError('FINGERPRINT_NO_MATCH', 'Terminal token is expired or invalid. Please regenerate the terminal token from Admin panel and restart the bridge.');
        }
        console.error(`[Bridge] Failed to fetch candidates: ${err.message} (status: ${status || 'N/A'})`);
        throw new provider_interface_1.FingerprintError('FINGERPRINT_NO_MATCH', `Cannot reach backend to fetch enrolled fingerprints: ${err.message}`);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION HANDLER
// ─────────────────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`Client connected from: ${ip}`);
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
        console.warn(`Access Denied: connection attempt from forbidden IP ${ip}`);
        ws.close();
        return;
    }
    ws.on('message', async (message) => {
        let requestPacket;
        try {
            requestPacket = JSON.parse(message);
        }
        catch (err) {
            ws.send(JSON.stringify({ success: false, error: { code: 'INVALID_JSON', message: 'Malformed JSON payload' } }));
            return;
        }
        const { requestId, deviceType, action, payload } = requestPacket;
        if (!requestId || !deviceType || !action) {
            ws.send(JSON.stringify({
                requestId: requestId || null, success: false,
                error: { code: 'INVALID_REQUEST', message: 'requestId, deviceType and action are required' }
            }));
            return;
        }
        console.log(`[Request ${requestId}] DeviceType: ${deviceType} | Action: ${action}`);
        try {
            // ── Device ────────────────────────────────────────────────────────────
            if (deviceType === 'device') {
                if (action === 'device.list') {
                    ws.send(JSON.stringify({
                        requestId, success: true, deviceType, action,
                        result: { devices: [{ id: 'fingerprint_01', type: 'fingerprint', name: 'Hikvision DS-K1F820-F' }] }
                    }));
                    return;
                }
                if (action === 'device.status') {
                    const status = await provider.getDeviceStatus();
                    ws.send(JSON.stringify({ requestId, success: true, deviceType, action, result: { status } }));
                    return;
                }
                if (action === 'device.info') {
                    const info = await provider.getDeviceInfo();
                    ws.send(JSON.stringify({ requestId, success: true, deviceType, action, result: info }));
                    return;
                }
                if (action === 'device.version') {
                    ws.send(JSON.stringify({
                        requestId, success: true, deviceType, action,
                        result: { version: VERSION, mode: fingerprintMode, platform: process.platform }
                    }));
                    return;
                }
            }
            // ── Fingerprint ────────────────────────────────────────────────────────
            if (deviceType === 'fingerprint') {
                if (action === 'fingerprint.enroll') {
                    const { employeeId, fingerNumber } = payload || {};
                    if (!employeeId || !fingerNumber) {
                        throw new Error('employeeId and fingerNumber are required in payload');
                    }
                    const startRes = await provider.enrollStart(employeeId, Number(fingerNumber));
                    ws.send(JSON.stringify({
                        requestId, success: true, deviceType, action,
                        status: 'scanning', message: startRes.message
                    }));
                    setTimeout(async () => {
                        try {
                            const completeRes = await provider.enrollComplete(employeeId, Number(fingerNumber));
                            ws.send(JSON.stringify({
                                requestId, success: true, deviceType, action,
                                status: 'success',
                                result: {
                                    credentialReference: completeRes.credentialReference,
                                    provider: fingerprintMode
                                }
                            }));
                        }
                        catch (err) {
                            ws.send(JSON.stringify({
                                requestId, success: false, deviceType, action,
                                error: { code: 'ENROLLMENT_FAILED', message: err.message }
                            }));
                        }
                    }, 1500);
                    return;
                }
                if (action === 'fingerprint.verify') {
                    const { employeeId, credentialReference } = payload || {};
                    if (!employeeId || !credentialReference) {
                        throw new Error('employeeId and credentialReference are required in payload');
                    }
                    const res = await provider.verify(employeeId, credentialReference);
                    ws.send(JSON.stringify({
                        requestId, success: true, deviceType, action,
                        result: { matched: res.matched }
                    }));
                    return;
                }
                if (action === 'fingerprint.identify') {
                    const candidates = await fetchCandidates();
                    console.log(`[Request ${requestId}] Matching against ${candidates.length} candidate credentials`);
                    const res = await provider.identify(candidates);
                    ws.send(JSON.stringify({
                        requestId, success: true, deviceType, action,
                        result: {
                            matched: res.matchedEmployeeId !== null,
                            credentialReference: res.matchedCredentialReference,
                            employeeId: res.matchedEmployeeId
                        }
                    }));
                    return;
                }
                if (action === 'fingerprint.cancel') {
                    const res = await provider.cancel();
                    ws.send(JSON.stringify({ requestId, success: true, deviceType, action, result: res }));
                    return;
                }
            }
            // ── Mock Scenario (Dev Only) ────────────────────────────────────────────
            if (deviceType === 'mock' && action === 'mock.scenario') {
                const { scenario, targetEmployeeId } = payload || {};
                mockProvider.setScenario(scenario, targetEmployeeId || null);
                console.log(`[Mock Config] Set active scenario to: ${scenario} (Target: ${targetEmployeeId})`);
                ws.send(JSON.stringify({
                    requestId, success: true, deviceType, action,
                    result: mockProvider.getScenario()
                }));
                return;
            }
            // ── Unknown action ──────────────────────────────────────────────────────
            ws.send(JSON.stringify({
                requestId, success: false,
                error: { code: 'UNKNOWN_ACTION', message: `Action '${action}' under deviceType '${deviceType}' is not supported` }
            }));
        }
        catch (err) {
            console.error(`[Request ${requestId}] Action failed:`, err.message);
            const errorCode = (err instanceof provider_interface_1.FingerprintError) ? err.code : 'PROVIDER_FAILURE';
            const safeMessage = (err instanceof provider_interface_1.FingerprintError) ? err.message : 'An internal hardware error occurred';
            ws.send(JSON.stringify({
                requestId, success: false, deviceType, action,
                error: { code: errorCode, message: safeMessage }
            }));
        }
    });
    ws.on('close', () => { console.log('Client disconnected'); });
    ws.on('error', (err) => { console.error(`[Bridge] Client error: ${err.message}`); });
});
// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
function shutdown(signal) {
    console.log(`[Bridge] Received ${signal} — shutting down`);
    wss.close(() => { process.exit(0); });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
