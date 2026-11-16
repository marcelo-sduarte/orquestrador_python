@echo off
rem ============================================================================
rem  Orquestrador V2 - inicia API (que tambem serve o front) e worker
rem
rem    iniciar.bat          API + worker (front compilado servido em http://localhost:3001)
rem    iniciar.bat build    recompila o front antes (npm run build) e inicia
rem    iniciar.bat dev      API + worker + front em modo desenvolvimento (http://localhost:5173)
rem
rem  Cada parte abre numa janela propria. Para parar: parar.bat (ou Ctrl+C em cada janela).
rem ============================================================================
setlocal
cd /d "%~dp0"
set "PY=%~dp0env\Scripts\python.exe"

if not exist "%PY%" (
    echo [ERRO] Ambiente Python nao encontrado em %PY%
    echo        Crie com:  python -m venv env
    echo                   env\Scripts\pip install -r worker\requirements.txt -r api\requirements.txt
    pause & exit /b 1
)
if not exist "api\.env"    echo [AVISO] api\.env nao existe - copie de api\.env.example
if not exist "worker\.env" echo [AVISO] worker\.env nao existe - copie de worker\.env.example

rem ---- front: compila se pedido ou se ainda nao existe front\dist
if /i "%~1"=="build" goto compilar
if not exist "front\dist\index.html" if /i not "%~1"=="dev" goto compilar
goto iniciar

:compilar
where npm >nul 2>nul || (echo [AVISO] npm nao encontrado: front nao compilado. Instale o Node.js ou copie front\dist pronto. & goto iniciar)
echo Compilando o front...
pushd front
if not exist "node_modules" call npm install
call npm run build || (echo [ERRO] Falha ao compilar o front & popd & pause & exit /b 1)
popd

:iniciar
echo Iniciando a API...
start "Orquestrador - API" cmd /k ""%PY%" api\main.py"

echo Iniciando o worker...
start "Orquestrador - Worker" cmd /k ""%PY%" worker\worker.py"

if /i "%~1"=="dev" (
    echo Iniciando o front em modo desenvolvimento...
    start "Orquestrador - Front" cmd /k "cd /d front && npm run dev"
    timeout /t 5 >nul
    start "" http://localhost:5173
) else (
    timeout /t 3 >nul
    start "" http://localhost:3001
)

echo.
echo Pronto. Feche esta janela ou use parar.bat para encerrar tudo.
endlocal
