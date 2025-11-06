# 本地静态服务启动器

这是一个**一键启动本地静态服务器**的工具集，满足约束——**不修改静态资源、右键文件夹启动（隐藏窗口）、自动打开浏览器、当页面关闭时自动退出、支持同时启动多个服务实例**。

下面说明清楚：用途、文件清单、如何使用、实现原理、调试与故障排查、常用配置、常见改动点。

---

## 适用场景

- 有已构建好的前端应用（一般默认构建产物位置：`dist` ）。

- 想本地快速启动静态服务用于演示测试录屏，不希望改动原有资源。

- 需要右键任意文件夹即可启动（Windows），后台隐藏运行、自动打开浏览器，且在浏览器页面关闭后自动退出服务。

- 或者通过一键生成桌面快捷方式启动，无需注册右键菜单。

---

## 文件清单（位于仓库根目录）

> 前置依赖：Node.js (建议 v22.19.0+) 需在系统 PATH 中可执行。

- `server.mjs` —— Node 静态服务器主程序（动态在返回的 `index.html` 中注入 SSE 客户端脚本，支持端口自动避让、占用弹窗提示）。

- `launcher_server.vbs` —— 右键菜单调用脚本，接收右键文件夹路径，隐藏运行 Node 服务。

- `launcher_server_debug.vbs` —— 调试用启动器（固定路径 `D:\03_Tools\白板\dist\apps\web`，可见窗口运行，显示控制台日志）。

- `create-launcher.bat` —— 一键为任意静态资源目录生成 `.vbs` 启动器 + 目录内快捷方式 + 桌面快捷方式。

- `install-menu.bat` —— 注册右键菜单，一键添加“启动本地服务器”到文件夹右键菜单。

- `uninstall-menu.bat` —— 卸载右键菜单，移除注册表项。

---

## 快速开始

### 方式一：注册右键菜单（全局可用）

1. 下载本项目到任意目录（如 `D:\tools\local-server`）
2. 右键 `install-menu.bat` → “以管理员身份运行”
3. 成功后，任意文件夹右键将出现：**启动本地服务器**
4. 右键目标文件夹（如 `dist`）→ **启动本地服务器**
5. 浏览器自动打开 `http://127.0.0.1:3000`（或自动分配的空闲端口）
6. 关闭所有标签页 → 服务器自动退出

> 卸载：右键 `uninstall-menu.bat` → 以管理员身份运行

---

### 方式二：一键生成快捷方式（推荐，免注册表）

1. 将 `server.mjs` 和 `create-launcher.bat` 放在同一目录
   └─ `D:\tools\local-server\`
2. 双击运行 `create-launcher.bat`
3. 输入静态资源目录路径
   └─ `D:\myapp\dist`

→ 自动生成：

```text
├─ D:\myapp\dist\dist.vbs          （启动脚本）
├─ D:\myapp\dist\dist.lnk          （目录内快捷方式）
└─ 桌面\dist.lnk                   （桌面快捷方式）
```

4. 双击桌面 `dist.lnk` → 启动服务

> 优点：无需管理员权限、无注册表修改、可为每个项目独立生成

---

### 方式三：调试模式（查看日志）

双击 `launcher_server_debug.vbs`：

- 使用固定路径 `D:\03_Tools\白板\dist\apps\web`
- **可见命令行窗口**运行，实时显示 Node 日志
- 按 `Ctrl+C` 或关闭窗口即可停止

---

## 常用配置（通过命令行参数）

`server.mjs` 支持以下参数（由启动器自动传递）：

| 参数                    | 说明              | 默认值     | 示例                         |
| --------------------- | --------------- | ------- | -------------------------- |
| `--port`              | 起始端口            | `3000`  | `--port 4000`              |
| `--web-dir`           | **必填：** 静态资源目录  | 无       | `--web-dir "D:\proj\dist"` |
| `--shutdown-delay-ms` | 无客户端后延迟关闭时间（ms） | `500`   | `--shutdown-delay-ms 1000` |
| `--debug-mode`        | 启用调试（保留控制台窗口）   | `false` | `--debug-mode`             |

---

## 实现要点与原理

| 功能            | 实现方式                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| **不修改静态资源**   | `server.mjs` 在内存中动态注入 SSE 脚本到 `index.html`（`</body>` 前）                   |
| **右键启动（零闪烁）** | `launcher_server.vbs` → 隐藏运行 `node server.mjs ...`（`objShell.Run ..., 0`） |
| **快捷方式启动**    | `create-launcher.bat` 生成 `.vbs` + `.lnk`，双击即启动                            |
| **自动打开浏览器**   | `server.mjs` 监听成功后调用 `cmd /c start http://...`（Win）                       |
| **自动退出**      | SSE 长连接跟踪客户端，`sseClients.size === 0` 后延迟 `shutdownDelayMs` 退出             |
| **端口自动避让**    | 端口被占用 → 自动 +1 重试（最多 +10），并**弹窗提示占用程序 + 终止命令**                             |
| **优雅关闭**      | 支持 `Ctrl+C`、浏览器关闭、窗口关闭                                                    |

### SSE 注入代码（关键）

```js
<script>
(function(){
  try {
    const es = new EventSource('/_sse');
    window.__drawnix_sse = es;
    window.addEventListener('beforeunload', ()=> { try { es.close(); } catch(e){} });
  } catch(e) {
    console.warn('SSE injection failed', e);
  }
})();
</script>
```

- 注入到 `<body>` 前
- 建立到 `/_sse` 的长连接
- 页面关闭 → 连接断开 → 服务端检测并退出

---

## 故障排查（常见问题）

| 问题           | 原因                         | 解决方法                                        |
| ------------ | -------------------------- | ------------------------------------------- |
| 右键无反应        | 未以管理员运行 `install-menu.bat` | 右键 → 以管理员身份运行                               |
| 快捷方式无法启动     | `server.mjs` 不在同一目录        | 确保 `create-launcher.bat` 与 `server.mjs` 同目录 |
| 浏览器未打开       | 系统阻止 `cmd /c start`        | 手动访问 `http://127.0.0.1:3000`                |
| 服务不退出        | 打开了 DevTools 或有标签未关        | 关闭所有相关标签，或手动结束 `node.exe`                   |
| **端口被占用弹窗**  | 3000 被其他程序使用               | 按提示运行 `taskkill /f /pid XXX` 或手动结束          |
| `node` 命令未找到 | Node 未加入 PATH              | 安装 Node 并重启终端                               |
| 控制台乱码        | 脚本编码问题                     | `create-launcher.bat` 已使用 `chcp 65001`      |

> **推荐：使用 `launcher_server_debug.vbs` 查看详细日志**

---

## 终止某个实例

```powershell
# 查看运行中的 server.mjs 进程
Get-Process node | Where-Object {$_.CommandLine -like "*server.mjs*"} | Format-Table Id, CommandLine

# 终止
Stop-Process -Id <PID> -Force
```

---

## 安全与兼容性说明

- 仅限本地开发演示，**不建议公网暴露**
- 无身份验证、无 HTTPS、无 CORS 限制
- 推荐配合 `nginx` + HTTPS 用于生产

---

## 常见改动点

| 需求                 | 修改位置                                                              |
| ------------------ | ----------------------------------------------------------------- |
| 更改默认端口             | `launcher_server.vbs` 或 `create-launcher.bat`                     |
| 固定资源路径（调试用）        | `launcher_server_debug.vbs`                                       |
| 更改图标               | `create-launcher.bat` 中 `IconLocation`                            |
| 支持 `.htm` 文件注入 SSE | `server.mjs` 中 `if (filePath.endsWith('index.html'))` 改为包含 `.htm` |
| 增加日志输出             | `server.mjs` 中 `console.log`                                      |

---

## 版权与许可

本工具为项目私用脚本，遵循仓库总体许可（见 `LICENSE`）。可自由修改用于本地开发用途。