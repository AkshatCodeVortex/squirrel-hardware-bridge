"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importDefault(require("ws"));
function test() {
    const ws = new ws_1.default('ws://127.0.0.1:8765');
    let testCount = 0;
    ws.onopen = () => {
        console.log("WebSocket Client Connected to Bridge!");
        // Test 1: device.status
        ws.send(JSON.stringify({
            requestId: 'test_req_status',
            deviceType: 'device',
            action: 'device.status'
        }));
    };
    ws.onmessage = (event) => {
        const response = JSON.parse(event.data.toString());
        console.log("Received response:", response);
        if (response.requestId === 'test_req_status') {
            if (response.success && response.result.status === 'Connected') {
                console.log("Test 1 (device.status) Passed!");
                testCount++;
                // Test 2: fingerprint.identify
                ws.send(JSON.stringify({
                    requestId: 'test_req_identify',
                    deviceType: 'fingerprint',
                    action: 'fingerprint.identify'
                }));
            }
            else {
                console.error("Test 1 Failed!", response);
                process.exit(1);
            }
        }
        if (response.requestId === 'test_req_identify') {
            if (response.success && response.result.matched) {
                console.log("Test 2 (fingerprint.identify) Passed!");
                testCount++;
            }
            else {
                console.error("Test 2 Failed!", response);
                process.exit(1);
            }
        }
        if (testCount === 2) {
            console.log("All Local Hardware Bridge Integration Tests Passed Successfully!");
            ws.close();
            process.exit(0);
        }
    };
    ws.onerror = (err) => {
        console.error("WebSocket Connection Error:", err);
        process.exit(1);
    };
    setTimeout(() => {
        console.error("Test Timed Out!");
        process.exit(1);
    }, 5000);
}
test();
