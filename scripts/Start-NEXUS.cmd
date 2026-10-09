@echo off
cd /d "%~dp0.."
docker compose -f compose.dev.yaml up -d
if errorlevel 1 goto failed
docker start nexus-yms-jdbc
if errorlevel 1 goto failed
node scripts/local-supervisor.cjs
pause
exit /b
:failed
echo Please start Docker Desktop and run this shortcut again.
pause
exit /b 1
