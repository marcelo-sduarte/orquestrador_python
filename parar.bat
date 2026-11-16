@echo off
rem ============================================================================
rem  Orquestrador V2 - encerra as janelas abertas pelo iniciar.bat
rem
rem  Atencao: robos em execucao sao encerrados junto com o worker. Ao iniciar de
rem  novo, essas execucoes aparecem como "ERRO - Interrompido: worker reiniciado".
rem  Para esperar os robos terminarem, use Ctrl+C na janela do worker.
rem ============================================================================
for %%J in ("Orquestrador - Front" "Orquestrador - API" "Orquestrador - Worker") do (
    taskkill /FI "WINDOWTITLE eq %%~J*" /T /F >nul 2>nul && echo Encerrado: %%~J
)
echo Pronto.
