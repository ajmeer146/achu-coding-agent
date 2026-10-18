' Launches AchuAgentTray.ps1 silently without a console window
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
Ps1Path = ScriptDir & "\AchuAgentTray.ps1"
WshShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & Ps1Path & """", 0, False
