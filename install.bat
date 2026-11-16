@echo off
setlocal
cd /d "%~dp0"
title Mural de Fotos - Instalacao

echo ================================================================
echo   MURAL DE FOTOS - INSTALACAO
echo ================================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado neste computador.
  echo.
  echo   1. Acesse https://nodejs.org e baixe a versao "LTS".
  echo   2. Instale com as opcoes padrao.
  echo   3. Feche esta janela e execute install.bat novamente.
  echo.
  start "" "https://nodejs.org/pt-br/download"
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 20 (
  echo [ERRO] Sua versao do Node.js e antiga. Instale a versao LTS 20 ou superior em https://nodejs.org
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Node.js encontrado: %%v
echo.

echo [1/4] Instalando dependencias (pode levar alguns minutos)...
if exist package-lock.json (
  call npm ci --no-audit --no-fund
) else (
  call npm install --no-audit --no-fund
)
if errorlevel 1 (
  echo [ERRO] Falha ao instalar as dependencias. Verifique a conexao com a internet e tente novamente.
  pause
  exit /b 1
)

echo.
echo [2/4] Criando pastas de dados...
if not exist data mkdir data
if not exist data\events mkdir data\events
if not exist data\config mkdir data\config
if not exist data\logs mkdir data\logs
if not exist data\tmp mkdir data\tmp

echo.
echo [3/4] Configuracao (senha administrativa, porta e endereco publico)...
call npm run setup
if errorlevel 1 (
  echo [ERRO] A configuracao nao foi concluida.
  pause
  exit /b 1
)

echo.
echo [4/4] Compilando a interface...
call npm run build
if errorlevel 1 (
  echo [ERRO] Falha ao compilar a interface.
  pause
  exit /b 1
)

echo.
echo ================================================================
echo   Instalacao concluida!
echo   Para iniciar o sistema, execute start.bat
echo   Para liberar o acesso dos celulares no firewall, execute
echo   liberar-firewall.bat (clique direito - Executar como administrador)
echo ================================================================
echo.
pause
