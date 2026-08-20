import { IFingerprintProvider } from './provider.interface';
import { MockFingerprintProvider } from './mock.provider';

export class FingerprintProviderFactory {
  private static mockProvider = new MockFingerprintProvider();

  public static getProvider(providerName?: string): IFingerprintProvider {
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

  public static getMockProvider(): MockFingerprintProvider {
    return this.mockProvider;
  }
}
