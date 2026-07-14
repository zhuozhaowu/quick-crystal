@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-local.ps1"
if errorlevel 1 pause
