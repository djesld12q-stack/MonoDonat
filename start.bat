@echo off
cd /d "%~dp0"
:: Зупиняємо старі процеси
taskkill /F /IM node.exe >nul 2>&1
:: Запускаємо watcher (він підніме server.js сам)
start "" cmd /k "node watcher.js"
