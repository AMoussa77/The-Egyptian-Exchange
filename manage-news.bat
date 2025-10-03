@echo off
echo.
echo ========================================
echo   📰 Egyptian Exchange News Manager
echo ========================================
echo.

if "%1"=="" (
    echo Usage: manage-news.bat [command] [options]
    echo.
    echo Commands:
    echo   add       Add new news item
    echo   list      List all news items  
    echo   remove    Remove news item by ID
    echo   read      Mark all news as read
    echo   help      Show detailed help
    echo.
    echo Examples:
    echo   manage-news.bat add
    echo   manage-news.bat list
    echo   manage-news.bat help
    echo.
    pause
    exit /b
)

if "%1"=="add" (
    if "%2"=="" (
        echo 📰 Adding New News Item
        echo.
        set /p title="Enter news title: "
        set /p content="Enter news content: "
        set /p category="Enter category (breaking/important/update/general): "
        if "!category!"=="" set category=general
        node news-manager.js add "!title!" "!content!" "!category!"
    ) else (
        node news-manager.js add %2 %3 %4
    )
    goto end
)

if "%1"=="list" (
    node news-manager.js list
    goto end
)

if "%1"=="remove" (
    if "%2"=="" (
        echo First, let's see all news items:
        echo.
        node news-manager.js list
        echo.
        set /p id="Enter news ID to remove: "
        node news-manager.js remove "!id!"
    ) else (
        node news-manager.js remove %2
    )
    goto end
)

if "%1"=="read" (
    node news-manager.js read
    goto end
)

if "%1"=="help" (
    node news-manager.js help
    goto end
)

echo Unknown command: %1
echo Use 'manage-news.bat help' for usage information.

:end
echo.
pause
