@echo off
chcp 65001 >nul
cd /d "%~dp0"
node run.mjs stop
timeout /t 2 >nul
echo.
echo (已停止) 按任意键关闭
pause >nul
