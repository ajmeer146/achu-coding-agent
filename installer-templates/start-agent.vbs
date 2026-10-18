' Achu Local Agent Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
AppDir = FSO.GetParentFolderName(ScriptDir)
NodeExe = AppDir & "\bin\node.exe"
ServerMjs = AppDir & "\server.mjs"

' Check if agent is already responding on port 3001
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 1000, 1000, 1000, 1000
http.Open "GET", "http://127.0.0.1:3001/health", False
http.Send
If Err.Number = 0 Then
  If http.Status = 200 Then
    ' Already running, no need to start another instance
    WScript.Quit 0
  End If
End If
On Error Goto 0

' Start server in background without console window (0 = hidden)
WshShell.CurrentDirectory = AppDir
WshShell.Run """" & NodeExe & """ """ & ServerMjs & """", 0, False
