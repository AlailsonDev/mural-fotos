@echo off
REM Libera a porta do Mural de Fotos no Firewall do Windows (somente redes PRIVADAS).
REM Execute com: clique direito -> "Executar como administrador".
setlocal
cd /d "%~dp0"
set PORT=3000
for /f "tokens=1,* delims==" %%a in ('findstr /b "PORT=" .env 2^>nul') do set PORT=%%b

net session >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Execute este arquivo como administrador:
  echo        clique com o botao direito em liberar-firewall.bat - "Executar como administrador".
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="Mural de Fotos" >nul 2>&1
netsh advfirewall firewall add rule name="Mural de Fotos" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
if errorlevel 1 (
  echo [ERRO] Nao foi possivel criar a regra.
) else (
  echo Regra criada: porta TCP %PORT% liberada para redes privadas e de dominio.
  echo Certifique-se de que a rede Wi-Fi do evento esta marcada como "Privada" no Windows.
)
pause
