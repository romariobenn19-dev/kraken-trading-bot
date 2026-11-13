' Movie Night launcher - starts the app with no black window.
'   wscript launch.vbs --open        start (if needed) and open the app in the browser
'   wscript launch.vbs --background  start quietly (used at Windows login)
Option Explicit
Dim sh, fso, dir, node, mode, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
mode = "--open"
If WScript.Arguments.Count > 0 Then mode = WScript.Arguments(0)
If mode <> "--background" Then mode = "--open"

node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node"

sh.CurrentDirectory = dir
cmd = "cmd /c """"" & node & """ server.js " & mode & " >> movie-night.log 2>&1"""
sh.Run cmd, 0, False
