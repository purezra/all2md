<p align="center">
  <img src="plugin/logo.png" alt="All2MD" width="180" />
</p>

# All2MD

把微信公众号、知乎、今日头条、GitHub README 等网页内容整理成可预览、可下载的 Markdown。项目同时提供：

- 网页端：粘贴一个或多个链接，批量转换并导出
- Chrome 插件：直接从当前页面提取 Markdown，支持预览、下载 `.md`、下载 `.zip`

> 当前状态：网页端可日常使用；Chrome 插件可用于内测分发；X / Twitter 支持为实验性能力。

## 当前能力

支持的平台：

- 微信公众号文章
- 知乎回答 / 文章
- 今日头条文章
- GitHub 仓库 README
- X / Twitter 页面提取（实验性）

主要功能：

- 自动识别平台，也可手动指定平台
- 支持一次粘贴多个 URL，串行处理
- Markdown 实时预览
- 导出 `.md`
- 导出 `.zip`，包含 Markdown 和图片资源
- Chrome 插件可直接提取当前页面

## 项目结构

```text
article-to-md/
├── server.js
├── converters/
├── utils/
├── public/
├── plugin/
├── downloads/
└── package.json
```

关键目录：

- [public/index.html](/D:/Desktop/article-to-md/public/index.html)：网页端 UI
- [converters](/D:/Desktop/article-to-md/converters)：各平台解析逻辑
- [utils/helper.js](/D:/Desktop/article-to-md/utils/helper.js)：Markdown / 图片处理辅助逻辑
- [plugin](/D:/Desktop/article-to-md/plugin)：Chrome 插件源码

## 网页端使用

### 1. 安装依赖

```bash
npm install
```

如果你不希望 Puppeteer 自动下载浏览器：

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

### 2. 启动服务

```bash
npm start
```

默认地址：

```text
http://localhost:3000
```

### 3. 基本用法

- 打开网页端
- 粘贴一个或多个链接
- 选择平台，或保持“自动识别”
- 点击“开始转换”
- 查看 Markdown / 预览 / 下载结果

## 浏览器配置

如果本机已安装 Chrome / Edge，服务会优先复用系统浏览器。

如需手动指定浏览器路径：

```powershell
$env:PUPPETEER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm start
```

如需连接一个长期存活的远程调试浏览器：

```powershell
$env:PUPPETEER_BROWSER_URL="http://127.0.0.1:9222"
npm start
```

如需使用独立 profile：

```powershell
$env:PUPPETEER_USER_DATA_DIR="D:\Desktop\article-to-md\.chrome-profile"
$env:PUPPETEER_HEADLESS="false"
npm start
```

## 图片与 ZIP

默认情况下，Markdown 中的图片优先保留远程地址。

如果希望网页端生成的 Markdown 改为引用本地图片路径：

```powershell
$env:MARKDOWN_IMAGE_MODE="local"
npm start
```

这时导出的 Markdown 会使用 `images/xxx.jpg` 这类相对路径。

ZIP 导出会把 `.md` 和 `images/` 一起打包，适合离线阅读。

## API

### `POST /api/extract`

请求体：

```json
{
  "url": "https://mp.weixin.qq.com/s/example"
}
```

### `GET /api/extract?url=...`

适合脚本快速调用。

### `POST /api/convert`

兼容旧前端，返回结构与 `/api/extract` 相同。

## Chrome 插件

插件源码位于 [plugin](/D:/Desktop/article-to-md/plugin)。

当前插件能力：

- 提取当前页面正文为 Markdown
- Markdown / 预览双视图
- 下载 `.md`
- 下载 `.zip`（包含图片）

### 本地加载

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 [plugin](/D:/Desktop/article-to-md/plugin) 文件夹

### 私下分发

如果暂时不上架 Chrome 商店，推荐这样分发：

1. 将 [plugin](/D:/Desktop/article-to-md/plugin) 压缩为 zip
2. 发给朋友
3. 对方解压后按上面的“本地加载”步骤安装

不建议现在直接分发 `.crx`，兼容性和安装体验都更差。

## 平台说明

### 微信公众号

- 适合公开可访问文章
- 已对常见章节号、提示框、图片说明做格式优化

### GitHub

- 支持公开仓库 README
- 支持直接粘贴 GitHub 仓库 URL
- 也支持从类似 `GitHub - owner/repo: desc` 的标题文本识别仓库

### X / Twitter

- 当前为实验性支持
- 网页端受匿名访问、地区、登录态、页面结构变化影响较大
- 插件端因为运行在用户自己的浏览器上下文里，通常比网页端更稳定
- 仍不保证所有 X 页面都能成功提取

## 适合当前阶段的使用方式

如果你追求稳定性，建议：

- 微信、知乎、头条、GitHub：优先用网页端
- X / Twitter：优先用 Chrome 插件
- 批量多链接：优先用网页端
- 当前页一键提取：优先用 Chrome 插件

## 服务器部署

如果你在 Ubuntu 服务器部署，可以继续沿用 `systemd` 托管服务，再通过 `journalctl` 看日志。

常用命令：

```bash
sudo systemctl restart all2md
sudo journalctl -u all2md -f
curl http://127.0.0.1:3000/api/health
```

## 已知限制

- X / Twitter 抓取不稳定，尤其是匿名环境
- 不同平台的图片防盗链策略不同，个别页面可能出现 ZIP 中部分图片下载失败
- Chrome 插件目前更适合内测分发，不建议直接视为正式商店版

## 开发建议

```bash
npm start
```

修改网页端后，直接刷新浏览器即可。

修改插件后，需要在 `chrome://extensions/` 中重新加载扩展。
