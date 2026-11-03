# 本地 fork 的开发与稳定版更新

本 fork 采用本地构建、验证后安装的方式交付。日常安装版用于指挥开发；源码开发环境承担试验；候选包在通过相应验证后成为下一次日常安装版。现有命令见 [Development](development.md)，上游发布流程见 [Release Checklist](release.md)。

## 版本与源码

| 对象         | 用途                       | 约定                                                             |
| ------------ | -------------------------- | ---------------------------------------------------------------- |
| 当前安装版   | 日常工作与开发指挥         | /Applications/T3 Code (Beta).app；使用正式 T3 home 下的 userdata |
| fork/stable  | 已安装版本声明的源码提交   | 安装并验证新版本后才快进；构建完成不能提前移动                   |
| main         | 已整合、可构建的 fork 改进 | 直接在此分支开发、验证和提交，保留自己的改动再核对上游更新       |
| fork/develop | 旧开发参考分支             | 保留既有提交，后续以 main 为开发与合入入口                       |
| 候选标签     | 一份待安装构建的固定提交   | local-candidate/<完整版本号>，一个标签对应一个提交               |

日常安装版本沿用已有的 X.Y.Z-fork.YYYYMMDD.N 格式，同一天递增 N，版本须高于当前已安装版本。源码 package.json 的上游版号不直接作为本机 fork 的下一版号。通过打包器的 --build-version 对齐包内版本，打包结束后原始源码版号会恢复。

本机安装清单、候选状态和验证入口记录在 gitignored 的 release/local-stable/；安装前同时核对应用版本、源码提交和 app.asar SHA-256。历史中只有声明提交而没有完整构建记录的安装版，其实际应用备份才是回退依据。

## 开发环境

日常安装版的正式数据仍保留在原来的 T3 home，默认 ~/.t3/userdata。不要把开发服务器指向它。

主 checkout 首次使用 vp i --frozen-lockfile 补齐锁文件中的 JavaScript 依赖。提交钩子的跨工作区扫描会读取 mobile 和 marketing 的配置，只安装 server/desktop 的依赖也可能阻断提交。先核对磁盘空间；补齐这些 Node 依赖不要求额外安装移动端 SDK。

在工作 checkout 内，优先显式指定独立目录：

```sh
vp run dev --home-dir "$PWD/.t3/dev" --no-seed
```

先检查选择结果而不启动进程：

```sh
vp run dev --home-dir "$PWD/.t3/dev" --no-seed --dry-run
```

需要 Electron 专属功能时使用：

```sh
vp run dev:desktop --home-dir "$PWD/.t3/dev" --no-seed
```

默认先用空库和免费的 Replay (dev) 测试通用会话流程。需要真实项目数据时，按 development.md 中的 migrate-dev-db 流程，从正式库取得只读快照并裁剪到隔离目录；不要复制回正式环境。本机正式库较大，执行前先检查大小、空闲空间和工具的空间需求。

本机直接在当前 checkout 的 main 分支开发、验证和提交，不新建功能分支、集成分支或 worktree，也不自动执行 Setup Worktree。开始任务前检查当前分支和未提交改动，并保留既有工作。源码提交不代表安装更新，不应触发稳定版退出或重启。

需要界面或前台手势验证时，沿用用户的后台验证限制并安排可操作时间。启动一个桌面开发实例会产生窗口，本流程的后台准备阶段只执行 dry-run。

## 桌面资料目录也要隔离

T3 home 决定服务端数据库、配置和日志位置；Electron userData 另有自己的规则。在 macOS 上：

- 打包版使用 ~/Library/Application Support/t3code-v2。
- 源码开发版使用独立开发目录，通常为 t3code-dev；已有旧开发目录时可能复用 T3 Code (Dev)。
- 更改 T3CODE_HOME 不会为另一个打包版创建独立 Electron 资料目录。

因此，一次只运行一个日常打包版和一个桌面开发实例。后台调试优先在当前 checkout 运行 web/server，并使用独立 T3 home。不要在日常安装版运行时直接打开候选 .app；包内 CLI/后端验证使用独立 T3 home 和 Electron 的 Node 模式，完整桌面验收安排在维护窗口。

这些路径来自 DesktopStatePaths、DesktopEnvironment、DesktopUserData 和 DesktopClerk；后者先设置 userData，再取得单实例锁。

## 构建与验证候选

先完成改动的定向检查，准备提交。逻辑错误保留修复前失败的回归证据；按仓库要求，在推送前运行 check:changed，发布时保留实际运行的检查范围和结果。

候选包必须来自已经提交、工作区干净的源码。检查已有暂存内容，按具体文件提交，分别保留已有修复；提交信息使用中文。不要把未审阅的改动一起混进稳定更新。

候选使用独立输出目录，例如：

```sh
fork_version='0.1.7-fork.20261103.2'
env -u GITHUB_REPOSITORY -u T3CODE_DESKTOP_UPDATE_REPOSITORY \
  vp run dist:desktop:artifact \
  --platform mac --target dir --arch arm64 \
  --build-version "$fork_version" \
  --output-dir "release/$fork_version"
```

根据本次实际目标平台选择架构。资源监控器源码和目标没有变化且现有产物匹配时，可按打包器现有选项复用它。不要在改过对应源码后复用旧二进制。

本地更新包不配置 GitHub 更新 feed，也不发布 release。包中出现 Contents/Resources/app-update.yml 时，先核对构建环境，避免绕过本地验收流程更新。已有安装版的 feed 保持原样，直到有维护窗口用新包替换。

构建脚本已做包内依赖自包含检查。再记录包内版本、提交、app.asar 哈希，确认本次关键改动实际进入包中。本地 unsigned 构建需要临时签名时，只处理新生成的 .app：

```sh
codesign --force --deep --sign - "release/$fork_version/mac-arm64/T3 Code (Beta).app"
codesign --verify --deep --strict "release/$fork_version/mac-arm64/T3 Code (Beta).app"
```

这是本机 ad-hoc 签名，未使用开发者证书，也不等同于公证。后台启动检查用 ELECTRON_RUN_AS_NODE=1 和独立 T3CODE_HOME，不能把正常 Electron GUI 启动误当普通 Node。

每份候选的版本清单和验证报告放在同目录。构建、单测、后台启动与完整桌面验收分别记录；缺少验收的部分写明，不标成已安装或日常稳定版。

## 后台准备，由用户手动重启生效

用户要求的更新方式是：agent 在后台完成全部准备，只通知一次；用户自行正常退出并重新打开 T3 Code，新版本随之生效。agent 不主动退出、打开或重启日常安装版，不设置自动重启倒计时。

1. 在后台构建候选并验证版本、提交、签名、包内依赖及本次改动。先核对新旧版本的数据库迁移与持久化代码是否变化。
2. 将已验证候选暂存到 /Applications 旁的独立路径，不启动候选 GUI，不修改运行中的 app.asar。
3. 没有数据迁移的普通更新只更换 App，正式数据和登录资料留在原位；不为每次更新复制整份 userdata、Electron 资料或执行全库扫描。涉及实际数据迁移时，另行说明迁移和必要保护范围，不套用到普通界面更新。
4. 准备一次性的退出事件监听；后台等待用户正常退出，在旧 App 及其后端结束后快速交换应用目录，并保留旧 App。全部准备好后才通知用户“正常退出后重新打开即可”，不要求额外确认重启时点。
5. 用户自行重新打开后，核对实际应用和后端的版本、提交及本次关键改动，更新安装清单并将已有 fork/stable 快进到候选提交。不要把“已准备好”写成“已安装”。

切换失败时保留现场，不自动退出或打开应用、不循环尝试。用户尚未正常退出时不替换应用；后台准备和验证不得抢占前台。

## 回退边界

先关闭新版本，再使用保留的旧应用。若新版已经升级数据库结构或其他状态格式，旧应用不能保证直接读取新数据；应结合升级前备份恢复对应状态。

恢复旧数据库会回到备份时点。升级后新增的对话和任务记录必须先另行保留；恢复操作需要对具体目标和损失取得授权。不要在新旧服务仍运行时覆盖数据库，不承诺仅换回 .app 就能无损回退。

不自动清理旧包、备份、测试状态、worktree 或缓存。需要清理时单独列出对象与损失，再取得授权。

## 接入上游

main 保存本地已经整合的 fork 改进，上游远程跟踪引用用于对照。需要同步时先检查并保留未提交改动，再 fetch upstream，在当前 checkout 的 main 分支核对并合并上游，完成定向验证；后续候选构建和安装仍按上述流程进行。不要自动创建集成分支，不要用覆盖式重置丢弃 fork 改进，也不要因为上游发布新版本就自动替换日常安装版。
