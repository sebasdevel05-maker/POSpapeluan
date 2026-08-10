@echo off
title PAPELUAN POS - Servidor
cd /d "%~dp0"
echo ========================================
echo   PAPELUAN POS - Servidor Local
echo ========================================
echo.
echo NO CIERRE ESTA VENTANA
echo El servidor se detiene si la cierra.
echo.
node backend/server.js
pause
