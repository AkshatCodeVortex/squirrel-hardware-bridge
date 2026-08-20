"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FingerprintProviderFactory = void 0;
const mock_provider_1 = require("./mock.provider");
class FingerprintProviderFactory {
    static mockProvider = new mock_provider_1.MockFingerprintProvider();
    static getProvider(providerName) {
        const name = providerName || process.env.FINGERPRINT_PROVIDER || 'mock';
        if (name === 'mock') {
            return this.mockProvider;
        }
        if (name === 'hikvision') {
            // Placeholder for Hikvision integration (step for later)
            // throw new Error('Hikvision SDK not implemented yet');
            return this.mockProvider;
        }
        return this.mockProvider;
    }
    static getMockProvider() {
        return this.mockProvider;
    }
}
exports.FingerprintProviderFactory = FingerprintProviderFactory;
