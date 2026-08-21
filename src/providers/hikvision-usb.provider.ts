import koffi from 'koffi';
import path from 'path';

import {
  IFingerprintProvider,
  FingerprintError,
} from './provider.interface';

/**
 * Hikvision / FPModule USB SDK constants
 *
 * Confirmed from:
 * FPModule_SDK.h
 */
const FP_SUCCESS = 0;

/**
 * Confirmed from FPModule_SDK.h:
 *
 * #define FP_FTP_MAX 512
 */
const FP_TEMPLATE_BUFFER_SIZE = 512;

/**
 * Vendor C++ demo uses security level 3
 * for FPModule_MatchTemplate().
 */
const FP_MATCH_SECURITY_LEVEL = 3;

/**
 * Vendor C++ demo:
 *
 * Enrollment:
 * FPModule_SetCollectTimes(0);
 *
 * Matching/live capture:
 * FPModule_SetCollectTimes(1);
 */
const FP_ENROLL_COLLECT_TIMES = 0;
const FP_VERIFY_COLLECT_TIMES = 1;

const FP_POLL_INTERVAL_MS = 300;
const FP_CAPTURE_TIMEOUT_MS = 30_000;

type FingerprintStatus =
  | 'Connected'
  | 'Disconnected'
  | 'Busy'
  | 'Ready'
  | 'Error';

export class HikvisionUsbFingerprintProvider
  implements IFingerprintProvider {
  private lib: any = null;

  private sdkLoaded = false;
  private deviceOpen = false;
  private operationInProgress = false;

  private sdkVersion = 'unknown';
  private loadedDllPath = '';

  private fnOpenDevice: any = null;
  private fnCloseDevice: any = null;
  private fnDetectFinger: any = null;
  private fnSetCollectTimes: any = null;
  private fnFpEnroll: any = null;
  private fnGetQuality: any = null;
  private fnMatchTemplate: any = null;
  private fnGetDeviceInfo: any = null;
  private fnGetSDKVersion: any = null;

  constructor() {
    if (process.platform !== 'win32') {
      throw new FingerprintError(
        'FINGERPRINT_UNSUPPORTED_PLATFORM',
        `FPModule_SDK requires Windows. Current platform: ${process.platform}. ` +
        `Use FINGERPRINT_MODE=mock for development on Mac/Linux.`
      );
    }

    this.loadSdk();
  }

  /**
   * Load the real Hikvision USB FPModule SDK.
   *
   * IMPORTANT:
   * There is intentionally NO HCNetSDK/network fallback here.
   */
  private loadSdk(): void {
    const arch = process.arch;

    if (arch !== 'x64' && arch !== 'ia32') {
      throw new FingerprintError(
        'FINGERPRINT_SDK_LOAD_FAILED',
        `Unsupported Windows architecture: ${arch}`
      );
    }

    const dllName =
      arch === 'x64'
        ? 'FPModule_SDK_x64.dll'
        : 'FPModule_SDK.dll';

    console.log(
      `[HikvisionUSB] Platform: ${process.platform}`
    );

    console.log(
      `[HikvisionUSB] Architecture: ${arch}`
    );

    console.log(
      `[HikvisionUSB] Required DLL: ${dllName}`
    );

    /**
     * First preference:
     *
     * Project-local SDK.
     */
    const candidates: string[] = [
      path.resolve(
        process.cwd(),
        'sdk',
        'lib',
        dllName
      ),
    ];

    /**
     * Official SDK installation discovered
     * on the Windows machine.
     */
    const officialSdkRoot =
      'C:\\Program Files\\FPModule_SDK_V2.2.1_202027(for Windows)';

    candidates.push(
      path.join(
        officialSdkRoot,
        'bin',
        arch === 'x64' ? 'x64' : 'x86',
        dllName
      )
    );

    candidates.push(
      path.join(
        officialSdkRoot,
        'libs',
        arch === 'x64' ? 'x64' : 'x86',
        dllName
      )
    );

    /**
     * Remove duplicates.
     */
    const uniqueCandidates = [
      ...new Set(candidates),
    ];

    let loaded = false;

    for (const dllPath of uniqueCandidates) {
      console.log(
        `[HikvisionUSB] Checking DLL: ${dllPath}`
      );

      try {
        this.lib = koffi.load(dllPath);

        this.loadedDllPath = dllPath;
        loaded = true;

        console.log(
          `[HikvisionUSB] SDK DLL loaded successfully: ${dllPath}`
        );

        break;
      } catch (err: any) {
        console.log(
          `[HikvisionUSB] Could not load '${dllPath}': ${err?.message || err
          }`
        );
      }
    }

    if (!loaded || !this.lib) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_NOT_FOUND',
        `FPModule SDK not found or could not be loaded. ` +
        `Expected ${dllName}. ` +
        `Place it in sdk/lib/ or verify the official SDK installation.`
      );
    }

    this.mapFunctions();

    this.sdkLoaded = true;
  }

  /**
   * Map native functions.
   *
   * IMPORTANT:
   *
   * These signatures are based on the actual
   * FPModule_SDK.h supplied with:
   *
   * FPModule_SDK_V2.2.1_202027
   *
   * Calling convention:
   * __stdcall
   */
  private mapFunctions(): void {
    if (!this.lib) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_LOAD_FAILED',
        'FPModule SDK library is not loaded'
      );
    }

    try {
      /**
       * int __stdcall FPModule_OpenDevice(void);
       */
      this.fnOpenDevice =
        this.lib.func(
          '__stdcall',
          'int FPModule_OpenDevice()'
        );

      /**
       * int __stdcall FPModule_CloseDevice(void);
       */
      this.fnCloseDevice =
        this.lib.func(
          '__stdcall',
          'int FPModule_CloseDevice()'
        );

      /**
       * int __stdcall FPModule_DetectFinger(
       *     int *pdwFpstatus
       * );
       */
      this.fnDetectFinger =
        this.lib.func(
          '__stdcall',
          'int FPModule_DetectFinger(int *pdwFpstatus)'
        );

      /**
       * int __stdcall FPModule_SetCollectTimes(
       *     int dwTimes
       * );
       */
      this.fnSetCollectTimes =
        this.lib.func(
          '__stdcall',
          'int FPModule_SetCollectTimes(int dwTimes)'
        );

      /**
       * int __stdcall FPModule_FpEnroll(
       *     unsigned char *pbyFpTemplate
       * );
       */
      this.fnFpEnroll =
        this.lib.func(
          '__stdcall',
          'int FPModule_FpEnroll(uint8 *pbyFpTemplate)'
        );

      /**
       * int __stdcall FPModule_GetQuality(
       *     unsigned char *pbyFpTemplate
       * );
       */
      this.fnGetQuality =
        this.lib.func(
          '__stdcall',
          'int FPModule_GetQuality(uint8 *pbyFpTemplate)'
        );

      /**
       * int __stdcall FPModule_MatchTemplate(
       *     unsigned char *pbyFpTemplate1,
       *     unsigned char *pbyFpTemplate2,
       *     int dwSecurityLevel
       * );
       */
      this.fnMatchTemplate =
        this.lib.func(
          '__stdcall',
          'int FPModule_MatchTemplate(' +
          'uint8 *pbyFpTemplate1, ' +
          'uint8 *pbyFpTemplate2, ' +
          'int dwSecurityLevel' +
          ')'
        );

      /**
       * int __stdcall FPModule_GetDeviceInfo(
       *     char *pbyDeviceInfo
       * );
       */
      this.fnGetDeviceInfo =
        this.lib.func(
          '__stdcall',
          'int FPModule_GetDeviceInfo(char *pbyDeviceInfo)'
        );

      /**
       * int __stdcall FPModule_GetSDKVersion(
       *     char *pbySDKVersion
       * );
       */
      this.fnGetSDKVersion =
        this.lib.func(
          '__stdcall',
          'int FPModule_GetSDKVersion(char *pbySDKVersion)'
        );

      console.log(
        '[HikvisionUSB] All FPModule SDK functions mapped successfully'
      );

      /**
       * Get SDK version.
       */
      try {
        const versionBuffer =
          Buffer.alloc(256);

        const result =
          this.fnGetSDKVersion(
            versionBuffer
          );

        if (result === FP_SUCCESS) {
          this.sdkVersion =
            versionBuffer
              .toString('ascii')
              .replace(/\0/g, '')
              .trim() || 'unknown';
        }
      } catch (error: any) {
        console.warn(
          '[HikvisionUSB] Could not read SDK version:',
          error?.message || error
        );

        this.sdkVersion = 'unknown';
      }

      console.log(
        `[HikvisionUSB] SDK version: ${this.sdkVersion}`
      );
    } catch (err: any) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_LOAD_FAILED',
        `Failed to map FPModule SDK functions: ${err?.message || err
        }. DLL: ${this.loadedDllPath}`
      );
    }
  }

  /**
   * Prevent two fingerprint operations from
   * using the physical scanner simultaneously.
   */
  private acquireLock(): void {
    if (this.operationInProgress) {
      throw new FingerprintError(
        'FINGERPRINT_DEVICE_BUSY',
        'Another fingerprint operation is already in progress'
      );
    }

    this.operationInProgress = true;
  }

  private releaseLock(): void {
    this.operationInProgress = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(resolve, ms)
    );
  }

  /**
   * Open physical USB scanner.
   */
  private openDevice(): void {
    if (!this.sdkLoaded) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_NOT_FOUND',
        'FPModule SDK is not loaded'
      );
    }

    if (this.deviceOpen) {
      return;
    }

    const result =
      this.fnOpenDevice();

    if (result !== FP_SUCCESS) {
      throw new FingerprintError(
        'FINGERPRINT_DEVICE_NOT_FOUND',
        `FPModule_OpenDevice() returned ${result}`
      );
    }

    this.deviceOpen = true;

    console.log(
      '[HikvisionUSB] DS-K1F820-F device opened'
    );
  }

  /**
   * Close physical USB scanner.
   */
  private closeDevice(): void {
    if (!this.deviceOpen) {
      return;
    }

    try {
      const result =
        this.fnCloseDevice();

      if (result !== FP_SUCCESS) {
        console.warn(
          `[HikvisionUSB] FPModule_CloseDevice() returned ${result}`
        );
      } else {
        console.log(
          '[HikvisionUSB] Device closed'
        );
      }
    } catch (error: any) {
      console.warn(
        '[HikvisionUSB] Device close error:',
        error?.message || error
      );
    } finally {
      this.deviceOpen = false;
    }
  }

  /**
   * Read device information.
   */
  private readDeviceInfo(): string {
    const buffer =
      Buffer.alloc(256);

    try {
      const result =
        this.fnGetDeviceInfo(buffer);

      if (result !== FP_SUCCESS) {
        return 'Unavailable';
      }

      return (
        buffer
          .toString('ascii')
          .replace(/\0/g, '')
          .trim() || 'Unavailable'
      );
    } catch {
      return 'Unavailable';
    }
  }

  /**
   * Wait until the scanner reports a finger.
   *
   * IMPORTANT:
   * DetectFinger receives an int*.
   *
   * The SDK header confirms the signature.
   */
  private async waitForFinger(): Promise<void> {
    const started =
      Date.now();

    while (
      Date.now() - started <
      FP_CAPTURE_TIMEOUT_MS
    ) {
      const statusBuffer =
        Buffer.alloc(4);

      const result =
        this.fnDetectFinger(
          statusBuffer
        );

      if (result !== FP_SUCCESS) {
        throw new FingerprintError(
          'FINGERPRINT_CAPTURE_FAILED',
          `FPModule_DetectFinger() returned ${result}`
        );
      }

      const fingerStatus =
        statusBuffer.readInt32LE(0);

      /**
       * The SDK demo uses the returned
       * pdwFpstatus value.
       *
       * The usual status is:
       * 1 = finger detected
       * 0 = no finger
       */
      if (fingerStatus === 1) {
        console.log(
          '[HikvisionUSB] Finger detected'
        );

        return;
      }

      await this.delay(
        FP_POLL_INTERVAL_MS
      );
    }

    throw new FingerprintError(
      'FINGERPRINT_CAPTURE_TIMEOUT',
      `No finger detected within ${FP_CAPTURE_TIMEOUT_MS / 1000} seconds`
    );
  }

  /**
   * Capture one fingerprint template.
   *
   * The SDK's actual API is:
   *
   * FPModule_FpEnroll(unsigned char *pbyFpTemplate)
   *
   * No size pointer.
   */
  private captureTemplate(
    collectTimes: number
  ): Promise<Buffer> {
    this.openDevice();

    const collectResult =
      this.fnSetCollectTimes(
        collectTimes
      );

    if (collectResult !== FP_SUCCESS) {
      throw new FingerprintError(
        'FINGERPRINT_CAPTURE_FAILED',
        `FPModule_SetCollectTimes(${collectTimes}) returned ${collectResult}`
      );
    }

    console.log(
      `[HikvisionUSB] Collect times: ${collectTimes}`
    );

    return this.captureTemplateAfterSetup();
  }

  /**
   * Capture after device and collection settings
   * are configured.
   */
  private captureTemplateAfterSetup(): Promise<Buffer> {
    const templateBuffer =
      Buffer.alloc(
        FP_TEMPLATE_BUFFER_SIZE
      );

    console.log(
      '[HikvisionUSB] Waiting for finger...'
    );

    /**
     * Wait for actual finger detection.
     */
    return this.waitForFinger()
      .then(() => {
        console.log(
          '[HikvisionUSB] Capturing fingerprint template...'
        );

        const result =
          this.fnFpEnroll(
            templateBuffer
          );

        if (result !== FP_SUCCESS) {
          throw new FingerprintError(
            'FINGERPRINT_CAPTURE_FAILED',
            `FPModule_FpEnroll() returned ${result}`
          );
        }

        console.log(
          `[HikvisionUSB] Template captured (${FP_TEMPLATE_BUFFER_SIZE} byte buffer)`
        );

        return templateBuffer;
      });
  }

  /**
   * Get fingerprint quality.
   */
  private getQuality(
    template: Buffer
  ): number {
    try {
      return this.fnGetQuality(
        template
      );
    } catch (error: any) {
      console.warn(
        '[HikvisionUSB] Quality check failed:',
        error?.message || error
      );

      return -1;
    }
  }

  /**
   * Get device status.
   */
  async getDeviceStatus(): Promise<FingerprintStatus> {
    if (!this.sdkLoaded) {
      return 'Error';
    }

    if (this.operationInProgress) {
      return 'Busy';
    }

    if (this.deviceOpen) {
      return 'Ready';
    }

    return 'Connected';
  }

  /**
   * Get scanner information.
   */
  async getDeviceInfo() {
    if (!this.sdkLoaded) {
      return {
        model:
          'Hikvision DS-K1F820-F',
        firmware:
          'SDK not loaded',
        serialNumber:
          'N/A',
        sdkVersion:
          'N/A',
        sdkPath:
          null,
      };
    }

    return {
      model:
        'Hikvision DS-K1F820-F USB Fingerprint Scanner',

      firmware:
        this.sdkVersion,

      serialNumber:
        this.readDeviceInfo(),

      sdkVersion:
        this.sdkVersion,

      sdkPath:
        this.loadedDllPath,
    };
  }

  /**
   * Start employee enrollment.
   *
   * The vendor C++ demo uses:
   *
   * FPModule_SetCollectTimes(0);
   */
  async enrollStart(
    employeeId: string,
    fingerNumber: number
  ) {
    if (!this.sdkLoaded) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_NOT_FOUND',
        'FPModule SDK is not loaded'
      );
    }

    this.acquireLock();

    try {
      this.openDevice();

      const result =
        this.fnSetCollectTimes(
          FP_ENROLL_COLLECT_TIMES
        );

      if (result !== FP_SUCCESS) {
        throw new FingerprintError(
          'FINGERPRINT_CAPTURE_FAILED',
          `FPModule_SetCollectTimes(${FP_ENROLL_COLLECT_TIMES}) returned ${result}`
        );
      }

      console.log(
        `[HikvisionUSB] Enrollment started. Employee=${employeeId}, finger=${fingerNumber}`
      );

      return {
        success: true,

        employeeId,

        fingerNumber,

        message:
          'Place the employee finger on the scanner for enrollment.',
      };
    } catch (error) {
      this.closeDevice();
      this.releaseLock();

      throw error;
    }
  }

  /**
   * Complete employee enrollment.
   */
  async enrollComplete(
    employeeId: string,
    fingerNumber: number
  ) {
    if (!this.sdkLoaded) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_NOT_FOUND',
        'FPModule SDK is not loaded'
      );
    }

    try {
      if (!this.deviceOpen) {
        this.openDevice();

        const result =
          this.fnSetCollectTimes(
            FP_ENROLL_COLLECT_TIMES
          );

        if (result !== FP_SUCCESS) {
          throw new FingerprintError(
            'FINGERPRINT_CAPTURE_FAILED',
            `FPModule_SetCollectTimes() returned ${result}`
          );
        }
      }

      const template =
        await this.captureTemplateAfterSetup();

      const quality =
        this.getQuality(template);

      console.log(
        `[HikvisionUSB] Enrollment successful`
      );

      console.log(
        `[HikvisionUSB] Employee: ${employeeId}`
      );

      console.log(
        `[HikvisionUSB] Finger: ${fingerNumber}`
      );

      console.log(
        `[HikvisionUSB] Quality: ${quality}`
      );

      /**
       * IMPORTANT:
       *
       * The template is binary biometric data.
       * Never print the Base64 value to logs.
       */
      const credentialReference =
        template.toString('base64');

      return {
        success: true,

        employeeId,

        fingerNumber,

        quality,

        credentialReference,
      };
    } finally {
      this.closeDevice();
      this.releaseLock();
    }
  }

  /**
   * Verify a live fingerprint against one
   * employee's stored fingerprint.
   */
  async verify(
    employeeId: string,
    credentialReference: string
  ) {
    if (!this.sdkLoaded) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_NOT_FOUND',
        'FPModule SDK is not loaded'
      );
    }

    this.acquireLock();

    try {
      /**
       * Capture live fingerprint.
       *
       * Vendor demo:
       * FPModule_SetCollectTimes(1)
       */
      const liveTemplate =
        await this.captureTemplate(
          FP_VERIFY_COLLECT_TIMES
        );

      const storedTemplate =
        Buffer.from(
          credentialReference,
          'base64'
        );

      if (
        storedTemplate.length !==
        FP_TEMPLATE_BUFFER_SIZE
      ) {
        throw new FingerprintError(
          'FINGERPRINT_CAPTURE_FAILED',
          `Invalid stored fingerprint template size: ${storedTemplate.length}. Expected ${FP_TEMPLATE_BUFFER_SIZE}.`
        );
      }

      /**
       * Vendor C++ demo:
       *
       * FPModule_MatchTemplate(
       *     data,
       *     storedTemplate,
       *     3
       * ) == FP_SUCCESS
       */
      const matchResult =
        this.fnMatchTemplate(
          liveTemplate,
          storedTemplate,
          FP_MATCH_SECURITY_LEVEL
        );

      const matched =
        matchResult === FP_SUCCESS;

      console.log(
        `[HikvisionUSB] Verify ${employeeId}: ${matched ? 'MATCH' : 'NO MATCH'
        }`
      );

      return {
        success: true,

        matched,

        employeeId,
      };
    } finally {
      this.closeDevice();
      this.releaseLock();
    }
  }

  /**
   * Identify employee from multiple enrolled
   * fingerprint templates.
   */
  async identify(
    candidates: Array<{
      employeeId: string;
      credentialReference: string;
    }>
  ) {
    if (!this.sdkLoaded) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_NOT_FOUND',
        'FPModule SDK is not loaded'
      );
    }

    if (
      !candidates ||
      candidates.length === 0
    ) {
      return {
        success: true,

        matchedEmployeeId:
          null,

        matchedCredentialReference:
          null,
      };
    }

    this.acquireLock();

    try {
      /**
       * Capture live fingerprint.
       */
      const liveTemplate =
        await this.captureTemplate(
          FP_VERIFY_COLLECT_TIMES
        );

      console.log(
        `[HikvisionUSB] Identifying against ${candidates.length} candidates`
      );

      /**
       * Compare live template against
       * every enrolled employee.
       */
      for (const candidate of candidates) {
        try {
          const storedTemplate =
            Buffer.from(
              candidate.credentialReference,
              'base64'
            );

          if (
            storedTemplate.length !==
            FP_TEMPLATE_BUFFER_SIZE
          ) {
            console.warn(
              `[HikvisionUSB] Skipping ${candidate.employeeId}: invalid template size ${storedTemplate.length}`
            );

            continue;
          }

          const matchResult =
            this.fnMatchTemplate(
              liveTemplate,
              storedTemplate,
              FP_MATCH_SECURITY_LEVEL
            );

          if (
            matchResult === FP_SUCCESS
          ) {
            console.log(
              `[HikvisionUSB] Fingerprint MATCH: ${candidate.employeeId}`
            );

            return {
              success: true,

              matchedEmployeeId:
                candidate.employeeId,

              matchedCredentialReference:
                candidate.credentialReference,
            };
          }
        } catch (error: any) {
          console.warn(
            `[HikvisionUSB] Match failed for ${candidate.employeeId}:`,
            error?.message || error
          );
        }
      }

      console.log(
        '[HikvisionUSB] No fingerprint match found'
      );

      return {
        success: true,

        matchedEmployeeId:
          null,

        matchedCredentialReference:
          null,
      };
    } finally {
      this.closeDevice();
      this.releaseLock();
    }
  }

  /**
   * Cancel current operation.
   */
  async cancel() {
    console.log(
      '[HikvisionUSB] Fingerprint operation cancelled'
    );

    this.closeDevice();
    this.releaseLock();

    return {
      success: true,
    };
  }
}