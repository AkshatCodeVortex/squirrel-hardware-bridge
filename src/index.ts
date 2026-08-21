import WebSocket, { WebSocketServer } from 'ws';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { FingerprintProviderFactory } from './providers/provider.factory';
import { MockScenario, FingerprintError } from './providers/provider.interface';

dotenv.config();

const PORT = Number(process.env.HARDWARE_BRIDGE_PORT || 8765);
const HOST = '127.0.0.1'; // Loopback only for security!
const BACKEND_URL = process.env.BACKEND_API || 'http://localhost:8080/api';

const fingerprintMode = process.env.FINGERPRINT_MODE || 'mock';
console.log(`Starting Squirrel Hardware Bridge on ws://${HOST}:${PORT}`);
console.log(`Backend API endpoint configured: ${BACKEND_URL}`);
console.log(`Fingerprint mode: ${fingerprintMode}`);

const wss = new WebSocketServer({ port: PORT, host: HOST });

const provider = FingerprintProviderFactory.getProvider();
const mockProvider = FingerprintProviderFactory.getMockProvider();

// Helper to fetch candidates securely from Cloud Backend
async function fetchCandidates(): Promise<Array<{ employeeId: string; credentialReference: string }>> {
  const token = process.env.TERMINAL_TOKEN;
  if (!token) {
    console.warn("WARNING: TERMINAL_TOKEN environment variable is not set. Scans may return no matches.");
    return [];
  }

  try {
    const response = await axios.get(`${BACKEND_URL}/biometric/terminal/candidates`, {
      headers: { 'X-Terminal-Token': token }
    });
    return response.data?.data || [];
  } catch (err: any) {
    console.error("Error retrieving candidates from Cloud Backend:", err.message);
    return [];
  }
}

wss.on('connection', (ws: WebSocket, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`Client connected from: ${ip}`);

  // Enforce localhost connections only
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
        requestId: requestId || null,
        success: false, 
        error: { code: 'INVALID_REQUEST', message: 'requestId, deviceType and action are required' } 
      }));
      return;
    }

    console.log(`[Request ${requestId}] DeviceType: ${deviceType} | Action: ${action}`);

    try {
      // 1. Device Discovery & General status actions
      if (deviceType === 'device') {
        if (action === 'device.list') {
          ws.send(JSON.stringify({
            requestId,
            success: true,
            deviceType,
            action,
            result: { devices: [{ id: 'fingerprint_01', type: 'fingerprint', name: 'Mock-Scanner-1000' }] }
          }));
          return;
        }

        if (action === 'device.status') {
          const status = await provider.getDeviceStatus();
          ws.send(JSON.stringify({
            requestId,
            success: true,
            deviceType,
            action,
            result: { status }
          }));
          return;
        }

        if (action === 'device.info') {
          const info = await provider.getDeviceInfo();
          ws.send(JSON.stringify({
            requestId,
            success: true,
            deviceType,
            action,
            result: info
          }));
          return;
        }
      }

      // 2. Fingerprint Specific actions
      if (deviceType === 'fingerprint') {
        if (action === 'fingerprint.enroll') {
          const { employeeId, fingerNumber } = payload || {};
          if (!employeeId || !fingerNumber) {
            throw new Error('employeeId and fingerNumber are required in payload');
          }

          // Trigger enrollment start
          const startRes = await provider.enrollStart(employeeId, Number(fingerNumber));
          
          // Send back status updates (simulated delay for mock)
          ws.send(JSON.stringify({
            requestId,
            success: true,
            deviceType,
            action,
            status: 'scanning',
            message: startRes.message
          }));

          setTimeout(async () => {
            try {
              const completeRes = await provider.enrollComplete(employeeId, Number(fingerNumber));
              ws.send(JSON.stringify({
                requestId,
                success: true,
                deviceType,
                action,
                status: 'success',
                result: {
                  credentialReference: completeRes.credentialReference
                }
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({
                requestId,
                success: false,
                deviceType,
                action,
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
            requestId,
            success: true,
            deviceType,
            action,
            result: { matched: res.matched }
          }));
          return;
        }

        if (action === 'fingerprint.identify') {
          // Fetch candidate list securely from Backend
          const candidates = await fetchCandidates();
          console.log(`[Request ${requestId}] Matching against ${candidates.length} candidate credentials`);

          const res = await provider.identify(candidates);
          ws.send(JSON.stringify({
            requestId,
            success: true,
            deviceType,
            action,
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
          ws.send(JSON.stringify({
            requestId,
            success: true,
            deviceType,
            action,
            result: res
          }));
          return;
        }
      }

      // 3. Mock Scenario Configuration (Dev Only)
      if (deviceType === 'mock' && action === 'mock.scenario') {
        const { scenario, targetEmployeeId } = payload || {};
        mockProvider.setScenario(scenario as MockScenario, targetEmployeeId || null);
        
        console.log(`[Mock Config] Set active scenario to: ${scenario} (Target: ${targetEmployeeId})`);
        ws.send(JSON.stringify({
          requestId,
          success: true,
          deviceType,
          action,
          result: mockProvider.getScenario()
        }));
        return;
      }

      // Action not matched
      ws.send(JSON.stringify({
        requestId,
        success: false,
        error: { code: 'UNKNOWN_ACTION', message: `Action '${action}' under deviceType '${deviceType}' is not supported` }
      }));

    } catch (err: any) {
      console.error(`[Request ${requestId}] Action failed:`, err.message);
      // Use structured FingerprintErrorCode if available — never expose DLL paths to browser
      const errorCode = (err instanceof FingerprintError) ? err.code : 'PROVIDER_FAILURE';
      const safeMessage = (err instanceof FingerprintError) ? err.message : 'An internal hardware error occurred';
      ws.send(JSON.stringify({
        requestId,
        success: false,
        deviceType,
        action,
        error: { code: errorCode, message: safeMessage }
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected`);
  });
});
