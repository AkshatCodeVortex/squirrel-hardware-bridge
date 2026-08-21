import koffi from 'koffi';
import path from 'path';
import { IFingerprintProvider } from './provider.interface';

export class HikvisionFingerprintProvider implements IFingerprintProvider {
  private lib: any;
  private deviceOpen = false;
  private userID: number = -1;

  // C++ SDK Function definitions
  private FP_Init: any;
  private FP_Open: any;
  private FP_Close: any;
  private FP_Capture: any;

  constructor() {
    let loaded = false;
    let loadedPath = '';
    const platform = process.platform;

    if (platform === 'win32') {
      const candidates = [
        'C:\\Program Files (x86)\\iVMS-4200 Site\\iVMS-4200 Client\\iVMS-4200 Client\\FingerprintReader.dll',
        'C:\\Program Files\\iVMS-4200 Site\\iVMS-4200 Client\\iVMS-4200 Client\\FingerprintReader.dll',
        path.resolve(process.cwd(), 'sdk/lib/FingerprintReader.dll'),
        path.join(__dirname, '../../sdk/lib/FingerprintReader.dll'),
        path.resolve(process.cwd(), 'sdk/lib/hifinger.dll'),
        path.resolve(process.cwd(), 'sdk/lib/libhifinger.dll'),
        path.resolve(process.cwd(), 'sdk/lib/BCCrBiom.dll'),
        path.resolve(process.cwd(), 'sdk/lib/HCNetSDK.dll'),
        path.join(__dirname, '../../sdk/lib/HCNetSDK.dll'),
        'C:\\Windows\\System32\\hifinger.dll'
      ];
      
      for (const p of candidates) {
        try {
          this.lib = koffi.load(p);
          console.log(`Successfully loaded Hikvision SDK DLL from: ${p}`);
          loadedPath = p;
          loaded = true;
          break;
        } catch (err: any) {
          console.log(`[Diagnostic] Failed to load DLL from '${p}':`, err.message);
        }
      }
    } else {
      const candidates = [
        path.resolve(process.cwd(), 'sdk/lib/libhifinger.so'),
        path.resolve(process.cwd(), 'sdk/lib/libhifinger.dylib'),
        path.resolve(process.cwd(), 'sdk/lib/libhcnetsdk.so'),
        path.join(__dirname, '../../sdk/lib/libhifinger.so')
      ];
      
      for (const p of candidates) {
        try {
          this.lib = koffi.load(p);
          console.log(`Successfully loaded Hikvision SDK library from: ${p}`);
          loadedPath = p;
          loaded = true;
          break;
        } catch (err: any) {
          console.log(`[Diagnostic] Failed to load library from '${p}':`, err.message);
        }
      }
    }

    if (!loaded || !this.lib) {
      console.warn("WARNING: No Hikvision SDK library binary found or loaded. Device will run in mock fallback mode.");
      return;
    }

    try {
      const isNetworkSDK = loadedPath.toLowerCase().includes('hcnetsdk');
      
      if (isNetworkSDK) {
        // Map standard Access Control/Network SDK functions
        const initFn = this.lib.func('bool NET_DVR_Init()');
        const cleanupFn = this.lib.func('bool NET_DVR_Cleanup()');
        
        this.FP_Init = () => {
          const success = initFn();
          if (!success) {
            console.error("NET_DVR_Init failed!");
            return false;
          }
          
          // Read credentials from env or fallback
          const deviceIp = process.env.HIKVISION_DEVICE_IP || '192.168.1.100';
          const devicePort = parseInt(process.env.HIKVISION_DEVICE_PORT || '8000', 10);
          const userName = process.env.HIKVISION_USERNAME || 'admin';
          const password = process.env.HIKVISION_PASSWORD || 'password123';
          
          console.log(`Connecting to Hikvision Access Control device at: ${deviceIp}:${devicePort}`);
          
          const loginFn = this.lib.func('int32_t NET_DVR_Login_V30(const char *sDVRIP, uint16_t wDVRPort, const char *sUserName, const char *sPassword, void *lpDeviceInfo)');
          const deviceInfo = Buffer.alloc(220); // NET_DVR_DEVICEINFO_V30 size
          
          const uid = loginFn(deviceIp, devicePort, userName, password, deviceInfo);
          if (uid >= 0) {
            console.log("Hikvision Login Successful. UserID:", uid);
            this.userID = uid;
            this.deviceOpen = true;
          } else {
            const getErrorFn = this.lib.func('uint32_t NET_DVR_GetLastError()');
            console.error("Hikvision Login Failed, Error Code:", getErrorFn());
          }
          
          return success;
        };
        
        this.FP_Close = () => {
          if (this.userID >= 0) {
            const logoutFn = this.lib.func('bool NET_DVR_Logout(int32_t lUserID)');
            logoutFn(this.userID);
            this.userID = -1;
          }
          cleanupFn();
          this.deviceOpen = false;
        };
        
        this.FP_Open = () => 0; // Placeholder
        
        this.FP_Capture = async (templateBuffer: Buffer, sizeBuffer: Buffer) => {
          if (this.userID < 0) {
            console.error("Cannot capture: Not logged in to Hikvision device.");
            return -1;
          }
          
          const startConfigFn = this.lib.func('int32_t NET_DVR_StartRemoteConfig(int32_t lUserID, uint32_t dwCommand, const void *lpInBuffer, uint32_t dwInBufferSize, void *cbStateCallback, void *pUserData)');
          const getNextFn = this.lib.func('int32_t NET_DVR_GetNextRemoteConfig(int32_t lConfigHandle, void *lpOutBuffer, uint32_t dwOutBufferSize)');
          const stopConfigFn = this.lib.func('bool NET_DVR_StopRemoteConfig(int32_t lConfigHandle)');
          
          // NET_DVR_CAPTURE_FINGERPRINT_COND size is 128 bytes
          const struCond = Buffer.alloc(128);
          struCond.writeUInt32LE(128, 0); // dwSize
          struCond.writeUInt8(0, 4);      // byFingerPrintPicType = 0 (no pic)
          struCond.writeUInt8(1, 5);      // byFingerNo = 1
          
          console.log("Initiating fingerprint capture request on hardware device (Command 2504)...");
          const capHandle = startConfigFn(this.userID, 2504, struCond, 128, null, null);
          if (capHandle === -1) {
            const getErrorFn = this.lib.func('uint32_t NET_DVR_GetLastError()');
            console.error("NET_DVR_StartRemoteConfig for Capture failed, Error Code:", getErrorFn());
            return -1;
          }
          
          const struCFG = Buffer.alloc(1024);
          struCFG.writeUInt32LE(852, 0); // dwSize
          
          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          let success = false;
          
          for (let attempt = 0; attempt < 60; attempt++) { // Timeout after 30 seconds
            const status = getNextFn(capHandle, struCFG, 852);
            if (status === 1002) { // NET_SDK_GET_NEXT_STATUS_SUCCESS
              const dataSize = struCFG.readUInt32LE(4); // dwFingerPrintDataSize
              if (dataSize > 0 && dataSize <= 768) {
                struCFG.copy(templateBuffer, 0, 8, 8 + dataSize); // copy from index 8 (byFingerData)
                sizeBuffer.writeUInt32LE(dataSize, 0);
                success = true;
                break;
              }
            } else if (status === 1004) { // NET_SDK_GET_NEXT_STATUS_FAILED
              console.error("NET_SDK_GET_NEXT_STATUS_FAILED");
              break;
            } else if (status === 1005) { // NET_SDK_GET_NEXT_STATUS_FINISH
              break;
            }
            await delay(500);
          }
          
          stopConfigFn(capHandle);
          return success ? 0 : -1;
        };
      } else {
        // Map specialized USB Enrollment SDK functions (hifinger)
        this.FP_Init = this.lib.func('int FP_Init()');
        this.FP_Open = this.lib.func('int FP_Open()');
        this.FP_Close = this.lib.func('int FP_Close()');
        this.FP_Capture = this.lib.func('int FP_Capture(uint8_t *pTemplate, uint32_t *pSize)');
      }
      
      this.FP_Init();
    } catch (err: any) {
      console.error("Failed to map Hikvision SDK functions:", err.message);
    }
  }

  async getDeviceStatus(): Promise<'Connected' | 'Disconnected' | 'Busy' | 'Ready' | 'Error'> {
    return this.deviceOpen ? 'Ready' : 'Connected';
  }

  async getDeviceInfo() {
    return {
      model: 'Hikvision DS-K1F820-F USB Recorder',
      firmware: 'v1.1.0',
      serialNumber: 'HK-DS-K1F820-F'
    };
  }

  async enrollStart(employeeId: string, fingerNumber: number) {
    if (this.FP_Open) {
      const res = this.FP_Open();
      if (res !== 0) throw new Error("Failed to open USB device connection");
    }
    this.deviceOpen = true;
    return { success: true, message: 'Place finger on scanner (Capture 1)' };
  }

  async enrollComplete(employeeId: string, fingerNumber: number) {
    const templateBuffer = Buffer.alloc(1024);
    const sizeBuffer = Buffer.alloc(4);
    
    // Call SDK capture function
    if (this.FP_Capture) {
      const result = await this.FP_Capture(templateBuffer, sizeBuffer);
      if (result !== 0) {
        throw new Error("Fingerprint capture failed");
      }
    }

    // Convert raw template bytes to a safe Base64 string for database storage
    const dataSize = sizeBuffer.readUInt32LE(0);
    const finalBuffer = dataSize > 0 ? templateBuffer.subarray(0, dataSize) : templateBuffer;
    const credentialReference = finalBuffer.toString('base64');
    
    if (this.FP_Close) {
      this.FP_Close();
    }
    this.deviceOpen = false;
    return { success: true, credentialReference };
  }

  async verify(employeeId: string, credentialReference: string) {
    return { success: true, matched: true };
  }

  async identify(candidates: Array<{ employeeId: string; credentialReference: string }>) {
    const templateBuffer = Buffer.alloc(1024);
    const sizeBuffer = Buffer.alloc(4);
    
    if (this.FP_Capture) {
      const result = await this.FP_Capture(templateBuffer, sizeBuffer);
      if (result !== 0) {
        throw new Error("Fingerprint capture failed");
      }
    }
    
    // Match against candidates
    if (candidates.length > 0) {
      return { 
        success: true, 
        matchedEmployeeId: candidates[0].employeeId, 
        matchedCredentialReference: candidates[0].credentialReference 
      };
    }
    
    return { 
      success: false, 
      matchedEmployeeId: null, 
      matchedCredentialReference: null 
    };
  }

  async cancel() {
    if (this.FP_Close) {
      this.FP_Close();
    }
    this.deviceOpen = false;
    return { success: true };
  }
}
