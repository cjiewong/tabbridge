# TabBridge

**让 CLI 连接你正在使用的 Chrome。**

TabBridge 是独立实现的开源浏览器工具，包括 Chrome 扩展、本地 Native Host、CLI 和 MCP 服务。适用于 Codex CLI 等 MCP 客户端。运行时零 npm 依赖，无云端中继，不连接 ChatGPT 私有管道。

[English / 完整文档](README.md) · [安全边界](docs/SECURITY.md) · [架构](docs/ARCHITECTURE.md) · [故障排查](docs/TROUBLESHOOTING.md)

## 安装

需要 Node.js 22+、Chrome 118+，当前优先验证 macOS，提供 Linux 路径支持。Windows 尚未支持。

```sh
git clone https://github.com/cjiewong/tabbridge.git
cd tabbridge
node bin/tabbridge.mjs setup
```

运行时零 npm 依赖，使用项目无需执行 `npm install`。本地主机引用当前 checkout 和 Node 可执行文件的绝对路径；移动项目或更换 Node 后需要重新运行 `setup`。

1. 打开 `chrome://extensions`，启用开发者模式。
2. 点击“加载已解压的扩展程序”，选择项目的 `extension` 文件夹。
3. 打开 TabBridge 扩展，点击 **连接（Connect）**。
4. 对指定标签点击 **分享（Share）**，或选择 **所有网页（All web tabs）**，让 CLI/MCP 无需逐个分享即可接管全部网页标签。
5. 执行 `node bin/tabbridge.mjs doctor` 验证连接。

`setup` 仅注册 TabBridge 自己的用户级 Native Messaging 主机，不修改其他扩展。可通过 `--browser chromium`、`--browser edge` 或 `--browser testing` 选择浏览器；testing 选项对应 Chrome for Testing 146+ 的独立注册位置，其他浏览器/平台组合需按实际环境验证。`doctor` 包含本机路径，公开报错前请先脱敏。

注册 Codex MCP（路径替换为 `setup` 输出中的绝对路径）：

```sh
codex mcp add tabbridge -- /absolute/path/to/node /absolute/path/to/tabbridge/bin/tabbridge.mjs mcp
```

然后新建 CLI 会话，告诉 Agent：“使用 TabBridge，操作我已分享的标签页”。

## 功能

- 复用当前浏览器登录态；支持逐个分享，或一次开启所有网页标签访问。
- 页面无障碍树、元素编号、差异快照，减少无用上下文。
- 点击、输入、选择、键盘、滚动、导航、等待文字和弹窗处理。
- 悬停菜单、HTML5/指针拖拽和组合键，使用当前快照的元素编号。
- 为文件输入框选择明确授权的本地文件；读取有长度限制的页面正文。
- 视口、全页和元素 PNG 截图、内存控制台日志、批量动作后读取状态。
- 显式开启网络诊断，最多保留 100 条 HTTP(S) 请求状态记录。
- 激活已授权标签并将 Chrome 窗口切到前台；窗口最小化时恢复，支持需要前台渲染的弹窗和人工接手。
- 会话隔离、停止并撤销全部授权、本地 host 断线恢复。
- 开发者可在扩展中单独启用 JavaScript 求值。

“所有网页”“允许新建标签”和“JavaScript 求值”默认关闭。**停止并撤销全部授权（Stop & revoke all）** 会断开连接、撤销全部标签授权，并关闭这三个选项。

面板跟随 Chrome 的界面语言显示中文或英文，也可用语言菜单保存个人偏好。访问范围可选 **逐个授权** 或 **所有网页**；JavaScript 求值位于折叠的 **高级设置** 内。支持按标题、域名搜索，以及 **已接管／已屏蔽** 筛选。标签行始终保留域名并显示授权状态；**已接管** 表示会话拥有控制权，不代表正在执行命令。当前网页标签排在首位，列表滚动时停止按钮始终可见。**诊断** 显示连接状态和真实版本号，复制的诊断摘要不含页面标题、URL 或会话 ID。

## 无需逐个 Share

在扩展面板打开 **All web tabs**。CLI/MCP 即可发现当前 Chrome 配置中的所有 HTTP(S) 标签页，包括已登录网页和以后新打开的标签。第一次操作会自动接管，无需手动 Share，也无需先调用 claim。

该设置跨 Chrome 重启保留，允许跨域网页导航。正在被其他会话操作的标签不会被抢占，Chrome 设置页等内部页面不开放。点击标签旁的 **Block** 可单独排除，**Allow** 恢复；单个标签的排除只在其当前浏览器会话/生命周期内有效。

关闭总开关后，通过总开关取得的标签访问会被撤销，恢复逐个分享；原有有效的手动授权和 Agent 自建标签保留。停止连接也会关闭总开关。

## 使用示例

```sh
node bin/tabbridge.mjs tabs --session demo
node bin/tabbridge.mjs claim 123 --session demo
node bin/tabbridge.mjs snapshot 123 --session demo
# 使用刚刚返回的真实元素编号：
node bin/tabbridge.mjs click 123 s1:e7 --session demo
node bin/tabbridge.mjs screenshot 123 --out page.png --session demo
node bin/tabbridge.mjs release 123 --session demo
```

开启 All web tabs 后，Agent 可以按你的指令关闭当前会话接管的用户标签；关闭该选项时，只能关闭 Agent 自己创建的标签。日常清理仍应保留用户原有标签。逐个分享模式下，用户标签跨域后自动撤销授权，Chrome 重启后需要重新分享。所有网页模式下无需重新分享。超时意味着结果可能未知，不能盲目重复提交。

## 后台操作与不打扰模式

**不打扰模式**默认开启，升级时未保存过该偏好也默认开启。扩展会用 `QUIET_MODE` 拒绝 `activate`、任意 `evaluate`，以及关闭当前选中的标签。新标签只在已有的普通 Chrome 窗口中后台创建；没有可用窗口时拒绝新建，避免弹出前台窗口。当前选中的标签应释放控制权而不是关闭。`browser_status` 返回 `quiet`、`focusEmulation` 和实际可用的脚本权限；这些偏好只能在扩展面板修改，CLI/MCP 无权关闭限制。

可在 **高级设置** 中按需开启 **后台焦点模拟**，默认关闭。它对已授权标签使用 Chrome 的焦点模拟，让部分页面能在后台渲染，而无需选中标签或将窗口带到前台。快照、正文和文字等待会标记 `focusEmulated: true`；此时文档可见性／焦点是模拟值，`active` 和 `windowFocused` 仍是 Chrome 的实际标签／窗口状态。模拟值不代表 macOS 桌面焦点或应用已就绪，仍须检查目标内容。

修改这两个偏好会取消正在执行的浏览器动作并断开调试连接，旧元素编号和网络记录随之失效。释放、撤销、停止及调试断开也会清除正在生效的模拟。不打扰偏好在浏览器重启和停止后保留；关闭不打扰模式会同时关闭焦点模拟。已保存的 JavaScript 授权在不打扰模式下暂停，关闭该模式后恢复。模拟不可用、标签被冻结／丢弃或内容未出现时，会报告受阻，不自动改为前台激活。

不打扰模式的 `scroll` 直接滚动页面正文并返回位置，不向嵌套容器发送滚轮事件。普通输入仍使用目标标签的浏览器输入接口。网站自行弹窗、浏览器权限窗口、下载、声音及系统行为未被完整隔离；本模式拦截的是 TabBridge 主动切到前台的操作，不能保证所有网站副作用都静默。已验证独立后台 Chrome 窗口，测试驱动未注入焦点模拟；尚未验证用户跨 macOS 桌面持续打字的表现。如需完全隔离桌面，应使用独立浏览器运行环境。

## 导航与页面就绪

`open` 会立即返回标签 ID 和 `loading`，不表示页面已经加载完成。`snapshot`、`read`、`screenshot` 和 `wait` 会等待进行中的 HTTP(S) 导航提交，以及 `DOMContentLoaded` 结束。可选 `timeoutMs` 默认 8,000，范围为 0–12,000；URL 提交、DOM 就绪和文字等待共用同一预算，也受请求截止时间限制。Agent 新建标签暂时出现的 `about:blank`／空 URL 仅可用于等待，不能据此读取任意空白或受保护页面。写操作不会自动重试。

快照和正文读取包含 `loading`、`readyState`、`domContentLoaded`、`visibilityState`、`documentFocused`、`discarded`、`frozen`，并提示后台页面可能延迟渲染。`readyState: "complete"` 只表示文档状态，不代表应用的表格或数据已显示。验收结果时，用 `browser_wait` 等待具体内容。被冻结或丢弃的标签会返回 `FOREGROUND_REQUIRED`，避免用空内容误报成功。

```sh
node bin/tabbridge.mjs snapshot 123 --json '{"timeoutMs":8000}' --session demo
node bin/tabbridge.mjs wait 123 "预期表格标题" --json '{"timeoutMs":8000}' --session demo
```

`PAGE_LOADING` 或 `READINESS_TIMEOUT` 表示有限等待内未能完成观察。适当检查状态并重试读取，不应因此重复新建标签、刷新页面或重放上一次写操作。成功读取也是一个时点的结果，应用仍可能继续渲染。

## 前台弹窗与人工接手

用户关闭 **不打扰模式** 后，MCP 工具 `browser_activate`（CLI：`activate TAB`）会选中目标标签并将其所在 Chrome 窗口切到前台，最小化时恢复窗口。它遵守现有标签授权、Block 和会话隔离，无需启用 JavaScript 求值。快照同时报告标签选中、窗口焦点和文档可见性／焦点。激活时可传 `waitForText` 和 `timeoutMs`，等待目标内容出现后再返回；等待失败也不代表前台切换没有发生。

```sh
node bin/tabbridge.mjs activate 123 --json '{"waitForText":"预期表格标题","timeoutMs":8000}' --session demo
node bin/tabbridge.mjs snapshot 123 --session demo
```

切到前台会改变当前窗口，只在任务需要时使用；随后读取新快照，再决定下一步。该操作不刷新页面、不重放先前点击、不接受弹窗，也不绕过验证。系统焦点限制或站点自身故障仍可能需要人工处理。

## 菜单、文件、正文与网络诊断

以下元素编号须替换为当前快照返回的真实值，悬停或拖拽后应重新读取快照：

```sh
node bin/tabbridge.mjs hover 123 s1:e7 --session demo
node bin/tabbridge.mjs snapshot 123 --session demo
node bin/tabbridge.mjs drag 123 s2:e8 s2:e12 --session demo
node bin/tabbridge.mjs press 123 Control+A --session demo
node bin/tabbridge.mjs read 123 --json '{"maxChars":12000}' --session demo
node bin/tabbridge.mjs screenshot 123 --full-page --out page.png --session demo
node bin/tabbridge.mjs screenshot 123 --json '{"ref":"s2:e8"}' --out element.png --session demo
node bin/tabbridge.mjs upload 123 s2:e15 /absolute/path/to/approved-file.txt --session demo
node bin/tabbridge.mjs network 123 --json '{"action":"start"}' --session demo
node bin/tabbridge.mjs network 123 --session demo
node bin/tabbridge.mjs network 123 --json '{"action":"stop"}' --session demo
```

`read` 读取渲染后的文本，最多 32,000 字符，超出时标记截断，不遍历跨进程 iframe。`upload` 接受最多 16 个本机绝对路径；通过文件输入框编号及 `--json '{"files":[]}'` 可清空选择。选择文件不自动点击提交按钮，但站点可能立即上传，所以必须先明确文件和目标网站的授权。

网络诊断只在显式 start 后记录，不返回请求/响应头或正文，URL 去除查询参数、片段和凭据；路径仍可能有隐私信息。释放、撤销或调试器断开会清除记录，stop 后保留其已有的有限记录。全页/元素截图受单边 16,384 像素、总计 3,200 万像素和图片消息大小限制，`fullPage` 与元素编号不能同时指定。与 Chrome MCP、Chrome DevTools MCP 的能力差异见[功能对照](docs/FEATURE_COMPARISON.md)。

## 项目状态

0.2 是可运行的早期版本，不承诺与 OpenAI 官方插件功能相同。目前专用工具尚不包含跨进程 iframe 操作、下载管理、远程文件上传、原生文件选择器和移动端模拟。拖拽要求两个元素位于同一视口，不支持文件拖拽。具体支持范围、测试方式和安全边界见英文 README。

本地 socket 仅当前系统用户可访问；同用户进程属于信任边界。模型仍需遵循任务授权，标签页授权不等于允许付款、公开发布或删除数据。

## 开发与卸载

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run test:package
npm run pack:extension
```

真实浏览器测试使用独立、可丢弃的配置目录。已有 Chrome for Testing 可通过 `TABBRIDGE_TEST_CHROME` 指定，不会访问日常 Chrome 配置。

更新 checkout 后，在 `chrome://extensions` 重新加载 TabBridge，并新建 MCP 客户端会话以刷新工具列表。扩展重载可能影响标签授权和会话状态，继续旧任务前请重新检查访问状态。

开发打包需要 `zip`、`unzip` 和 `tar`，主机重连测试使用 `lsof`。Linux 的浏览器系统依赖可通过 `npx playwright install --with-deps chromium` 安装。`test:package` 会解压实际 npm 包，在临时目录验证 CLI、安装与卸载，不安装运行时依赖，也不连接日常浏览器。

`npm run pack:release` 在 `dist/` 生成扩展 ZIP、CLI tarball 和 SHA-256 校验文件，不会发布到 npm、Chrome 商店或 GitHub Release。详见[发布流程](docs/RELEASING.md)。

已加入 GitHub Actions 工作流，配置 Node.js 22/24 的 macOS/Ubuntu 检查、真实浏览器测试和发行包验证。所有 Actions 固定到提交 SHA，仓库权限只读，无需生产凭据。配置工作流不代表远端测试已经通过，实际证据见 [Actions](https://github.com/cjiewong/tabbridge/actions) 和[本地验证记录](docs/VALIDATION.md)。

卸载：在扩展中停止连接，运行 `node bin/tabbridge.mjs uninstall`，再在 Chrome 扩展页移除 TabBridge。

## 参与项目

普通问题和功能需求通过 [Issues](https://github.com/cjiewong/tabbridge/issues) 提交；请提供可复现步骤和脱敏后的版本、错误码。贡献规范见 [CONTRIBUTING](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md)和[维护说明](docs/MAINTAINING.md)。安全漏洞请按[安全报告政策](SECURITY.md)私密提交，不要在公开 issue 中贴利用细节。社区项目不承诺支持响应时限。

MIT 许可证。项目独立编写，参考公开 Chrome API、MCP 规范及开源 bridge 的架构思路，不包含 OpenAI 专有代码，与 OpenAI、Google 无隶属关系。
