@echo off
setlocal
cd /d "%~dp0"
title Mural de Fotos - Servidor

echo ================================================================
echo   MURAL DE FOTOS - INICIANDO
echo ================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Execute install.bat primeiro.
  pause
  exit /b 1
)

echo [1/4] Verificando dependencias...
if not exist "node_modules\next\package.json" (
  echo   Dependencias nao instaladas. Executando a instalacao...
  call install.bat
  if errorlevel 1 exit /b 1
)
if not exist "node_modules\sharp\package.json" (
  echo   Dependencias incompletas. Reinstalando...
  call npm install --no-audit --no-fund
)

echo [2/4] Verificando pastas...
if not exist data mkdir data
if not exist data\events mkdir data\events
if not exist data\config mkdir data\config
if not exist data\logs mkdir data\logs
if not exist data\tmp mkdir data\tmp

echo [3/4] Verificando configuracoes...
if not exist .env (
  echo   Arquivo .env nao encontrado. Iniciando o assistente de configuracao...
  call npm run setup
)
findstr /r /c:"^ADMIN_PASSWORD_HASH=scrypt" .env >nul 2>nul
if errorlevel 1 (
  echo   [AVISO] Senha administrativa nao configurada. Execute: npm run set-password
)
if not exist ".next\BUILD_ID" (
  echo   Interface ainda nao compilada. Compilando...
  call npm run build
  if errorlevel 1 (
    echo [ERRO] Falha ao compilar a interface.
    pause
    exit /b 1
  )
)

echo [4/4] Iniciando o servidor...
echo.

:loop
call npm start
echo.
echo O servidor foi encerrado. Reiniciando em 5 segundos...
echo (Para sair definitivamente, feche esta janela.)
timeout /t 5 /nobreak >nul
goto loop
