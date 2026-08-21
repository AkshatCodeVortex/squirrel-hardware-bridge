import * as dotenv from 'dotenv';
dotenv.config();

/**
 * fingerprint:test
 *
 * Standalone hardware test for DS-K1F820-F USB scanner.
 * Run this BEFORE starting the POS bridge to verify hardware works.
 *
 * In mock mode: runs full enroll + identify simulation.
 * In hikvision_usb mode: physically opens device, captures fingerprint, matches it.
 */

const mode = (process.env.FINGERPRINT_MODE || 'mock').toLowerCase();

async function runTest() {
  console.log('\nFingerprint Hardware Test');
  console.log('─'.repeat(50));
  console.log(`Mode: ${mode}`);

  if (mode === 'mock') {
    console.log('\n[MOCK] Running mock enroll + identify simulation...\n');

    const { MockFingerprintProvider } = await import('./providers/mock.provider');
    const provider = new MockFingerprintProvider();
    provider.setScenario('SUCCESS', null);

    // Enroll
    console.log('Step 1: enrollStart()');
    const startRes = await provider.enrollStart('emp-test-001', 1);
    console.log('  →', startRes.message);

    console.log('Step 2: enrollComplete()');
    const enrollRes = await provider.enrollComplete('emp-test-001', 1);
    console.log('  → credentialReference:', enrollRes.credentialReference);

    // Identify
    console.log('Step 3: identify() against enrolled candidate');
    const candidates = [
      { employeeId: 'emp-test-001', credentialReference: enrollRes.credentialReference }
    ];
    const idRes = await provider.identify(candidates);
    if (idRes.matchedEmployeeId === 'emp-test-001') {
      console.log('  → ✅ MATCH — emp-test-001 identified correctly');
    } else {
      console.log('  → ❌ No match — identify() is broken');
      process.exit(1);
    }

    // Test NO_MATCH scenario
    console.log('Step 4: identify() with NO_MATCH scenario');
    provider.setScenario('NO_MATCH', null);
    const noMatch = await provider.identify(candidates);
    if (noMatch.matchedEmployeeId === null) {
      console.log('  → ✅ Correctly returned no match');
    } else {
      console.log('  → ❌ Should have returned null');
      process.exit(1);
    }

    console.log('\n─'.repeat(50));
    console.log('✅  All mock tests passed');
    return;
  }

  if (mode === 'hikvision_usb') {
    if (process.platform !== 'win32') {
      console.log('❌  hikvision_usb mode requires Windows');
      process.exit(1);
    }

    try {
      console.log('\nLoading FPModule SDK...');
      const { HikvisionUsbFingerprintProvider } = await import('./providers/hikvision-usb.provider');
      const provider = new HikvisionUsbFingerprintProvider();
      console.log('SDK loaded ✅');

      const info = await provider.getDeviceInfo();
      console.log(`Device: ${info.model} (${info.serialNumber})`);

      console.log('\nStarting enrollment test...');
      console.log('→ enrollStart()');
      const startRes = await provider.enrollStart('test-employee', 1);
      console.log(' ', startRes.message);

      console.log('→ enrollComplete() — PLACE YOUR FINGER ON THE SCANNER');
      const enrollRes = await provider.enrollComplete('test-employee', 1);
      console.log(`  Template captured ✅ (${enrollRes.credentialReference.length} base64 chars)`);

      console.log('\nStarting identify test...');
      console.log('→ identify() — PLACE YOUR FINGER AGAIN');
      const candidates = [{ employeeId: 'test-employee', credentialReference: enrollRes.credentialReference }];
      const idRes = await provider.identify(candidates);

      if (idRes.matchedEmployeeId === 'test-employee') {
        console.log('  ✅ MATCH — fingerprint identified successfully');
      } else {
        console.log('  ❌ No match — check SDK version or security level');
        process.exit(1);
      }

      console.log('\n─'.repeat(50));
      console.log('✅  Hardware test PASSED — scanner is ready for production use');
    } catch (err: any) {
      console.log('\n❌  Hardware test FAILED:', err.message);
      process.exit(1);
    }
    return;
  }

  console.log(`❌  Unknown FINGERPRINT_MODE: "${mode}"`);
  process.exit(1);
}

runTest();
