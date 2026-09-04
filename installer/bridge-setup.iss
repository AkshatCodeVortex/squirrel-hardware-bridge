; ============================================================
; Uplodd Hardware Bridge - Inno Setup 6 Installer Script
; ============================================================
; Build command (from repo root on Windows):
;   powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
; Or open this file in Inno Setup 6 IDE and click Build.
;
; Expects:
;   /DDistDir=<absolute path to dist/ folder>
;   /DVersion=1.0.0
; ============================================================

#ifndef DistDir
  #define DistDir "..\dist"
#endif
#ifndef Version
  #define Version "1.0.0"
#endif

#define AppName      "Uplodd Hardware Bridge"
#define AppExeName   "UploddHardwareBridge"
#define Publisher    "Uplodd / Qkarts"
#define AppURL       "https://qkarts.com"
#define TaskName     "Uplodd Hardware Bridge"

[Setup]
AppId={{A7B3C9D1-4F2E-4A8B-9C6D-E5F2A1B3C7D9}
AppName={#AppName}
AppVersion={#Version}
AppPublisher={#Publisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={commonpf64}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
LicenseFile=
; Only install on Windows x64
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
; Require admin rights (for Program Files install + Scheduled Task)
PrivilegesRequired=admin
OutputDir=.
OutputBaseFilename=Uplodd-Hardware-Bridge-Setup-{#Version}
SetupIconFile=
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardResizable=no
; Show version in title
VersionInfoVersion={#Version}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Installer
; Uninstall settings
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\node\node.exe
; Restart not required
RestartIfNeededByRun=no
; Minimum Windows version: Windows 10 (6.2 = Win 8, use 10.0)
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to the {#AppName} Setup Wizard
WelcomeLabel2=This will install {#AppName} v{#Version} on your computer.%n%nThe bridge connects your Hikvision DS-K1F820-F fingerprint scanner to the Qkarts POS system.%n%nClick Next to continue.
FinishedLabel=Setup has finished installing {#AppName}.%n%nThe bridge will start automatically when you log in. Connect your DS-K1F820-F scanner and open the Qkarts POS to begin.

[Dirs]
Name: "{app}";                Flags: uninsalwaysuninstall
Name: "{app}\node"
Name: "{app}\build"
Name: "{app}\node_modules"
Name: "{app}\sdk\lib"
Name: "{app}\config"
Name: "{app}\logs";           Flags: uninsneveruninstall

[Files]
; ── Node.js runtime ──────────────────────────────────────────────────────────
Source: "{#DistDir}\node\node.exe";         DestDir: "{app}\node"; Flags: ignoreversion

; ── Compiled bridge application ──────────────────────────────────────────────
Source: "{#DistDir}\build\*";               DestDir: "{app}\build"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── Production node_modules (includes koffi native binary) ───────────────────
Source: "{#DistDir}\node_modules\*";        DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── Hikvision FPModule SDK DLL ────────────────────────────────────────────────
Source: "{#DistDir}\sdk\lib\FPModule_SDK_x64.dll"; DestDir: "{app}\sdk\lib"; Flags: ignoreversion

; ── Silent launcher VBScript ──────────────────────────────────────────────────
Source: "{#DistDir}\launch.vbs";            DestDir: "{app}"; Flags: ignoreversion

; ── Config template (only install if config\.env does not already exist) ──────
; AfterInstall handles this so existing production config is never overwritten.
Source: "{#DistDir}\config\.env.template";  DestDir: "{app}\config"; Flags: ignoreversion

[Code]
var
  TokenPage: TInputQueryWizardPage;

// ────────────────────────────────────────────────────────────────────────────
// Helper to read existing Terminal Token if upgrading
// ────────────────────────────────────────────────────────────────────────────
function GetExistingToken(): String;
var
  ConfigPath: String;
  Lines: TArrayOfString;
  I: Integer;
  Line: String;
begin
  Result := '';
  ConfigPath := WizardDirValue + '\config\.env';
  if FileExists(ConfigPath) then
  begin
    if LoadStringsFromFile(ConfigPath, Lines) then
    begin
      for I := 0 to GetArrayLength(Lines) - 1 do
      begin
        Line := Lines[I];
        if Pos('TERMINAL_TOKEN=', Line) = 1 then
        begin
          Result := Copy(Line, 16, Length(Line) - 15);
          Exit;
        end;
      end;
    end;
  end;
end;

// ────────────────────────────────────────────────────────────────────────────
// Helper to save or update Terminal Token in config\.env
// ────────────────────────────────────────────────────────────────────────────
procedure SaveTerminalToken(Token: String);
var
  Lines: TArrayOfString;
  I: Integer;
  FilePath: String;
  Found: Boolean;
begin
  FilePath := WizardDirValue + '\config\.env';
  if not FileExists(FilePath) then Exit;

  if LoadStringsFromFile(FilePath, Lines) then
  begin
    Found := False;
    for I := 0 to GetArrayLength(Lines) - 1 do
    begin
      if Pos('TERMINAL_TOKEN=', Lines[I]) = 1 then
      begin
        Lines[I] := 'TERMINAL_TOKEN=' + Token;
        Found := True;
        Break;
      end;
    end;
    if not Found then
    begin
      SetArrayLength(Lines, GetArrayLength(Lines) + 1);
      Lines[GetArrayLength(Lines) - 1] := 'TERMINAL_TOKEN=' + Token;
    end;
    SaveStringsToFile(FilePath, Lines, False);
  end;
end;

// ────────────────────────────────────────────────────────────────────────────
// Stop any running bridge process before upgrade
// ────────────────────────────────────────────────────────────────────────────
procedure StopBridge();
var
  ResultCode: Integer;
begin
  // Stop scheduled task (suppress errors — task may not exist yet on first install)
  Exec('schtasks.exe',
    '/End /TN "' + '{#TaskName}' + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Give it a moment to stop
  Sleep(1500);
end;

// ────────────────────────────────────────────────────────────────────────────
// Create config\.env from template if it does not already exist
// This preserves the customer's TERMINAL_TOKEN on upgrade
// ────────────────────────────────────────────────────────────────────────────
procedure CreateDefaultConfigIfMissing();
var
  ConfigPath: String;
  TemplatePath: String;
begin
  ConfigPath   := ExpandConstant('{app}\config\.env');
  TemplatePath := ExpandConstant('{app}\config\.env.template');
  if not FileExists(ConfigPath) then
  begin
    FileCopy(TemplatePath, ConfigPath, False);
    Log('Created default config from template: ' + ConfigPath);
  end
  else
  begin
    Log('Existing config preserved: ' + ConfigPath);
  end;
end;

// ────────────────────────────────────────────────────────────────────────────
// Create or replace the Windows Scheduled Task
// ────────────────────────────────────────────────────────────────────────────
procedure CreateScheduledTask();
var
  AppDir: String;
  TaskCmd: String;
  ResultCode: Integer;
begin
  AppDir  := ExpandConstant('{app}');
  // The task runs wscript.exe with launch.vbs (silent — no console window)
  // /F forces task creation even if it already exists
  TaskCmd := '/Create /F'
    + ' /TN "' + '{#TaskName}' + '"'
    + ' /TR "wscript.exe \"\"' + AppDir + '\launch.vbs\"\""'
    + ' /SC ONLOGON'
    + ' /RL HIGHEST'
    + ' /DELAY 0000:30';

  if not Exec('schtasks.exe', TaskCmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Log('WARNING: Failed to create scheduled task (ResultCode=' + IntToStr(ResultCode) + ')');
    MsgBox('Warning: Could not create the automatic startup task.' + #13#10 +
           'The bridge will NOT start automatically at login.' + #13#10 +
           'You can start it manually from: ' + AppDir + '\launch.vbs',
           mbInformation, MB_OK);
  end
  else
  begin
    Log('Scheduled task created successfully.');
  end;
end;

// ────────────────────────────────────────────────────────────────────────────
// Delete the scheduled task on uninstall
// ────────────────────────────────────────────────────────────────────────────
procedure DeleteScheduledTask();
var
  ResultCode: Integer;
begin
  Exec('schtasks.exe',
    '/End /TN "' + '{#TaskName}' + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
  Exec('schtasks.exe',
    '/Delete /F /TN "' + '{#TaskName}' + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Log('Scheduled task removed.');
end;

// ────────────────────────────────────────────────────────────────────────────
// Inno Setup Hooks
// ────────────────────────────────────────────────────────────────────────────
procedure InitializeWizard();
begin
  TokenPage := CreateInputQueryPage(wpSelectDir,
    'Terminal Authentication', 'Terminal Token Input',
    'Please enter the Terminal Token for this POS device.' + #13#10 +
    'You can find or generate this in the Qkarts Admin panel under Settings -> Terminal Tokens.');
  TokenPage.Add('Terminal Token:', False);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = TokenPage.ID then
  begin
    if TokenPage.Values[0] = '' then
    begin
      TokenPage.Values[0] := GetExistingToken();
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  // Stop any existing bridge before overwriting files
  StopBridge();
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    CreateDefaultConfigIfMissing();
    SaveTerminalToken(TokenPage.Values[0]);
    CreateScheduledTask();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    DeleteScheduledTask();
  end;
end;

[Run]
; Start the bridge immediately after installation (first run)
Filename: "wscript.exe"; Parameters: """{app}\launch.vbs"""; \
  Description: "Start Uplodd Hardware Bridge now"; \
  Flags: nowait postinstall skipifsilent runhidden; \
  StatusMsg: "Starting Uplodd Hardware Bridge..."

[UninstallRun]
; Stop bridge before uninstall
Filename: "schtasks.exe"; Parameters: "/End /TN ""{#TaskName}"""; \
  Flags: runhidden nowait; RunOnceId: "StopTask"
