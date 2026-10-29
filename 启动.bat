@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 3D PHOTO WALL - local server
color 0A

echo.
echo  ==============================================================
echo    3D PHOTO WALL   -   local server
echo  ==============================================================
echo.
echo    Starting local server, browser will open by itself...
echo    KEEP THIS WINDOW OPEN  ( closing it = stop the server )
echo.
echo  ==============================================================
echo.

set "PY="

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)

if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)

if not defined PY (
  where python3 >nul 2>nul
  if not errorlevel 1 set "PY=python3"
)

if not defined PY (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%D\python.exe" set "PY=%%D\python.exe"
  )
)

if not defined PY (
  if exist "C:\Python313\python.exe" set "PY=C:\Python313\python.exe"
)

if not defined PY (
  if exist "C:\Python312\python.exe" set "PY=C:\Python312\python.exe"
)

if not defined PY (
  if exist "C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe" set "PY=C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe"
)

if not defined PY goto NOPY

echo    using: %PY%
echo.
%PY% -u server.py 8765

echo.
echo  --------------------------------------------------------------
echo    Server stopped. Double-click this file to start again.
echo  --------------------------------------------------------------
echo.
pause
goto :eof


:NOPY
echo.
echo   [X] Python not found on this computer, so the server cannot start.
echo.
echo   Fix: install Python from  https://www.python.org/downloads/
echo        IMPORTANT: tick "Add python.exe to PATH" during install,
echo        then double-click this file again.
echo.
echo   Without the server: gesture / video / folder scan will NOT work.
echo.
start "" "https://www.python.org/downloads/"
pause
