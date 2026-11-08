' start-hidden.vbs — 完全隱藏視窗在背景跑（不建議：看不到進度）
' 想恢復視窗版就用桌面「抽獎-開始」或 start.ps1
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & here & "start.ps1"" -NoPause", 0, False
