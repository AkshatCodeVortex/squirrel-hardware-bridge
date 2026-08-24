import path from 'path';
import fs from 'fs';
import WebSocket, { WebSocketServer } from 'ws';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { FingerprintProviderFactory } from './providers/provider.factory';
import { MockScenario, FingerprintError } from './providers/provider.interface';

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────
const VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// APP ROOT
// Development  (__dirname = <project>/src/)   → appRoot = <project>/
// Production   (__dirname = <install>/build/) → appRoot = <install>/
// ─────────────────────────────────────────────────────────────────────────────
const APP_ROOT = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT — try config/.env (production), then .env (development)
// ─────────────────────────────────────────────────────────────────────────────
const envCandidates = [
  path.join(APP_ROOT, 'config', '.env'),
  path.join(APP_ROOT, '.env'),
  path.join(process.cwd(), '.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE LOGGING — 5 MB rotation. NEVER log biometric templates or tokens.
// ─────────────────────────────────────────────────────────────────────────────
const LOG_DIR  = path.join(APP_ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bridge.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }
  }
}

function writeLog(level: string, message: string): void {
  try {
    ensureLogDir();
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      const backup = `${LOG_FILE}.1`;
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      fs.renameSync(LOG_FILE, backup);
    }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level}] ${message}\n`, 'utf8');
  } catch { /* continue if log write fails */ }
}

const _stdLog   = console.log.bind(console);
const _stdWarn  = console.warn.bind(console);
const _stdError = console.error.bind(console);

console.log = (...args: any[]) => {
  const msg = args.map((a: any) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  _stdLog(...args); writeLog('INFO', msg);
};
console.warn = (...args: any[]) => {
  const msg = args.map((a: any) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  _stdWarn(...args); writeLog('WARN', msg);
};
console.error = (...args: any[]) => {
  const msg = args.map((a: any) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  _stdError(...args); writeLog('ERROR', msg);
};

// ─────────────────────────────────────────────────────────────────────────────
// CRASH HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
process.on('uncaughtException', (err: Error) => {
  console.error(`[Bridge] Uncaught exception: ${err.message}`);
  console.error(err.stack || '(no stack)');
});
process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`[Bridge] Unhandled rejection: ${msg}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const PORT            = Number(process.env.HARDWARE_BRIDGE_PORT || 8765);
const HOST            = '127.0.0.1'; // loopback only
const BACKEND_URL     = process.env.BACKEND_API || 'http://localhost:8080/api';
const fingerprintMode = process.env.FINGERPRINT_MODE || 'mock';

console.log([
  '',
  '========================================',
  ` SQUIRREL HARDWARE BRIDGE v${VERSION}`,
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

console.log(`Starting Squirrel Hardware Bridge on ws://${HOST}:${PORT}`);
console.log(`Backend API endpoint configured: ${BACKEND_URL}`);
console.log(`Fingerprint mode: ${fingerprintMode}`);

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────────────────────────────────────
const provider     = FingerprintProviderFactory.getProvider();
const mockProvider = FingerprintProviderFactory.getMockProvider();

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET SERVER
// ─────────────────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT, host: HOST });

wss.on('listening', () => {
  console.log(`[Bridge] WebSocket server ready on ws://${HOST}:${PORT}`);
});

wss.on('error', (err: Error) => {
  console.error(`[Bridge] WebSocket server error: ${err.message}`);
  if ((err as any).code === 'EADDRINUSE') {
    console.error(`[Bridge] Port ${PORT} already in use — is another bridge instance running?`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE FETCHER — DO NOT log credentialReference values
// ─────────────────────────────────────────────────────────────────────────────
async function fetchCandidates(): Promise<Array<{ employeeId: string; credentialReference: string }>> {
  const token = process.env.TERMINAL_TOKEN;
  if (!token) {
    console.warn('[Bridge] WARNING: TERMINAL_TOKEN is not set — fingerprint.identify will return no matches.');
    return [];
  }
  try {
    const response = await axios.get(`${BACKEND_URL}/biometric/terminal/candidates`, {
      headers: { 'X-Terminal-Token': token },
      timeout: 10_000,
    });
    return response.data?.data || [];
  } catch (err: any) {
    console.error(`[Bridge] Failed to fetch candidates: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION HANDLER
// ─────────────────────────────────────────────────────────────────────────────
wss.on('connection', (ws: WebSocket, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`Client connected from: ${ip}`);

  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    console.warn(`Access Denied: connection attempt from forbidden IP ${ip}`);
    ws.close();
    return;
  }

  ws.on('message', async (message: string) => {
    let requestPacket: any;
    try {
      requestPacket = JSON.parse(message);
    } catch (err) {
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
            } catch (err: any) {
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
        mockProvider.setScenario(scenario as MockScenario, targetEmployeeId || null);
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

    } catch (err: any) {
      console.error(`[Request ${requestId}] Action failed:`, err.message);
      const errorCode   = (err instanceof FingerprintError) ? err.code    : 'PROVIDER_FAILURE';
      const safeMessage = (err instanceof FingerprintError) ? err.message : 'An internal hardware error occurred';
      ws.send(JSON.stringify({
        requestId, success: false, deviceType, action,
        error: { code: errorCode, message: safeMessage }
      }));
    }
  });

  ws.on('close', () => { console.log('Client disconnected'); });
  ws.on('error', (err: Error) => { console.error(`[Bridge] Client error: ${err.message}`); });
});

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
function shutdown(signal: string): void {
  console.log(`[Bridge] Received ${signal} — shutting down`);
  wss.close(() => { process.exit(0); });
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
