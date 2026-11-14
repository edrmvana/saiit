@echo off
setlocal
cd /d "%~dp0"

if not exist build mkdir build

where cl >nul 2>nul
if %errorlevel%==0 goto msvc

where g++ >nul 2>nul
if %errorlevel%==0 goto mingw

echo.
echo Компилятор не найден.
echo Откройте "x64 Native Tools Command Prompt for VS" или установите MinGW-w64
echo и добавьте его bin в PATH.
echo.
pause
exit /b 1

:msvc
echo [1/2] Сборка MSVC...
cl /nologo /utf-8 /EHsc /O2 /DUNICODE /D_UNICODE /W3 src\main.cpp /Fo:build\ /Fe:build\NocturneOwnerKey.exe /link /SUBSYSTEM:WINDOWS ws2_32.lib bcrypt.lib user32.lib gdi32.lib shell32.lib
if errorlevel 1 goto fail
goto done

:mingw
echo [1/2] Сборка MinGW-w64...
g++ -std=c++17 -O2 -Wall -DUNICODE -D_UNICODE -municode -Wl,--subsystem,windows -o build\NocturneOwnerKey.exe src\main.cpp -lws2_32 -lbcrypt -luser32 -lgdi32 -lshell32 -static-libgcc -static-libstdc++ -s
if errorlevel 1 goto fail
goto done

:done
copy /y build\NocturneOwnerKey.exe NocturneOwnerKey.exe >nul
echo.
echo Готово: %CD%\NocturneOwnerKey.exe
echo Запустите приложение и нажмите «Сгенерировать код».
exit /b 0

:fail
echo.
echo Сборка не удалась.
pause
exit /b 1
