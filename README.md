# 文章转 Markdown 工具

> 支持微信公众号、知乎、今日头条、X/Twitter 以及 GitHub 仓库 README 一键转换为 Markdown，自动下载图片到本地。

## 快速启动

```bash
# 1. 安装依赖（首次约需 2-5 分钟，Puppeteer 会下载 Chromium）
npm install

# 2. 启动服务
npm start

# 3. 浏览器访问
http://localhost:3000
```

如果启动后提示 `Could not find Chrome`：

```powershell
# 方案 1：当前版本已优先复用系统已安装的 Chrome / Edge，重启服务即可
npm start

# 方案 2：如仍失败，手动指定浏览器路径
$env:PUPPETEER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm start
```

如果知乎提示被限制访问，推荐使用“常驻 Chrome + 远程调试连接”模式：

```powershell
# 1. 启动一个独立的 Chrome，并开启远程调试
"C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="D:\Desktop\article-to-md\.chrome-profile"

# 2. 在这个 Chrome 里手动登录知乎

# 3. 启动服务，并让服务连接这个常驻 Chrome
cd D:\Desktop\article-to-md
$env:PUPPETEER_BROWSER_URL="http://127.0.0.1:9222"
npm start
```

这种模式下：
- Chrome 会长期存活，Cookie 和登录态会一直复用
- 服务优先连接远程调试 Chrome，不再每次请求临时启动浏览器
- 前端顶部会显示当前浏览器状态，也可以直接访问 `GET /api/health`
- Markdown 图片默认保留远程原图地址，方便在 Obsidian / Typora / VS Code 等本地阅读器直接显示
- 页面支持下载 ZIP，压缩包内包含 `.md` 和 `images/` 目录，适合离线阅读

如果你只是本机临时调试，也可以让服务自己托管一个独立 profile 的 Chrome：

```powershell
cd D:\Desktop\article-to-md
$env:PUPPETEER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:PUPPETEER_USER_DATA_DIR="D:\Desktop\article-to-md\.chrome-profile"
$env:PUPPETEER_HEADLESS="false"
npm start
```

说明：
- 不要直接把日常使用中的 `Chrome\User Data` 主目录给 Puppeteer
- 建议始终使用独立 profile 目录，例如 `D:\Desktop\article-to-md\.chrome-profile`
- 服务器部署时，优先使用远程调试连接模式而不是每次 `launch()`

如果你希望 Markdown 引用本地下载图片，而不是远程原图，可在启动前设置：

```powershell
$env:MARKDOWN_IMAGE_MODE="local"
```

此时导出的 Markdown 会使用 `images/xxx.jpg` 这种相对路径，适合把 `.md` 文件和 `images/` 目录放在一起使用。

提示：
- 新增 ZIP 下载能力后，如果你刚更新代码，请重新执行一次 `npm install`

## 部署到服务器

```bash
npm install -g pm2
pm2 start server.js --name article-to-md
pm2 save
pm2 startup
```

## 目录结构

```
article-to-md/
├── server.js              # 主服务
├── converters/
│   ├── index.js           # 平台路由
│   ├── wechat.js          # 微信解析器
│   ├── zhihu.js           # 知乎解析器
│   ├── toutiao.js         # 头条解析器
│   ├── x.js               # X / Twitter 解析器
│   └── github.js          # GitHub README 解析器
├── utils/
│   └── helper.js          # 图片下载 + Turndown 配置
├── public/
│   └── index.html         # 前端页面
└── downloads/
    └── images/            # 自动下载的图片（访问路径 /images/xxx）
```

## 注意事项

- 微信公众号文章须为**公开文章**（未关注也能访问的链接）
- 图片存储在 `downloads/images/`，重启服务不会丢失
- 服务器如无 GUI，Puppeteer 使用 `headless: new` 模式，无需桌面环境
- 知乎抓取稳定性强依赖登录态和浏览器会话，推荐用独立 Chrome profile 常驻登录
- X 帖子优先走公开数据源，失败时回退到浏览器提取；受可见性、地域或登录态影响时可能失败
- GitHub 仅支持公开仓库；可直接粘贴仓库 URL、`owner/repo` 或浏览器标题文本（如 `GitHub - owner/repo: desc`）

## API 调用

给外部工具或 agent 调用时，推荐使用：

### `POST /api/extract`

请求体：

```json
{
  "url": "https://mp.weixin.qq.com/s/uBP7AYzqhnWAGR84YcVHNw"
}
```

返回示例：

```json
{
  "ok": true,
  "url": "https://mp.weixin.qq.com/s/uBP7AYzqhnWAGR84YcVHNw",
  "title": "文章标题",
  "platform": "wechat",
  "markdown": "# 标题\\n\\n正文...",
  "zipMarkdown": "# 标题\\n\\n正文...",
  "assets": ["images/xxx.jpg", "images/yyy.png"]
}
```

也支持：

### `GET /api/extract?url=...`

适合脚本快速调用。

### `POST /api/convert`

这是兼容旧前端的别名接口，返回结构与 `/api/extract` 相同。
