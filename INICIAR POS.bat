@echo off
title Sistema POS - PAPELUAN
color 0A

echo.
echo  =============================================
echo       SISTEMA POS - PAPELUAN
echo  =============================================
echo.

cd /d "%~dp0"

:: Verificar que node existe
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  ERROR: Node.js no esta instalado.
    echo  Descargalo en: https://nodejs.org
    pause
    exit /b 1
)

:: Verificar node_modules
if not exist node_modules (
    echo  Instalando dependencias...
    npm install
    echo.
)

:: Obtener IP local para acceso desde tablet/celular
echo  Iniciando servidor...
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr "192.168"') do (
    set IP=%%a
)
set IP=%IP: =%

echo  =============================================
echo   EN ESTE PC:
echo     http://localhost:3000
echo.
echo   DESDE TABLET O CELULAR (misma WiFi):
echo     http://%IP%:3000
echo  =============================================
echo.
echo  (No cierres esta ventana mientras uses el POS)
echo.

:: Abrir navegador despues de 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

:: Iniciar servidor escuchando en todas las interfaces
node backend/server.js

pause
