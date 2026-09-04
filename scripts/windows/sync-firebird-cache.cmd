@echo off
setlocal

cd /d "%~dp0..\.."

set "CONFIG_FILE=%~dp0sync-firebird-cache.local"

if not exist "%CONFIG_FILE%" (
  echo Arquivo de configuracao nao encontrado: "%CONFIG_FILE%"
  echo Crie esse arquivo a partir de scripts\windows\sync-firebird-cache.local.example
  exit /b 1
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CONFIG_FILE%") do (
  if not "%%A"=="" set "%%A=%%B"
)

if "%FIREBIRD_CONNECTION_MODE%"=="" set "FIREBIRD_CONNECTION_MODE=direct"
if "%FIREBIRD_CACHE_TTL_SECONDS%"=="" set "FIREBIRD_CACHE_TTL_SECONDS=3600"
if "%FIREBIRD_STALE_CACHE_TTL_SECONDS%"=="" set "FIREBIRD_STALE_CACHE_TTL_SECONDS=86400"
if "%REDIS_CACHE_TIMEOUT_MS%"=="" set "REDIS_CACHE_TIMEOUT_MS=1500"

call :require DATABASE_URL || exit /b 1
call :require DB_HOST_FB || exit /b 1
call :require DB_PORT_FB || exit /b 1
call :require DB_PATH_FB || exit /b 1
call :require DB_USER_FB || exit /b 1
call :require DB_PASSWORD_FB || exit /b 1
call :require KV_REST_API_URL || exit /b 1
call :require KV_REST_API_TOKEN || exit /b 1

if not exist logs mkdir logs

echo [%date% %time%] Iniciando sincronizacao Firebird para Redis >> logs\firebird-cache-sync.log
call npm run sync:firebird-cache >> logs\firebird-cache-sync.log 2>&1
echo [%date% %time%] Sincronizacao finalizada com codigo %errorlevel% >> logs\firebird-cache-sync.log

exit /b %errorlevel%

:require
set "REQUIRED_VALUE="
call set "REQUIRED_VALUE=%%%~1%%"
if not defined REQUIRED_VALUE (
  echo Variavel obrigatoria ausente no arquivo local: %~1
  exit /b 1
)
exit /b 0
