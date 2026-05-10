@echo off
cd /d "%~dp0"
:: Зупиняємо старий процес node.exe (якщо був)
taskkill /F /IM node.exe >nul 2>&1
:: Запускаємо server.js у новому cmd-вікні
start "" cmd /k "node server.js"
:: Запускаємо додатковий скрипт start_hidden.vbs
cscript //nologo "%~dp0\start_hidden.vbs"
exit