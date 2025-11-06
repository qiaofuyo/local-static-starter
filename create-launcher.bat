@echo off
:: create-launcher.bat - 一键为静态资源目录生成 VBS 启动器 + 桌面快捷方式
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: 颜色定义
set "GREEN=[92m"
set "YELLOW=[93m"
set "RED=[91m"
set "CYAN=[96m"
set "RESET=[0m"

echo %CYAN%=============================================%RESET%
echo %CYAN%     本地静态服务器启动器生成工具           %RESET%
echo %CYAN%=============================================%RESET%
echo.

:: 获取当前脚本所在目录（server.mjs 所在目录）
set "scriptDir=%~dp0"
set "scriptDir=!scriptDir:~0,-1!"  :: 去掉末尾 \

:: server.mjs 绝对路径
set "serverMjs=!scriptDir!\server.mjs"

:: 检查 server.mjs 是否存在
if not exist "!serverMjs!" (
    echo %YELLOW%[警告] 未找到 server.mjs，将不会启动服务！%RESET%
    echo %YELLOW%请将 server.mjs 放在: !serverMjs!%RESET%
)

echo %YELLOW%server.mjs 位置: !serverMjs!%RESET%
echo.

:INPUT_DIR
set "webDir="
set /p "webDir=请输入静态资源目录路径（例如 D:\proj\dist）: "

if "!webDir!"=="" (
    echo %RED%[错误] 路径不能为空！%RESET%
    goto INPUT_DIR
)

:: 去除首尾引号和空格
set "webDir=!webDir:"=!"
set "webDir=!webDir: =!"

:: 检查目录是否存在
if not exist "!webDir!" (
    echo %RED%[错误] 目录不存在: !webDir!%RESET%
    goto INPUT_DIR
)

:: 规范化路径（Resolve-Path 类似）
for %%I in ("!webDir!") do set "absDir=%%~fI"
set "webDir=!absDir!"

echo.
echo %GREEN%静态资源目录: !webDir!%RESET%
echo.

:: ================== 生成 .vbs 文件 ==================
:: 提取最后一层目录名（如 dist）
for %%I in ("!webDir!") do set "webDirName=%%~nxI"
set "vbsFile=!webDir!\!webDirName!.vbs"
echo %YELLOW%正在生成启动脚本: !vbsFile!%RESET%

:: 使用 echo 将 VBS 内容写入 ANSI 临时文件
set "tempVbsFile=!webDir!\temp_ansi_vbs.tmp"
(
echo port = 3000
echo webDir = "!webDir!"
echo shutdownDelayMs = 500
echo.
echo serverPath = "!serverMjs!"
echo strCommand = "node " ^& serverPath ^& " " _
echo            ^& "--port " ^& port ^& " " _
echo            ^& "--web-dir """ ^& webDir ^& """ " _
echo            ^& "--shutdown-delay-ms " ^& shutdownDelayMs
echo.
echo Set objShell = CreateObject^("WScript.Shell"^)
echo objShell.Run strCommand, 0, False
echo.
echo Set objShell = Nothing
) > "!tempVbsFile!"
:: 使用 PowerShell 脚本块写入 UTF-16
PowerShell -NoProfile -ExecutionPolicy Bypass -Command ^
"$temp = '%tempVbsFile%'; ^
$vbs = '%vbsFile%'; ^
if (Test-Path $temp) { ^
  $content = Get-Content -Path $temp -Encoding UTF8; ^
  [System.IO.File]::WriteAllLines($vbs, $content, [System.Text.Encoding]::Unicode); ^
  Remove-Item $temp -Force; ^
} else { ^
  Write-Error '临时文件不存在'; exit 1; ^
}"

if exist "!vbsFile!" (
    echo %GREEN%[成功] VBS 启动器已创建: !vbsFile!%RESET%
) else (
    echo %RED%[失败] 创建 VBS 文件失败！%RESET%
    pause
    exit /b 1
)

:: ================== 创建快捷方式 ==================
set "lnkName=!webDirName!"
set "lnkPath=!webDir!\!lnkName!.lnk"
:: 调用 PowerShell 获取真实桌面路径
FOR /F "usebackq" %%f IN (`PowerShell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) DO (
    :: 2. 直接将桌面路径 (%%f) 和快捷方式名称组合
    set "desktop=%%f\!lnkName!.lnk"
)

echo %YELLOW%正在创建快捷方式...%RESET%

:: 使用 PowerShell 创建无格式名快捷方式（图标为文件夹图标）
powershell -NoProfile -Command ^
"$ws = New-Object -ComObject WScript.Shell; ^
$lnk = $ws.CreateShortcut('%lnkPath%'); ^
$lnk.TargetPath = 'wscript.exe'; ^
$lnk.Arguments = '\""%vbsFile%\""%'; ^
$lnk.WorkingDirectory = '%webDir%'; ^
$lnk.IconLocation = 'shell32.dll,2'; ^
$lnk.Description = '启动本地静态服务器'; ^
$lnk.Save();"

if exist "!lnkPath!" (
    echo %GREEN%[成功] 快捷方式已创建: !lnkPath!%RESET%
) else (
    echo %RED%[失败] 创建快捷方式失败！%RESET%
    pause
    exit /b 1
)

:: ================== 复制到桌面 ==================
copy "!lnkPath!" "%desktop%" >nul
if exist "%desktop%" (
    echo %GREEN%[成功] 快捷方式已复制到桌面！%RESET%
) else (
    echo %RED%[失败] 复制到桌面失败！%RESET%
)

echo.
echo %CYAN%=============================================%RESET%
echo %GREEN%  全部完成！双击桌面 “启动服务器” 即可运行%RESET%
echo %CYAN%=============================================%RESET%
echo.
pause