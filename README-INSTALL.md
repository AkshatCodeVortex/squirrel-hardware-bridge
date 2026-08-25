# Uplodd Hardware Bridge — Installation Guide

## What This Is

The Uplodd Hardware Bridge connects the **Hikvision DS-K1F820-F** USB fingerprint scanner to the **Qkarts POS** system. It runs silently in the background on the POS Windows PC and provides a local WebSocket server (`ws://127.0.0.1:8765`) that the POS browser tab communicates with.

---

## Customer Requirements

The customer needs **only**:

| Requirement | Notes |
|---|---|
| Windows 10/11 x64 | Required |
| `Uplodd-Hardware-Bridge-Setup-1.0.0.exe` | The installer |
| Hikvision DS-K1F820-F scanner | Connected via USB |

The customer does **NOT** need:

- Node.js, npm, TypeScript, ts-node
- VS Code or Visual Studio
- PowerShell scripts
- The source repository
- The Hikvision FPModule SDK development package

---

## Installation Steps

1. **Run the installer** as Administrator  
   → Double-click `Uplodd-Hardware-Bridge-Setup-1.0.0.exe`

2. **Follow the wizard** — accept defaults

3. **Connect the DS-K1F820-F** via USB

4. **Open the Qkarts POS** — the bridge is already running

That's it.

---

## What the Installer Does

- Installs to `C:\Program Files\Uplodd Hardware Bridge\`
- Copies portable Node.js runtime (`node\node.exe`) — no system Node.js needed
- Copies compiled bridge (`build\index.js` + `node_modules\`)
- Copies Hikvision SDK DLL (`sdk\lib\FPModule_SDK_x64.dll`)
- Creates `config\.env` from template (only on first install — preserved on upgrade)
- Creates `logs\` directory
- Creates Windows Scheduled Task: **Uplodd Hardware Bridge**  
  → Trigger: At user logon  
  → Action: `wscript.exe launch.vbs` (no visible window)  
  → Starts immediately after installation

---

## Installed Directory Structure

```
C:\Program Files\Uplodd Hardware Bridge\
├── node\
│   └── node.exe                 ← portable Node.js 20 LTS (bundled)
├── build\
│   ├── index.js
│   └── providers\
│       ├── hikvision-usb.provider.js
│       ├── mock.provider.js
│       ├── provider.factory.js
│       └── provider.interface.js
├── node_modules\                ← production dependencies only
│   ├── ws\
│   ├── axios\
│   ├── dotenv\
│   └── koffi\                   ← native DLL bridge (Windows x64)
├── sdk\
│   └── lib\
│       └── FPModule_SDK_x64.dll ← Hikvision fingerprint SDK
├── config\
│   └── .env                     ← production config (NOT overwritten on upgrade)
├── logs\
│   └── bridge.log               ← rolling log (5 MB max)
└── launch.vbs                   ← silent launcher (no console window)
```

---

## Configuration

Edit `C:\Program Files\Uplodd Hardware Bridge\config\.env`:

```env
HARDWARE_BRIDGE_PORT=8765
BACKEND_API=https://api.qkarts.com/api
TERMINAL_TOKEN=your-terminal-token-here
FINGERPRINT_MODE=hikvision_usb
```

To apply config changes: **restart the bridge** (see below).

> ⚠️ **Never** change `FINGERPRINT_MODE` to anything other than `hikvision_usb` on Windows production machines.

---

## Log File

`C:\Program Files\Uplodd Hardware Bridge\logs\bridge.log`

Logs rotate automatically at 5 MB (kept as `bridge.log.1`).

Normal startup log:
```
[INFO] ========================================
[INFO]  SQUIRREL HARDWARE BRIDGE v1.0.0
[INFO] ========================================
[INFO]  Platform:    win32/x64
[INFO]  WebSocket:   ws://127.0.0.1:8765
[INFO]  Fingerprint: hikvision_usb
[INFO] ========================================
[INFO] [HikvisionUSB] Platform: win32
[INFO] [HikvisionUSB] Architecture: x64
[INFO] [HikvisionUSB] DLL: C:\Program Files\Uplodd Hardware Bridge\sdk\lib\FPModule_SDK_x64.dll
[INFO] [HikvisionUSB] SDK DLL loaded successfully
[INFO] [Bridge] WebSocket server ready on ws://127.0.0.1:8765
[INFO] [Bridge] Waiting for POS connection...
```

---

## Starting / Stopping the Bridge Manually

**Start:**
```
schtasks /Run /TN "Uplodd Hardware Bridge"
```
Or double-click `C:\Program Files\Uplodd Hardware Bridge\launch.vbs`

**Stop:**
```
schtasks /End /TN "Uplodd Hardware Bridge"
```
Or kill `node.exe` in Task Manager.

**Restart (after config change):**
```
schtasks /End /TN "Uplodd Hardware Bridge"
schtasks /Run /TN "Uplodd Hardware Bridge"
```

---

## Upgrade Procedure

1. Download the new `Uplodd-Hardware-Bridge-Setup-X.X.X.exe`
2. Run as Administrator — the installer:
   - Stops the running bridge automatically
   - Overwrites all application files
   - **Preserves** your `config\.env`
   - **Preserves** your `logs\`
   - Re-creates the scheduled task
   - Starts the bridge

No manual steps required.

---

## Uninstall

**Option A:** Control Panel → Programs → Uplodd Hardware Bridge → Uninstall  
**Option B:** `C:\Program Files\Uplodd Hardware Bridge\Uninstall.exe`

The uninstaller:
- Stops the bridge
- Removes the scheduled task
- Removes all installed files
- **Preserves** `config\.env` and `logs\` (for audit trail)

---

## Troubleshooting

### Bridge not starting after reboot
- Check Task Scheduler: `taskschd.msc` → Task Scheduler Library → "Uplodd Hardware Bridge"
- Verify it shows "Ready" status
- Right-click → Run to test manually
- Check `logs\bridge.log` for error messages

### "FINGERPRINT_SDK_NOT_FOUND"
- Verify `sdk\lib\FPModule_SDK_x64.dll` exists
- Reinstall the bridge

### "FINGERPRINT_DEVICE_NOT_FOUND"
- Unplug and replug the DS-K1F820-F
- Check Windows Device Manager for USB errors
- Try a different USB port

### Port 8765 already in use
- Another bridge instance is running
- Kill `node.exe` in Task Manager and restart

### POS shows "Hardware Bridge Offline"
- Check `logs\bridge.log` for startup errors
- Ensure bridge is running: `schtasks /Query /TN "Uplodd Hardware Bridge"`

---

## Building the Installer (Developers)

> **You cannot build the installer on Mac.**
> Inno Setup runs only on Windows, and `koffi`'s native binary is platform-specific
> (the Mac binary cannot be bundled into a Windows installer).
>
> Use **GitHub Actions** to build from Mac — one `git push` is all you need.

### Option A — GitHub Actions (Recommended, from Mac or any machine)

```bash
# 1. Commit your changes
git add .
git commit -m "release: v1.0.1"

# 2. Push a version tag — this triggers the build automatically
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions (`.github/workflows/build-installer.yml`) then:
- Runs on **`windows-latest`** runner (real Windows x64)
- Compiles TypeScript
- Installs Windows-native `node_modules` (correct koffi binary)
- Downloads portable Node.js 20 LTS (`node.exe`)
- Assembles the `dist/` payload
- Installs Inno Setup 6 via Chocolatey
- Builds `Uplodd-Hardware-Bridge-Setup-1.0.0.exe`
- **Creates a GitHub Release** with the EXE as a download attachment

Download the installer from:
`GitHub → your repo → Releases → v1.0.0 → Assets`

You can also trigger manually without a tag:
`GitHub → Actions → Build Windows Installer → Run workflow`

---

### Option B — Build on a Windows machine (no GitHub required)

Requirements:
- Node.js 20+ and npm (on the *build* machine — NOT bundled in customer installer)
- [Inno Setup 6](https://jrsoftware.org/isdl.php) installed
- Internet access (to download portable Node.js 20 LTS)

```powershell
# Clone the repo, then:
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```

**Output:** `installer\Uplodd-Hardware-Bridge-Setup-1.0.0.exe`

---

### What you can do on Mac (development workflow)

```bash
npm run dev        # Run bridge with mock scanner (no hardware needed)
npm run build      # Compile TypeScript only (no installer)
```


---

## Clean Machine Test Plan

Test on a Windows x64 PC with **no developer tools installed**. Install only the setup EXE.

| # | Test | Expected Result |
|---|---|---|
| 1 | Run Setup.exe | Installs without error |
| 2 | After install | No visible command prompt or console window |
| 3 | Check Task Scheduler | "Uplodd Hardware Bridge" task exists, status: Running |
| 4 | Check logs\bridge.log | Shows startup banner and "WebSocket server ready" |
| 5 | Check bridge\node\node.exe in log | DLL path shows `C:\Program Files\Uplodd Hardware Bridge\sdk\lib\FPModule_SDK_x64.dll` |
| 6 | Open Qkarts POS | "Hardware Bridge Connected" shown |
| 7 | Enroll fingerprint (Admin) | Enrollment succeeds, template saved to DB |
| 8 | Login via fingerprint (POS) | Correct employee identified, login succeeds |
| 9 | Wrong fingerprint | "Fingerprint not recognized. Access denied." |
| 10 | Unplug scanner mid-session | Bridge stays running, logs "device not found" |
| 11 | Replug scanner | Next enroll/identify works normally |
| 12 | Restart Windows | Bridge auto-starts, no manual action needed |
| 13 | Restart POS browser | POS reconnects automatically |
| 14 | Upgrade installer | Config preserved, bridge resumes after upgrade |
| 15 | Uninstall | Task removed, files removed, config preserved |
| 16 | Reinstall after uninstall | Clean install succeeds |
| 17 | Check no Node.js required | Confirm system has no Node.js; bridge still works |

---

## Security Notes

- The WebSocket server listens **only** on `127.0.0.1` (localhost)
- Remote connections are rejected with an access denied error
- Biometric templates are **never** logged to `bridge.log`
- The `TERMINAL_TOKEN` in `config\.env` is not logged
- The bridge does not open any firewall ports
