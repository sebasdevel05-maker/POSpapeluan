@echo off
title Sistema POS - PAPELUAN (Acceso Remoto)
color 0B

echo.
echo  =============================================
echo   SISTEMA POS - PAPELUAN (ACCESO REMOTO)
echo  =============================================
echo.

cd /d "%~dp0"

:: Verificar node
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  ERROR: Node.js no esta instalado.
    pause
    exit /b 1
)

:: Verificar node_modules
if not exist node_modules (
    echo  Instalando dependencias...
    npm install
    echo.
)

:: Buscar ngrok: primero en la carpeta local, luego en el sistema
set NGROK=%~dp0ngrok.exe
if not exist "%NGROK%" (
    for /f "delims=" %%i in ('where ngrok 2^>nul') do set NGROK=%%i
)
if not exist "%NGROK%" (
    echo  ERROR: ngrok no encontrado.
    echo  Coloca ngrok.exe en esta misma carpeta.
    pause
    exit /b 1
)

:: Iniciar servidor Node en segundo plano
echo  [1/2] Iniciando servidor POS...
start /b node backend/server.js
timeout /t 2 /nobreak >nul

:: Abrir navegador local
start http://localhost:3000

:: Iniciar ngrok
echo  [2/2] Creando enlace publico con ngrok...
echo.
echo  =============================================
echo   Busca la linea "Forwarding" abajo.
echo   Ese link (https://xxxx.ngrok-free.app) es
echo   el que debes abrir en la tablet.
echo  =============================================
echo.

"%NGROK%" http 3000

pause
