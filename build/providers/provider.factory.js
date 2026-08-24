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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FingerprintProviderFactory = void 0;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const mock_provider_1 = require("./mock.provider");
const hikvision_usb_provider_1 = require("./hikvision-usb.provider");
/**
 * FingerprintProviderFactory
 *
 * Reads FINGERPRINT_MODE from .env and instantiates the correct provider.
 *
 * FINGERPRINT_MODE=mock           → MockFingerprintProvider (Mac dev, no hardware)
 * FINGERPRINT_MODE=hikvision_usb  → HikvisionUsbFingerprintProvider (Windows + DS-K1F820-F)
 *
 * Strict: if hikvision_usb is selected but the SDK is unavailable, throws immediately.
 * Never silently switches between modes.
 */
class FingerprintProviderFactory {
    static mockProvider = new mock_provider_1.MockFingerprintProvider();
    static activeProvider = null;
    static getProvider() {
        if (this.activeProvider)
            return this.activeProvider;
        const mode = (process.env.FINGERPRINT_MODE || 'mock').toLowerCase().trim();
        console.log(`[Bridge] Fingerprint mode: ${mode}`);
        if (mode === 'mock') {
            console.log('[Bridge] Using MockFingerprintProvider — full POS testing without hardware');
            this.activeProvider = this.mockProvider;
            return this.activeProvider;
        }
        if (mode === 'hikvision_usb') {
            console.log('[Bridge] Using HikvisionUsbFingerprintProvider — loading FPModule_SDK...');
            // Constructor throws FingerprintError if SDK not found — NO silent fallback
            this.activeProvider = new hikvision_usb_provider_1.HikvisionUsbFingerprintProvider();
            return this.activeProvider;
        }
        throw new Error(`Unknown FINGERPRINT_MODE: "${mode}". ` +
            `Valid values: "mock" (development) or "hikvision_usb" (Windows production).`);
    }
    static getMockProvider() {
        return this.mockProvider;
    }
}
exports.FingerprintProviderFactory = FingerprintProviderFactory;
