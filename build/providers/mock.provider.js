"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockFingerprintProvider = void 0;
class MockFingerprintProvider {
    activeScenario = 'SUCCESS';
    targetEmployeeId = null;
    isEnrolling = false;
    setScenario(scenario, targetEmployeeId = null) {
        this.activeScenario = scenario;
        this.targetEmployeeId = targetEmployeeId;
    }
    getScenario() {
        return {
            scenario: this.activeScenario,
            targetEmployeeId: this.targetEmployeeId
        };
    }
    checkStatus() {
        if (this.activeScenario === 'DEVICE_DISCONNECTED') {
            throw new Error('DEVICE_NOT_CONNECTED');
        }
        if (this.activeScenario === 'DEVICE_BUSY') {
            throw new Error('DEVICE_BUSY');
        }
    }
    async getDeviceStatus() {
        if (this.activeScenario === 'DEVICE_DISCONNECTED') {
            return 'Disconnected';
        }
        if (this.activeScenario === 'DEVICE_BUSY') {
            return 'Busy';
        }
        return 'Connected';
    }
    async getDeviceInfo() {
        this.checkStatus();
        return {
            model: 'Mock-Scanner-1000',
            firmware: 'v1.0.0-mock',
            serialNumber: 'SN-MOCK-999999'
        };
    }
    async enrollStart(employeeId, fingerNumber) {
        this.checkStatus();
        if (this.activeScenario === 'CAPTURE_FAILED') {
            throw new Error('CAPTURE_FAILED');
        }
        this.isEnrolling = true;
        return {
            success: true,
            message: 'Place finger on scanner (Capture 1)'
        };
    }
    async enrollComplete(employeeId, fingerNumber) {
        this.checkStatus();
        this.isEnrolling = false;
        if (this.activeScenario === 'ENROLLMENT_FAILED') {
            throw new Error('ENROLLMENT_FAILED');
        }
        if (this.activeScenario === 'TIMEOUT') {
            throw new Error('TIMEOUT');
        }
        const mockRef = `mock-fingerprint-ref-${employeeId}-${fingerNumber}-${Math.random().toString(36).substring(7)}`;
        return {
            success: true,
            credentialReference: mockRef
        };
    }
    async verify(employeeId, credentialReference) {
        this.checkStatus();
        if (this.activeScenario === 'NO_MATCH') {
            return { success: true, matched: false };
        }
        if (this.activeScenario === 'CAPTURE_FAILED') {
            throw new Error('CAPTURE_FAILED');
        }
        if (this.activeScenario === 'TIMEOUT') {
            throw new Error('TIMEOUT');
        }
        return { success: true, matched: true };
    }
    async identify(candidates) {
        this.checkStatus();
        if (this.activeScenario === 'NO_MATCH' || candidates.length === 0) {
            return { success: true, matchedEmployeeId: null, matchedCredentialReference: null };
        }
        if (this.activeScenario === 'CAPTURE_FAILED') {
            throw new Error('CAPTURE_FAILED');
        }
        if (this.activeScenario === 'TIMEOUT') {
            throw new Error('TIMEOUT');
        }
        // If target employee is specified, search them first
        if (this.targetEmployeeId) {
            const match = candidates.find(c => c.employeeId === this.targetEmployeeId);
            if (match) {
                return {
                    success: true,
                    matchedEmployeeId: match.employeeId,
                    matchedCredentialReference: match.credentialReference
                };
            }
        }
        // Default: match first candidate in list
        return {
            success: true,
            matchedEmployeeId: candidates[0].employeeId,
            matchedCredentialReference: candidates[0].credentialReference
        };
    }
    async cancel() {
        this.isEnrolling = false;
        return { success: true };
    }
}
exports.MockFingerprintProvider = MockFingerprintProvider;
