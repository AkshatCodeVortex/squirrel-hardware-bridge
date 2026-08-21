"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FingerprintProviderFactory = void 0;
const mock_provider_1 = require("./mock.provider");
const hikvision_provider_1 = require("./hikvision.provider");
class FingerprintProviderFactory {
    static mockProvider = new mock_provider_1.MockFingerprintProvider();
    static getProvider(providerName) {
        const name = providerName || process.env.FINGERPRINT_PROVIDER || 'mock';
        if (name === 'mock') {
            return this.mockProvider;
        }
        if (name === 'hikvision') {
            return new hikvision_provider_1.HikvisionFingerprintProvider();
        }
        return this.mockProvider;
    }
    static getMockProvider() {
        return this.mockProvider;
    }
}
exports.FingerprintProviderFactory = FingerprintProviderFactory;
