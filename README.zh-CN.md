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
3. 打开 TabBridge 扩展，点击 **Connect**。
4. 对指定标签点击 **Share**，或打开 **All web tabs（所有网页标签）**，让 CLI/MCP 无需逐个分享即可接管全部网页标签。
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
- PNG 截图、内存控制台日志、批量动作后读取状态。
- 会话隔离、停止并撤销全部授权、本地 host 断线恢复。
- 开发者可在扩展中单独启用 JavaScript 求值。

“所有网页标签”“允许新建标签”和“JavaScript 求值”默认关闭。**Stop & revoke all** 会断开连接、撤销全部标签授权，并关闭这三个选项。

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

## 项目状态

0.2 是可运行的早期版本，不承诺与 OpenAI 官方插件功能相同。目前专用工具尚不包含跨进程 iframe 操作、文件上传下载管理、拖拽和移动端模拟。具体支持范围、测试方式和安全边界见英文 README。

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

开发打包需要 `zip`、`unzip` 和 `tar`，主机重连测试使用 `lsof`。Linux 的浏览器系统依赖可通过 `npx playwright install --with-deps chromium` 安装。`test:package` 会解压实际 npm 包，在临时目录验证 CLI、安装与卸载，不安装运行时依赖，也不连接日常浏览器。

`npm run pack:release` 在 `dist/` 生成扩展 ZIP、CLI tarball 和 SHA-256 校验文件，不会发布到 npm、Chrome 商店或 GitHub Release。详见[发布流程](docs/RELEASING.md)。

已加入 GitHub Actions 工作流，配置 Node.js 22/24 的 macOS/Ubuntu 检查、真实浏览器测试和发行包验证。所有 Actions 固定到提交 SHA，仓库权限只读，无需生产凭据。配置工作流不代表远端测试已经通过，实际证据见 [Actions](https://github.com/cjiewong/tabbridge/actions) 和[本地验证记录](docs/VALIDATION.md)。

卸载：在扩展中停止连接，运行 `node bin/tabbridge.mjs uninstall`，再在 Chrome 扩展页移除 TabBridge。

## 参与项目

普通问题和功能需求通过 [Issues](https://github.com/cjiewong/tabbridge/issues) 提交；请提供可复现步骤和脱敏后的版本、错误码。贡献规范见 [CONTRIBUTING](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md)和[维护说明](docs/MAINTAINING.md)。安全漏洞请按[安全报告政策](SECURITY.md)私密提交，不要在公开 issue 中贴利用细节。社区项目不承诺支持响应时限。

MIT 许可证。项目独立编写，参考公开 Chrome API、MCP 规范及开源 bridge 的架构思路，不包含 OpenAI 专有代码，与 OpenAI、Google 无隶属关系。
