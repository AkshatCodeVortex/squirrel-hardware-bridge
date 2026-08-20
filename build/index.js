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
const ws_1 = require("ws");
const axios_1 = __importDefault(require("axios"));
const dotenv = __importStar(require("dotenv"));
const provider_factory_1 = require("./providers/provider.factory");
dotenv.config();
const PORT = Number(process.env.HARDWARE_BRIDGE_PORT || 8765);
const HOST = '127.0.0.1'; // Loopback only for security!
const BACKEND_URL = process.env.BACKEND_API || 'http://localhost:8080/api';
console.log(`Starting Squirrel Hardware Bridge on ws://${HOST}:${PORT}`);
console.log(`Backend API endpoint configured: ${BACKEND_URL}`);
const wss = new ws_1.WebSocketServer({ port: PORT, host: HOST });
const provider = provider_factory_1.FingerprintProviderFactory.getProvider();
const mockProvider = provider_factory_1.FingerprintProviderFactory.getMockProvider();
// Helper to fetch candidates securely from Cloud Backend
async function fetchCandidates() {
    const token = process.env.TERMINAL_TOKEN;
    if (!token) {
        console.warn("WARNING: TERMINAL_TOKEN environment variable is not set. Scans may return no matches.");
        return [];
    }
    try {
        const response = await axios_1.default.get(`${BACKEND_URL}/biometric/terminal/candidates`, {
            headers: { 'X-Terminal-Token': token }
        });
        return response.data?.data || [];
    }
    catch (err) {
        console.error("Error retrieving candidates from Cloud Backend:", err.message);
        return [];
    }
}
wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`Client connected from: ${ip}`);
    // Enforce localhost connections only
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
                        }
                        catch (err) {
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
                mockProvider.setScenario(scenario, targetEmployeeId || null);
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
        }
        catch (err) {
            console.error(`[Request ${requestId}] Action failed:`, err.message);
            ws.send(JSON.stringify({
                requestId,
                success: false,
                deviceType,
                action,
                error: { code: 'PROVIDER_FAILURE', message: err.message }
            }));
        }
    });
    ws.on('close', () => {
        console.log(`Client disconnected`);
    });
});
