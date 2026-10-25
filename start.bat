@echo off
chcp 65001 > nul
cd /d "%~dp0"
title VNPT HIS - Quan ly & Cau hinh Tram Y Te
echo ======================================================================
echo    VNPT HIS MULTI-STATION HUB - QUAN LY CAU HINH TRAM Y TE
echo ======================================================================
echo.
echo Dang khoi dong may chu Web Tool...
echo Dia chi truy cap: http://localhost:5000
echo.

start "" http://localhost:5000

node server/index.js

pause
