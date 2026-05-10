' MonoDonaty — прихований запуск
' Запускає watcher.js, який сам керує server.js
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Переходимо в директорію де лежить цей .vbs
Dim dir
dir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = dir

' Зупиняємо старі процеси node якщо були
WshShell.Run "cmd /c taskkill /F /IM node.exe >nul 2>&1", 0, True

' Запускаємо watcher.js у прихованому режимі
' watcher сам запустить server.js і стежитиме за браузером
WshShell.Run "cmd /c node watcher.js", 0, False
