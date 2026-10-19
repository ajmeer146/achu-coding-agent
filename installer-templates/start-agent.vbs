' Achu Local Agent Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
AppDir = FSO.GetParentFolderName(ScriptDir)
NodeExe = AppDir & "\bin\node.exe"
ServerMjs = AppDir & "\server.mjs"
TrayVbs = ScriptDir & "\start-tray.vbs"
UserProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
LogDir = UserProfile & "\.achu"
If Not FSO.FolderExists(LogDir) Then
  On Error Resume Next
  FSO.CreateFolder(LogDir)
  On Error Goto 0
End If
LogFile = LogDir & "\agent.log"

' Check if agent is already responding on port 3001
AgentRunning = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 1000, 1000, 1000, 1000
http.Open "GET", "http://127.0.0.1:3001/health", False
http.Send
If Err.Number = 0 Then
  If http.Status = 200 Then
    AgentRunning = True
  End If
End If
On Error Goto 0

' Start server in background if not already running (0 = hidden)
If Not AgentRunning Then
  WshShell.CurrentDirectory = AppDir
  WshShell.Run """" & NodeExe & """ """ & ServerMjs & """", 0, False
End If

' Ensure system tray manager is running
If FSO.FileExists(TrayVbs) Then
  WshShell.Run """" & TrayVbs & """", 0, False
End If
