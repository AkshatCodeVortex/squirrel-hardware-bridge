import * as dotenv from 'dotenv';
dotenv.config();

/**
 * fingerprint:diagnose
 *
 * Reports the current fingerprint SDK configuration and device status.
 * Safe to run in mock mode on Mac — does NOT attempt to load Windows DLLs.
 */

const mode = (process.env.FINGERPRINT_MODE || 'mock').toLowerCase();
const platform = process.platform;
const arch = process.arch;

function divider() {
  console.log('─'.repeat(50));
}

async function runDiagnose() {
  console.log('\nFingerprint Diagnostic');
  divider();
  console.log(`Mode:         ${mode}`);
  console.log(`Platform:     ${platform}`);
  console.log(`Architecture: ${arch}`);

  if (mode === 'mock') {
    console.log(`DLL path:     N/A (mock mode)`);
    console.log(`SDK loaded:   N/A (mock mode)`);
    console.log(`Device:       N/A (mock mode)`);
    divider();
    console.log('✅  MOCK mode ready — full POS/Admin/Backend testing available');
    console.log('   Enroll: credentialReference format = mock::emp-<id>::finger-<N>');
    console.log('   Identify: deterministic matching by credential prefix');
    return;
  }

  if (mode === 'hikvision_usb') {
    if (platform !== 'win32') {
      divider();
      console.log('❌  FINGERPRINT_MODE=hikvision_usb requires Windows.');
      console.log(`   Current platform: ${platform}`);
      console.log('   Use FINGERPRINT_MODE=mock for Mac/Linux development.');
      process.exit(1);
    }

    const dllName = arch === 'x64' ? 'FPModule_SDK_x64.dll' : 'FPModule_SDK.dll';
    const path = require('path');
    const sdkPath = path.resolve(process.cwd(), `sdk/lib/${dllName}`);
    const fs = require('fs');

    console.log(`DLL required: ${dllName}`);
    console.log(`SDK path:     ${sdkPath}`);
    console.log(`DLL exists:   ${fs.existsSync(sdkPath) ? 'YES' : 'NO'}`);

    try {
      const { HikvisionUsbFingerprintProvider } = await import('./providers/hikvision-usb.provider');
      const provider = new HikvisionUsbFingerprintProvider();
      const info = await provider.getDeviceInfo();
      const status = await provider.getDeviceStatus();
      divider();
      console.log(`SDK loaded:   YES`);
      console.log(`Device model: ${info.model}`);
      console.log(`SDK version:  ${info.firmware}`);
      console.log(`Serial:       ${info.serialNumber}`);
      console.log(`Status:       ${status}`);
      divider();
      console.log('✅  DS-K1F820-F scanner ready for use');
    } catch (err: any) {
      divider();
      console.log(`❌  SDK load failed: ${err.message}`);
      console.log('');
      console.log('To fix:');
      console.log(`  1. Find ${dllName} in your iVMS-4200 installation`);
      console.log(`  2. Copy it to: squirrel-hardware-bridge/sdk/lib/`);
      console.log('  3. Run this diagnostic again');
      process.exit(1);
    }
    return;
  }

  console.log(`❌  Unknown FINGERPRINT_MODE: "${mode}"`);
  console.log('   Valid values: "mock" or "hikvision_usb"');
  process.exit(1);
}

runDiagnose();
