@echo off
REM VisionOne VMS – zagon v Docker Desktop (Windows)
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul && echo Ustvarjena datoteka .env – preglejte gesla, HOST_IP in TUNNEL_TOKEN.
set PROFILI=
findstr /r /c:"^TUNNEL_TOKEN=..*" .env >nul && set PROFILI=--profile tunel
docker compose %PROFILI% up -d --build
echo.
echo VisionOne View:   http://localhost:8080/view/
echo VisionOne Admin:  http://localhost:8080/admin/
if defined PROFILI echo Od zunaj:         https://vms.visionone.si/
pause
