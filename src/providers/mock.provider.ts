import { IFingerprintProvider, MockScenario, FingerprintError } from './provider.interface';

/**
 * MockFingerprintProvider
 *
 * Fully simulates fingerprint hardware for development and testing.
 * Works on Mac without any physical device.
 *
 * ENROLLMENT:
 *   enrollComplete() generates a deterministic credential reference that encodes the employeeId.
 *   Format: mock::emp-<employeeId>::finger-<fingerNumber>
 *
 * IDENTIFICATION:
 *   identify() decodes the employeeId from each candidate's credentialReference.
 *   If targetEmployeeId is set, returns that specific employee (if enrolled).
 *   Otherwise matches the FIRST candidate whose credentialReference was issued by this mock.
 *   Returns no match if the credential is not a valid mock credential.
 *
 * This eliminates the bug where identify() always returned candidates[0] regardless of fingerprint.
 */
export class MockFingerprintProvider implements IFingerprintProvider {
  private activeScenario: MockScenario = 'SUCCESS';
  private targetEmployeeId: string | null = null;
  private isEnrolling = false;

  // Prefix that identifies mock-generated credential references
  private static readonly MOCK_PREFIX = 'mock::emp-';

  public setScenario(scenario: MockScenario, targetEmployeeId: string | null = null) {
    this.activeScenario = scenario;
    this.targetEmployeeId = targetEmployeeId;
  }

  public getScenario() {
    return {
      scenario: this.activeScenario,
      targetEmployeeId: this.targetEmployeeId
    };
  }

  private checkStatus() {
    if (this.activeScenario === 'DEVICE_DISCONNECTED') {
      throw new FingerprintError('FINGERPRINT_DEVICE_NOT_FOUND', 'Mock device is disconnected');
    }
    if (this.activeScenario === 'DEVICE_BUSY') {
      throw new FingerprintError('FINGERPRINT_DEVICE_BUSY', 'Mock device is busy');
    }
  }

  async getDeviceStatus(): Promise<'Connected' | 'Disconnected' | 'Busy' | 'Ready' | 'Error'> {
    if (this.activeScenario === 'DEVICE_DISCONNECTED') return 'Disconnected';
    if (this.activeScenario === 'DEVICE_BUSY') return 'Busy';
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

  async enrollStart(employeeId: string, fingerNumber: number) {
    this.checkStatus();
    if (this.activeScenario === 'CAPTURE_FAILED') {
      throw new FingerprintError('FINGERPRINT_CAPTURE_FAILED', 'Mock capture failed');
    }
    this.isEnrolling = true;
    return {
      success: true,
      message: `[MOCK] Place finger on scanner — enrolling employee ${employeeId} finger ${fingerNumber}`
    };
  }

  async enrollComplete(employeeId: string, fingerNumber: number) {
    this.checkStatus();
    this.isEnrolling = false;

    if (this.activeScenario === 'ENROLLMENT_FAILED') {
      throw new FingerprintError('FINGERPRINT_CAPTURE_FAILED', 'Mock enrollment failed');
    }
    if (this.activeScenario === 'TIMEOUT') {
      throw new FingerprintError('FINGERPRINT_CAPTURE_TIMEOUT', 'Mock capture timeout');
    }

    // Deterministic reference: encodes employeeId so identify() can decode it
    const credentialReference = `${MockFingerprintProvider.MOCK_PREFIX}${employeeId}::finger-${fingerNumber}`;
    return { success: true, credentialReference };
  }

  async verify(employeeId: string, credentialReference: string) {
    this.checkStatus();

    if (this.activeScenario === 'NO_MATCH') {
      return { success: true, matched: false };
    }
    if (this.activeScenario === 'CAPTURE_FAILED') {
      throw new FingerprintError('FINGERPRINT_CAPTURE_FAILED', 'Mock capture failed');
    }
    if (this.activeScenario === 'TIMEOUT') {
      throw new FingerprintError('FINGERPRINT_CAPTURE_TIMEOUT', 'Mock capture timeout');
    }

    // Verify that the credential belongs to this employee
    const expectedPrefix = `${MockFingerprintProvider.MOCK_PREFIX}${employeeId}::`;
    const matched = credentialReference.startsWith(expectedPrefix);
    return { success: true, matched };
  }

  async identify(candidates: Array<{ employeeId: string; credentialReference: string }>) {
    this.checkStatus();

    if (this.activeScenario === 'NO_MATCH' || candidates.length === 0) {
      return { success: true, matchedEmployeeId: null, matchedCredentialReference: null };
    }
    if (this.activeScenario === 'CAPTURE_FAILED') {
      throw new FingerprintError('FINGERPRINT_CAPTURE_FAILED', 'Mock capture failed');
    }
    if (this.activeScenario === 'TIMEOUT') {
      throw new FingerprintError('FINGERPRINT_CAPTURE_TIMEOUT', 'Mock capture timeout');
    }

    // If a specific employee is targeted via mock.scenario, find them
    if (this.targetEmployeeId) {
      const match = candidates.find(c => c.employeeId === this.targetEmployeeId);
      if (match) {
        return {
          success: true,
          matchedEmployeeId: match.employeeId,
          matchedCredentialReference: match.credentialReference
        };
      }
      // Target was set but not found in candidates
      return { success: true, matchedEmployeeId: null, matchedCredentialReference: null };
    }

    // Deterministic matching: decode employeeId from mock credential reference
    // This simulates actual fingerprint matching without hardware
    for (const candidate of candidates) {
      if (candidate.credentialReference.startsWith(MockFingerprintProvider.MOCK_PREFIX)) {
        // Extract the employeeId from the credential: mock::emp-<id>::finger-N
        const withoutPrefix = candidate.credentialReference.slice(MockFingerprintProvider.MOCK_PREFIX.length);
        const encodedId = withoutPrefix.split('::')[0];
        if (encodedId === candidate.employeeId) {
          return {
            success: true,
            matchedEmployeeId: candidate.employeeId,
            matchedCredentialReference: candidate.credentialReference
          };
        }
      }
    }

    // No mock credentials matched
    return { success: true, matchedEmployeeId: null, matchedCredentialReference: null };
  }

  async cancel() {
    this.isEnrolling = false;
    return { success: true };
  }
}

