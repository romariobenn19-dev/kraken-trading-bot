' Movie Night launcher - starts the app with no black window.
'   wscript launch.vbs --open        start (if needed) and open the app in the browser
'   wscript launch.vbs --background  start quietly (used at Windows login)
Option Explicit
Const APP_URL = "http://localhost:8080/"
Dim sh, fso, dir, node, mode, i

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
mode = "--open"
If WScript.Arguments.Count > 0 Then mode = WScript.Arguments(0)

' Is Movie Night already answering?
Function ServerUp()
  Dim x
  On Error Resume Next
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 1500, 1500, 1500, 1500
  x.open "GET", "http://127.0.0.1:8080/api/movies", False
  x.send
  ServerUp = (Err.Number = 0 And x.status = 200)
  Err.Clear
  On Error GoTo 0
End Function

If Not ServerUp() Then
  node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
  If Not fso.FileExists(node) Then node = "node"
  sh.CurrentDirectory = dir
  sh.Run "cmd /c """"" & node & """ server.js --background >> movie-night.log 2>&1""", 0, False
  If mode = "--background" Then WScript.Quit
  ' Wait up to 20 seconds for it to start.
  For i = 1 To 40
    WScript.Sleep 500
    If ServerUp() Then Exit For
  Next
  If Not ServerUp() Then
    MsgBox "Movie Night didn't start." & vbCrLf & vbCrLf & _
      "Double-click start-movie-night.bat in the Movie Night folder to see what's wrong," & vbCrLf & _
      "or look at movie-night.log in that folder.", vbExclamation, "Movie Night"
    WScript.Quit
  End If
End If

If mode <> "--background" Then sh.Run APP_URL
