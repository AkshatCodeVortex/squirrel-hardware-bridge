export interface IFingerprintProvider {
  getDeviceStatus(): Promise<'Connected' | 'Disconnected' | 'Busy' | 'Ready' | 'Error'>;
  getDeviceInfo(): Promise<{ model: string; firmware: string; serialNumber: string }>;
  enrollStart(employeeId: string, fingerNumber: number): Promise<{ success: boolean; message: string }>;
  enrollComplete(employeeId: string, fingerNumber: number): Promise<{ success: boolean; credentialReference: string }>;
  verify(employeeId: string, credentialReference: string): Promise<{ success: boolean; matched: boolean }>;
  identify(candidates: Array<{ employeeId: string; credentialReference: string }>): Promise<{ success: boolean; matchedEmployeeId: string | null; matchedCredentialReference: string | null }>;
  cancel(): Promise<{ success: boolean }>;
}

export type FingerprintMode = 'mock' | 'hikvision_usb';

export type FingerprintErrorCode =
  | 'FINGERPRINT_SDK_NOT_FOUND'
  | 'FINGERPRINT_SDK_LOAD_FAILED'
  | 'FINGERPRINT_DEVICE_NOT_FOUND'
  | 'FINGERPRINT_DEVICE_BUSY'
  | 'FINGERPRINT_CAPTURE_TIMEOUT'
  | 'FINGERPRINT_CAPTURE_FAILED'
  | 'FINGERPRINT_NO_MATCH'
  | 'FINGERPRINT_CANCELLED'
  | 'FINGERPRINT_WRONG_ARCH'
  | 'FINGERPRINT_UNSUPPORTED_PLATFORM';

export class FingerprintError extends Error {
  constructor(public readonly code: FingerprintErrorCode, message: string) {
    super(message);
    this.name = 'FingerprintError';
  }
}

export type MockScenario =
  | 'SUCCESS'
  | 'NO_MATCH'
  | 'DEVICE_DISCONNECTED'
  | 'DEVICE_BUSY'
  | 'CAPTURE_FAILED'
  | 'TIMEOUT'
  | 'ENROLLMENT_FAILED';

