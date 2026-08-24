"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FingerprintError = void 0;
class FingerprintError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'FingerprintError';
    }
}
exports.FingerprintError = FingerprintError;
