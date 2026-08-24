import koffi from 'koffi';
import path from 'path';

import {
  IFingerprintProvider,
  FingerprintError,
} from './provider.interface';

/**
 * Hikvision FPModule SDK
 *
 * Confirmed from the official FPModule_SDK.h / VC demo:
 *
 * FP_SUCCESS      = 0
 * FP_TIMEOUT      = 2
 * FP_ENROLL_FAIL  = 3
 * FP_EXTRACT_FAIL = 5
 * FP_MATCH_FAIL   = 6
 *
 * FP_FTP_MAX      = 512
 */

const FP_SUCCESS = 0;
const FP_TIMEOUT = 2;
const FP_ENROLL_FAIL = 3;
const FP_EXTRACT_FAIL = 5;
const FP_MATCH_FAIL = 6;

const FP_TEMPLATE_SIZE = 512;
const FP_SECURITY_LEVEL = 3;

/**
 * IMPORTANT - CONFIRMED WORKING VALUES (tested against real hardware):
 *
 * Enrollment (first capture, builds the template):
 *   SetCollectTimes(3)   <- NOT 0. 0 means "collect zero presses" and
 *                           the SDK waits forever for a sequence that
 *                           can never complete -> guaranteed timeout,
 *                           regardless of whether a finger is placed.
 *
 * Matching / verification capture:
 *   SetCollectTimes(1)
 *
 * This matches the official C# demo (Form1.cs):
 *   FPutils.FPModule_SetCollectTimes(3);   // enroll
 *   iRet = FPutils.FPModule_FpEnroll(data);
 *   ...
 *   FPutils.FPModule_SetCollectTimes(1);   // verify/match
 *   iRet = FPutils.FPModule_FpEnroll(data);
 */
const FP_ENROLL_MODE = 3;
const FP_MATCH_MODE = 1;

/**
 * Confirmed from VC demo:
 *
 * SetTimeout(1~60 seconds)
 */
const FP_TIMEOUT_SECONDS = 30;

export class HikvisionUsbFingerprintProvider
  implements IFingerprintProvider
{
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
  private fnSetTimeout: any = null;
  private fnGetTimeout: any = null;
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
          `Use FINGERPRINT_MODE=mock for Mac/Linux development.`
      );
    }

    this.loadSdk();
  }

  /**
   * ============================================================
   * LOAD SDK
   * ============================================================
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

    const candidates: string[] = [
      /**
       * Primary: relative to this module's directory.
       *
       * Development  (__dirname = src/)  → project-root/sdk/lib/DLL
       * Production   (__dirname = build/) → app-root/sdk/lib/DLL
       *
       * This works correctly for both ts-node (dev) and the packaged
       * installer (production) without depending on process.cwd().
       */
      path.resolve(__dirname, '..', 'sdk', 'lib', dllName),
      /**
       * Legacy fallback: cwd-relative (kept for manual/dev invocations).
       */
      path.resolve(process.cwd(), 'sdk', 'lib', dllName),
    ];

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

    let loaded = false;

    for (const dllPath of [...new Set(candidates)]) {
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
          `[HikvisionUSB] Failed to load '${dllPath}': ${
            err?.message || err
          }`
        );
      }
    }

    if (!loaded || !this.lib) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_NOT_FOUND',
        `FPModule SDK not found: ${dllName}`
      );
    }

    this.mapFunctions();

    this.sdkLoaded = true;
  }

  /**
   * ============================================================
   * MAP SDK FUNCTIONS
   * ============================================================
   *
   * IMPORTANT:
   * The official header says __stdcall.
   */
  private mapFunctions(): void {
    try {
      this.fnOpenDevice =
        this.lib.func(
          'int __stdcall FPModule_OpenDevice()'
        );

      this.fnCloseDevice =
        this.lib.func(
          'int __stdcall FPModule_CloseDevice()'
        );

      this.fnDetectFinger =
        this.lib.func(
          'int __stdcall FPModule_DetectFinger(int *pdwFpstatus)'
        );

      this.fnSetCollectTimes =
        this.lib.func(
          'int __stdcall FPModule_SetCollectTimes(int dwTimes)'
        );

      this.fnSetTimeout =
        this.lib.func(
          'int __stdcall FPModule_SetTimeout(int dwTime)'
        );

      this.fnGetTimeout =
        this.lib.func(
          'int __stdcall FPModule_GetTimeout(int *pdwTime)'
        );

      this.fnFpEnroll =
        this.lib.func(
          'int __stdcall FPModule_FpEnroll(uint8 *pbyFpTemplate)'
        );

      this.fnGetQuality =
        this.lib.func(
          'int __stdcall FPModule_GetQuality(uint8 *pbyFpTemplate)'
        );

      this.fnMatchTemplate =
        this.lib.func(
          'int __stdcall FPModule_MatchTemplate(' +
            'uint8 *pbyFpTemplate1, ' +
            'uint8 *pbyFpTemplate2, ' +
            'int dwSecurityLevel' +
          ')'
        );

      this.fnGetDeviceInfo =
        this.lib.func(
          'int __stdcall FPModule_GetDeviceInfo(char *pbyDeviceInfo)'
        );

      this.fnGetSDKVersion =
        this.lib.func(
          'int __stdcall FPModule_GetSDKVersion(char *pbySDKVersion)'
        );

      console.log(
        '[HikvisionUSB] SDK functions mapped successfully'
      );

      this.loadSdkVersion();

    } catch (err: any) {
      throw new FingerprintError(
        'FINGERPRINT_SDK_LOAD_FAILED',
        `Failed to map FPModule SDK functions: ${
          err?.message || err
        }. DLL: ${this.loadedDllPath}`
      );
    }
  }

  /**
   * ============================================================
   * SDK VERSION
   * ============================================================
   */
  private loadSdkVersion(): void {
    try {
      const buffer = Buffer.alloc(64);

      const result =
        this.fnGetSDKVersion(buffer);

      if (result === FP_SUCCESS) {
        this.sdkVersion =
          buffer
            .toString('ascii')
            .replace(/\0/g, '')
            .trim() || 'unknown';
      }

      console.log(
        `[HikvisionUSB] SDK version: ${this.sdkVersion}`
      );
    } catch {
      this.sdkVersion = 'unknown';
    }
  }

  /**
   * ============================================================
   * LOCK
   * ============================================================
   */
  private acquireLock(): void {
    if (this.operationInProgress) {
      throw new FingerprintError(
        'FINGERPRINT_DEVICE_BUSY',
        'Fingerprint operation already in progress'
      );
    }

    this.operationInProgress = true;
  }

  private releaseLock(): void {
    this.operationInProgress = false;
  }

  /**
   * ============================================================
   * OPEN DEVICE
   * ============================================================
   */
  private openDevice(): void {
    if (this.deviceOpen) {
      return;
    }

    console.log(
      '[HikvisionUSB] Opening device...'
    );

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
      '[HikvisionUSB] Device opened successfully'
    );

    /**
     * Vendor demo exposes SetTimeout(1~60).
     */
    const timeoutResult =
      this.fnSetTimeout(
        FP_TIMEOUT_SECONDS
      );

    console.log(
      `[HikvisionUSB] SetTimeout(${FP_TIMEOUT_SECONDS}) = ${timeoutResult}`
    );

    if (timeoutResult !== FP_SUCCESS) {
      console.warn(
        '[HikvisionUSB] Warning: SDK timeout configuration failed'
      );
    }
  }

  /**
   * ============================================================
   * CLOSE DEVICE
   * ============================================================
   */
  private closeDevice(): void {
    if (!this.deviceOpen) {
      return;
    }

    try {
      const result =
        this.fnCloseDevice();

      console.log(
        `[HikvisionUSB] FPModule_CloseDevice() = ${result}`
      );

    } catch (err: any) {
      console.warn(
        '[HikvisionUSB] Close error:',
        err?.message || err
      );
    } finally {
      this.deviceOpen = false;
    }
  }

  /**
   * ============================================================
   * CAPTURE TEMPLATE
   * ============================================================
   *
   * collectMode: FP_ENROLL_MODE (3) for enrollment,
   *              FP_MATCH_MODE (1) for verify/identify captures.
   */
  private captureTemplate(
    collectMode: number
  ): Buffer {
    const collectResult =
      this.fnSetCollectTimes(
        collectMode
      );

    console.log(
      `[HikvisionUSB] SetCollectTimes(${collectMode}) = ${collectResult}`
    );

    if (collectResult !== FP_SUCCESS) {
      throw new FingerprintError(
        'FINGERPRINT_CAPTURE_FAILED',
        `FPModule_SetCollectTimes(${collectMode}) returned ${collectResult}`
      );
    }

    const template =
      Buffer.alloc(
        FP_TEMPLATE_SIZE
      );

    console.log(
      '[HikvisionUSB] Place your finger on the scanner...'
    );

    const result =
      this.fnFpEnroll(
        template
      );

    console.log(
      `[HikvisionUSB] FPModule_FpEnroll() = ${result}`
    );

    if (result === FP_TIMEOUT) {
      throw new FingerprintError(
        'FINGERPRINT_CAPTURE_TIMEOUT',
        'Fingerprint capture timed out'
      );
    }

    if (result === FP_ENROLL_FAIL) {
      throw new FingerprintError(
        'FINGERPRINT_CAPTURE_FAILED',
        'Fingerprint enrollment failed'
      );
    }

    if (result === FP_EXTRACT_FAIL) {
      throw new FingerprintError(
        'FINGERPRINT_CAPTURE_FAILED',
        'Fingerprint template extraction failed'
      );
    }

    if (result !== FP_SUCCESS) {
      throw new FingerprintError(
        'FINGERPRINT_CAPTURE_FAILED',
        `FPModule_FpEnroll() returned ${result}`
      );
    }

    if (template.length !== FP_TEMPLATE_SIZE) {
      // Defensive check - this should never trigger given Buffer.alloc
      // above, but if it ever does, better to fail loudly here than
      // silently persist a corrupt/truncated template to the database.
      throw new FingerprintError(
        'FINGERPRINT_CAPTURE_FAILED',
        `Captured template is ${template.length} bytes, expected ${FP_TEMPLATE_SIZE}`
      );
    }

    console.log(
      '[HikvisionUSB] Fingerprint captured successfully'
    );

    return template;
  }

  /**
   * ============================================================
   * DEVICE STATUS
   * ============================================================
   */
  async getDeviceStatus(): Promise<
    'Connected' |
    'Disconnected' |
    'Busy' |
    'Ready' |
    'Error'
  > {
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
   * ============================================================
   * DEVICE INFO
   * ============================================================
   */
  async getDeviceInfo() {
    const buffer =
      Buffer.alloc(64);

    let deviceInfo = 'Unavailable';

    try {
      const result =
        this.fnGetDeviceInfo(buffer);

      if (result === FP_SUCCESS) {
        deviceInfo =
          buffer
            .toString('ascii')
            .replace(/\0/g, '')
            .trim() || 'Unavailable';
      }
    } catch {
      // ignore
    }

    return {
      model:
        'Hikvision DS-K1F820-F USB Fingerprint Scanner',

      firmware:
        this.sdkVersion,

      serialNumber:
        deviceInfo,

      sdkVersion:
        this.sdkVersion,

      sdkPath:
        this.loadedDllPath,
    };
  }

  /**
   * ============================================================
   * ENROLL START
   * ============================================================
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
          FP_ENROLL_MODE
        );

      if (result !== FP_SUCCESS) {
        throw new FingerprintError(
          'FINGERPRINT_CAPTURE_FAILED',
          `SetCollectTimes(${FP_ENROLL_MODE}) returned ${result}`
        );
      }

      console.log(
        `[HikvisionUSB] Enrollment started: ${employeeId}, finger ${fingerNumber}`
      );

      return {
        success: true,
        message:
          'Place finger on scanner.',
      };

    } catch (error) {
      this.closeDevice();
      this.releaseLock();
      throw error;
    }
  }

  /**
   * ============================================================
   * ENROLL COMPLETE
   * ============================================================
   *
   * Returns credentialReference as a base64 string. A 512-byte
   * template becomes a ~684-character base64 string - whatever
   * you store this in downstream (DB column, API payload) MUST
   * be able to hold at least that many characters, or it will be
   * silently truncated (see storage layer notes / provider.repository.ts).
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
      }

      const template =
        this.captureTemplate(
          FP_ENROLL_MODE
        );

      const quality =
        this.fnGetQuality(
          template
        );

      console.log(
        `[HikvisionUSB] Enrollment quality: ${quality}`
      );

      const credentialReference = template.toString('base64');

      console.log(
        `[HikvisionUSB] credentialReference length: ${credentialReference.length} chars ` +
        `(should be ~684 for a ${FP_TEMPLATE_SIZE}-byte template)`
      );

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
   * ============================================================
   * VERIFY
   * ============================================================
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
      this.openDevice();

      const liveTemplate =
        this.captureTemplate(
          FP_MATCH_MODE
        );

      const stored =
        Buffer.from(
          credentialReference,
          'base64'
        );

      if (
        stored.length !== FP_TEMPLATE_SIZE
      ) {
        throw new FingerprintError(
          'FINGERPRINT_CAPTURE_FAILED',
          `Stored template is ${stored.length} bytes; expected ${FP_TEMPLATE_SIZE}. ` +
          `This means the credentialReference was truncated or corrupted before ` +
          `reaching this function - check the database column type/length and ` +
          `any serialization step between enrollComplete() and here.`
        );
      }

      const result =
        this.fnMatchTemplate(
          liveTemplate,
          stored,
          FP_SECURITY_LEVEL
        );

      console.log(
        `[HikvisionUSB] Match result: ${result}`
      );

      return {
        success: true,

        matched:
          result === FP_SUCCESS,

        employeeId,
      };

    } finally {
      this.closeDevice();
      this.releaseLock();
    }
  }

  /**
   * ============================================================
   * IDENTIFY
   * ============================================================
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
        matchedEmployeeId: null,
        matchedCredentialReference: null,
      };
    }

    this.acquireLock();

    try {
      this.openDevice();

      const liveTemplate =
        this.captureTemplate(
          FP_MATCH_MODE
        );

      console.log(
        `[HikvisionUSB] Matching against ${candidates.length} candidate(s)`
      );

      for (const candidate of candidates) {
        const stored =
          Buffer.from(
            candidate.credentialReference,
            'base64'
          );

        if (
          stored.length !== FP_TEMPLATE_SIZE
        ) {
          console.warn(
            `[HikvisionUSB] Invalid template for ${candidate.employeeId}: ${stored.length} bytes ` +
            `(expected ${FP_TEMPLATE_SIZE}) - likely truncated in storage. Skipping.`
          );

          continue;
        }

        const result =
          this.fnMatchTemplate(
            liveTemplate,
            stored,
            FP_SECURITY_LEVEL
          );

        console.log(
          `[HikvisionUSB] Match ${candidate.employeeId}: SDK result ${result}`
        );

        if (result === FP_SUCCESS) {
          return {
            success: true,

            matchedEmployeeId:
              candidate.employeeId,

            matchedCredentialReference:
              candidate.credentialReference,
          };
        }

        if (result === FP_MATCH_FAIL) {
          continue;
        }
      }

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
   * ============================================================
   * CANCEL
   * ============================================================
   */
  async cancel() {
    this.closeDevice();
    this.releaseLock();

    return {
      success: true,
    };
  }
}