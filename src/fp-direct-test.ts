import * as dotenv from 'dotenv';
import koffi from 'koffi';
import path from 'path';

dotenv.config();

const DLL =
  path.resolve(
    process.cwd(),
    'sdk',
    'lib',
    'FPModule_SDK_x64.dll'
  );

const FP_SUCCESS = 0;
const FP_TIMEOUT = 2;
const FP_ENROLL_FAIL = 3;
const FP_EXTRACT_FAIL = 5;

const FP_TEMPLATE_SIZE = 512;

// Matches FPMsg.FP_MSG_TYPE_T in the C# demo
const FP_MSG_PRESS_FINGER = 0;
const FP_MSG_RISE_FINGER = 1;
const FP_MSG_ENROLL_TIME = 2;
const FP_MSG_CAPTURED_IMAGE = 3;

console.log('');
console.log('========================================');
console.log(' Hikvision Direct USB SDK Test');
console.log('========================================');
console.log('');

console.log(`DLL: ${DLL}`);

const lib = koffi.load(DLL);

const OpenDevice =
  lib.func(
    'int __stdcall FPModule_OpenDevice()'
  );

const CloseDevice =
  lib.func(
    'int __stdcall FPModule_CloseDevice()'
  );

const SetCollectTimes =
  lib.func(
    'int __stdcall FPModule_SetCollectTimes(int dwTimes)'
  );

const FpEnroll =
  lib.func(
    'int __stdcall FPModule_FpEnroll(uint8 *pbyFpTemplate)'
  );

const GetQuality =
  lib.func(
    'int __stdcall FPModule_GetQuality(uint8 *pbyFpTemplate)'
  );

// ==========================================================
// MESSAGE CALLBACK - this was the missing piece.
// The C# demo registers this delegate BEFORE calling FpEnroll:
//   FPutils.FPModule_InstallMessageHandler(FpMessageHandler);
// Without it, the SDK's internal enroll loop has nowhere to
// report finger-press/finger-lift events, and FpEnroll can
// time out regardless of whether a finger is actually placed.
// ==========================================================

// Declare the callback's native signature (matches the C#
// [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate:
// void FpMessageHandler(FP_MSG_TYPE_T enMsgType, IntPtr pMsgData))
const FpMessageHandlerProto = koffi.proto(
  'void __stdcall FpMessageHandlerCb(int enMsgType, void *pMsgData)'
);

const InstallMessageHandler = lib.func(
  'int __stdcall FPModule_InstallMessageHandler(FpMessageHandlerCb *msgHandler)'
);

function fpMessageCallback(enMsgType: any, pMsgData: any) {
  switch (enMsgType) {
    case FP_MSG_PRESS_FINGER:
      console.log('   [SDK] Place your finger');
      break;
    case FP_MSG_RISE_FINGER:
      console.log('   [SDK] Lift and rest your finger');
      break;
    case FP_MSG_ENROLL_TIME: {
      // pMsgData points to an int (which capture # this is)
      const view = koffi.decode(pMsgData, 'int');
      console.log(`   [SDK] Enroll progress: capture ${view}`);
      break;
    }
    case FP_MSG_CAPTURED_IMAGE:
      console.log('   [SDK] Image captured');
      break;
    default:
      console.log(`   [SDK] Unknown message type ${enMsgType}`);
  }
}

// Register the JS function as a native callback pointer, keep the
// reference alive for the lifetime of the script (koffi needs the
// registered callback kept alive - same reason C# does GC.KeepAlive)
const callbackPointer = koffi.register(fpMessageCallback, koffi.pointer(FpMessageHandlerProto));

console.log('');
console.log('Installing message handler...');
const installResult = InstallMessageHandler(callbackPointer);
console.log(`FPModule_InstallMessageHandler() = ${installResult}`);

console.log('');
console.log('Opening device...');

let result = OpenDevice();

console.log(
  `FPModule_OpenDevice() = ${result}`
);

if (result !== FP_SUCCESS) {
  console.error(
    '❌ Cannot open fingerprint scanner.'
  );

  process.exit(1);
}

console.log('✅ Device opened');

try {

  // ==========================================================
  // CAPTURE 1
  // ==========================================================

  console.log('');
  console.log('----------------------------------------');
  console.log('CAPTURE 1');
  console.log('----------------------------------------');

  result =
    SetCollectTimes(3);

  console.log(
    `FPModule_SetCollectTimes(3) = ${result}`
  );

  if (result !== FP_SUCCESS) {
    throw new Error(
      `SetCollectTimes(3) failed: ${result}`
    );
  }

  const template1 =
    Buffer.alloc(
      FP_TEMPLATE_SIZE
    );

  console.log('');
  console.log(
    '👉 PLACE YOUR FINGER ON THE SCANNER'
  );

  result =
    FpEnroll(template1);

  console.log(
    `FPModule_FpEnroll() = ${result}`
  );

  if (result === FP_TIMEOUT) {
    throw new Error(
      'Capture 1 timed out.'
    );
  }

  if (result === FP_ENROLL_FAIL) {
    throw new Error(
      'Capture 1 enrollment failed.'
    );
  }

  if (result === FP_EXTRACT_FAIL) {
    throw new Error(
      'Capture 1 template extraction failed.'
    );
  }

  if (result !== FP_SUCCESS) {
    throw new Error(
      `Capture 1 failed with SDK code ${result}.`
    );
  }

  console.log(
    '✅ Capture 1 successful'
  );

  const quality1 =
    GetQuality(template1);

  console.log(
    `Quality 1: ${quality1}`
  );

  console.log(
    `Template 1 size: ${template1.length}`
  );


  // ==========================================================
  // CAPTURE 2
  // ==========================================================

  console.log('');
  console.log('----------------------------------------');
  console.log('CAPTURE 2');
  console.log('----------------------------------------');

  result =
    SetCollectTimes(1);

  console.log(
    `FPModule_SetCollectTimes(1) = ${result}`
  );

  if (result !== FP_SUCCESS) {
    throw new Error(
      `SetCollectTimes(1) failed: ${result}`
    );
  }

  const template2 =
    Buffer.alloc(
      FP_TEMPLATE_SIZE
    );

  console.log('');
  console.log(
    '👉 PLACE THE SAME FINGER AGAIN'
  );

  result =
    FpEnroll(template2);

  console.log(
    `FPModule_FpEnroll() = ${result}`
  );

  if (result === FP_TIMEOUT) {
    throw new Error(
      'Capture 2 timed out.'
    );
  }

  if (result === FP_ENROLL_FAIL) {
    throw new Error(
      'Capture 2 enrollment failed.'
    );
  }

  if (result === FP_EXTRACT_FAIL) {
    throw new Error(
      'Capture 2 template extraction failed.'
    );
  }

  if (result !== FP_SUCCESS) {
    throw new Error(
      `Capture 2 failed with SDK code ${result}.`
    );
  }

  console.log(
    '✅ Capture 2 successful'
  );

  const quality2 =
    GetQuality(template2);

  console.log(
    `Quality 2: ${quality2}`
  );


  // ==========================================================
  // FINAL
  // ==========================================================

  console.log('');
  console.log('========================================');
  console.log('✅ TWO-CAPTURE TEST PASSED');
  console.log('========================================');
  console.log('');

} catch (error: any) {

  console.error('');
  console.error(
    '❌ TEST FAILED'
  );

  console.error(
    error?.message || error
  );

  console.error('');

  process.exitCode = 1;

} finally {

  console.log(
    'Closing device...'
  );

  const closeResult =
    CloseDevice();

  console.log(
    `FPModule_CloseDevice() = ${closeResult}`
  );

  // release the callback pointer
  koffi.unregister(callbackPointer);
}