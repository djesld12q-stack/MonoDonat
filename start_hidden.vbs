' Запускаємо Node.js сервер у поточній папці
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
' Переходимо в директорію, де лежить цей .vbs
WshShell.CurrentDirectory = FSO.GetParentFolderName(WScript.ScriptFullName)
' Запускаємо node server.js у прихованому режимі
WshShell.Run "cmd /c node server.js", 0, False