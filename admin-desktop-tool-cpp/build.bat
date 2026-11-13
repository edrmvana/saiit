@echo off
rem ===========================================================================
rem  NOCTURNE Key Pass — сборка exe под Windows
rem
rem  Запуск:  build.bat
rem  Результат: dist\NOCTURNE-KeyPass.exe
rem
rem  Скрипт сам выбирает компилятор:
rem    1) MSVC (cl.exe) — запустите из "Developer Command Prompt for VS",
rem       либо установите Visual Studio Build Tools;
rem    2) MinGW-w64 (g++) — если MSVC не найден.
rem ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "OUTDIR=dist"
set "OUT=%OUTDIR%\NOCTURNE-KeyPass.exe"
set "SRC=src\main.cpp src\nc_core.cpp src\nc_paths.cpp src\nc_draw.cpp src\nc_view.cpp src\nc_platform.cpp"
set "LIBS=-lgdi32 -luser32 -lgdiplus -ldwmapi -lole32 -lshell32 -lcomctl32"

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

where cl >nul 2>nul
if "%ERRORLEVEL%"=="0" goto msvc
goto mingw

:msvc
echo [build] Найден MSVC, компилирую...
cl /nologo /std:c++17 /O2 /EHsc /MT /utf-8 /W3 /permissive- ^
   /DUNICODE /D_UNICODE /D_CRT_SECURE_NO_WARNINGS ^
   /Fo:"%OUTDIR%\\" /Fe:"%OUT%" %SRC% ^
   /link gdiplus.lib dwmapi.lib shell32.lib ole32.lib user32.lib gdi32.lib comctl32.lib ^
   /SUBSYSTEM:WINDOWS
if "%ERRORLEVEL%"=="0" goto ok
echo [build] MSVC завершился с ошибкой, пробую MinGW...

:mingw
where g++ >nul 2>nul
if not "%ERRORLEVEL%"=="0" goto nocompiler
echo [build] Найден g++ (MinGW-w64), компилирую...
g++ -std=c++17 -O2 -mwindows -static -o "%OUT%" %SRC% %LIBS%
if "%ERRORLEVEL%"=="0" goto ok
echo [build] Ошибка компиляции.
exit /b 1

:nocompiler
echo.
echo [build] Не найден компилятор C++.
echo Установите один из вариантов и запустите build.bat снова:
echo   * Visual Studio Build Tools (C++), запуск из "Developer Command Prompt";
echo   * MinGW-w64  (https://www.mingw-w64.org/)  — g++ должен быть в PATH.
exit /b 1

:ok
echo.
echo [build] Готово: %OUT%
for %%F in ("%OUT%") do echo [build] Размер: %%~zF байт
exit /b 0
