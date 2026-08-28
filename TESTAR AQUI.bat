@echo off
title Contagens ROTTA400 - servidor de teste
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
echo.
echo O servidor parou.
pause
