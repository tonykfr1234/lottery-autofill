@echo off
chcp 65001 >nul
cd /d "%~dp0"
node run.mjs run %*
echo.
echo (结束) 按任意键关闭
pause >nul
