import * as dotenv from 'dotenv';
dotenv.config();

import { IFingerprintProvider, FingerprintMode } from './provider.interface';
import { MockFingerprintProvider } from './mock.provider';
import { HikvisionUsbFingerprintProvider } from './hikvision-usb.provider';

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
export class FingerprintProviderFactory {
  private static mockProvider = new MockFingerprintProvider();
  private static activeProvider: IFingerprintProvider | null = null;

  public static getProvider(): IFingerprintProvider {
    if (this.activeProvider) return this.activeProvider;

    const mode = (process.env.FINGERPRINT_MODE || 'mock').toLowerCase().trim() as FingerprintMode;

    console.log(`[Bridge] Fingerprint mode: ${mode}`);

    if (mode === 'mock') {
      console.log('[Bridge] Using MockFingerprintProvider — full POS testing without hardware');
      this.activeProvider = this.mockProvider;
      return this.activeProvider;
    }

    if (mode === 'hikvision_usb') {
      console.log('[Bridge] Using HikvisionUsbFingerprintProvider — loading FPModule_SDK...');
      // Constructor throws FingerprintError if SDK not found — NO silent fallback
      this.activeProvider = new HikvisionUsbFingerprintProvider();
      return this.activeProvider;
    }

    throw new Error(
      `Unknown FINGERPRINT_MODE: "${mode}". ` +
      `Valid values: "mock" (development) or "hikvision_usb" (Windows production).`
    );
  }

  public static getMockProvider(): MockFingerprintProvider {
    return this.mockProvider;
  }
}

