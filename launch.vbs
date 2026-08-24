' ============================================================
' Squirrel Hardware Bridge - Silent Launcher
' ============================================================
' Starts node.exe with no visible console window (window style 0).
' Called by the Windows Scheduled Task at user logon.
' ============================================================

Dim fso, oShell, strAppDir, strNodeExe, strScript, strCmd

Set fso   = CreateObject("Scripting.FileSystemObject")
Set oShell = CreateObject("WScript.Shell")

' This script lives in the app root, next to node\ and build\
strAppDir  = fso.GetParentFolderName(WScript.ScriptFullName)
strNodeExe = strAppDir & "\node\node.exe"
strScript  = strAppDir & "\build\index.js"

' Validate node.exe exists before attempting to launch
If Not fso.FileExists(strNodeExe) Then
  MsgBox "Squirrel Hardware Bridge: node.exe not found at:" & vbCrLf & _
         strNodeExe & vbCrLf & vbCrLf & _
         "Please reinstall Squirrel Hardware Bridge.", _
         vbCritical, "Squirrel Hardware Bridge"
  WScript.Quit 1
End If

' Set working directory to app root so __dirname resolves correctly
oShell.CurrentDirectory = strAppDir

' Window style 0 = completely hidden (no console window)
' False = do not wait for the process to finish
oShell.Run """" & strNodeExe & """ """ & strScript & """", 0, False

Set oShell = Nothing
Set fso    = Nothing
