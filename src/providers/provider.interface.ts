export interface IFingerprintProvider {
  getDeviceStatus(): Promise<'Connected' | 'Disconnected' | 'Busy' | 'Ready' | 'Error'>;
  getDeviceInfo(): Promise<{ model: string; firmware: string; serialNumber: string }>;
  enrollStart(employeeId: string, fingerNumber: number): Promise<{ success: boolean; message: string }>;
  enrollComplete(employeeId: string, fingerNumber: number): Promise<{ success: boolean; credentialReference: string }>;
  verify(employeeId: string, credentialReference: string): Promise<{ success: boolean; matched: boolean }>;
  identify(candidates: Array<{ employeeId: string; credentialReference: string }>): Promise<{ success: boolean; matchedEmployeeId: string | null; matchedCredentialReference: string | null }>;
  cancel(): Promise<{ success: boolean }>;
}

export type MockScenario = 
  | 'SUCCESS' 
  | 'NO_MATCH' 
  | 'DEVICE_DISCONNECTED' 
  | 'DEVICE_BUSY' 
  | 'CAPTURE_FAILED' 
  | 'TIMEOUT'
  | 'ENROLLMENT_FAILED';
