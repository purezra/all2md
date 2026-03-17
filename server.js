const express = require("express");
const path = require("path");
const fs = require("fs");
const JSZip = require("jszip");
const { convertArticle } = require("./converters/index");
const { getBrowserHealth } = require("./utils/browser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// 供前端访问已下载的图片
app.use("/images", express.static(path.join(__dirname, "downloads", "images")));

// 确保目录存在
const imgDir = path.join(__dirname, "downloads", "images");
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

app.get("/api/health", async (_req, res) => {
  const browser = await getBrowserHealth();
  res.json({
    ok: browser.ok,
    browser,
    timestamp: new Date().toISOString()
  });
});

async function handleExtract(req, res) {
  const url = (req.method === "GET" ? req.query.url : req.body.url);
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "请提供有效的文章链接" });
  }

  try {
    const startedAt = Date.now();
    console.log(`[convert:start] ${url}`);
    const result = await convertArticle(url.trim());
    console.log(`[convert:done] ${url} (${Date.now() - startedAt}ms)`);
    res.json({
      ok: true,
      url: url.trim(),
      title: result.title,
      platform: result.platform,
      markdown: result.markdown,
      zipMarkdown: result.zipMarkdown,
      assets: result.assets || []
    });
  } catch (err) {
    console.error(`[convert:error] ${url}`, err);
    res.status(500).json({ error: err.message || "转换失败，请检查链接是否有效" });
  }
}

app.get("/api/extract", handleExtract);
app.post("/api/extract", handleExtract);

app.post("/api/convert", handleExtract);

// 下载 .md 文件
app.post("/api/download", (req, res) => {
  const { markdown, filename } = req.body;
  const safe = (filename || "article").replace(/[/\\?%*:|"<>]/g, "-");
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safe)}.md"`);
  res.send(markdown);
});

app.post("/api/download-zip", async (req, res) => {
  const { markdown, filename, assets } = req.body;
  const safe = (filename || "article").replace(/[/\\?%*:|"<>]/g, "-");

  if (!markdown || typeof markdown !== "string") {
    return res.status(400).json({ error: "缺少 Markdown 内容" });
  }

  try {
    const zip = new JSZip();
    zip.file(`${safe}.md`, markdown);

    for (const asset of Array.isArray(assets) ? assets : []) {
      if (!asset || typeof asset !== "string") continue;
      const normalized = asset.replace(/\\/g, "/").replace(/^\/+/, "");
      const fullPath = path.join(__dirname, "downloads", normalized);
      if (!fullPath.startsWith(path.join(__dirname, "downloads"))) continue;
      if (!fs.existsSync(fullPath)) continue;
      zip.file(normalized, fs.readFileSync(fullPath));
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safe)}.zip"`);
    res.send(buffer);
  } catch (error) {
    console.error("[download:zip:error]", error);
    res.status(500).json({ error: "打包 ZIP 失败" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ 服务已启动: http://localhost:${PORT}`);
});
