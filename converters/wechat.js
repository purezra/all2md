const cheerio = require("cheerio");
const {
  downloadImages,
  buildMarkdownVariants,
  normalizeRichContent
} = require("../utils/helper");
const { withPage } = require("../utils/browser");

async function convertWeChat(url) {
  let html, pageTitle;
  await withPage("https://mp.weixin.qq.com/", async page => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    // 等待正文加载
    await page.waitForSelector("#js_content", { timeout: 8000 });

    // 微信图片用 data-src 懒加载，强制替换为 src
    await page.evaluate(() => {
      document.querySelectorAll("img[data-src]").forEach(img => {
        img.src = img.getAttribute("data-src");
      });
    });

    pageTitle = await page.title();
    // 提取标题和作者
    const meta = await page.evaluate(() => ({
      title: document.querySelector("#activity-name")?.innerText?.trim() || document.title,
      author: document.querySelector("#js_name")?.innerText?.trim() || "",
      date: document.querySelector("#publish_time")?.innerText?.trim() || "",
      content: document.querySelector("#js_content")?.innerHTML || ""
    }));

    pageTitle = meta.title;
    html = `<h1>${meta.title}</h1>` +
           (meta.author ? `<p><strong>公众号：</strong>${meta.author}</p>` : "") +
           (meta.date ? `<p><strong>发布时间：</strong>${meta.date}</p>` : "") +
           `<hr/>` + meta.content;
  });

  const $ = cheerio.load(html);

  // 下载图片并替换路径
  const imgTasks = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (src && src.startsWith("http")) {
      imgTasks.push({ el, src });
    }
  });

  await downloadImages($, imgTasks, url);

  // 移除无用元素
  $("script, style, .rich_media_tool, #js_pc_qr_code, .qr_code_pc_outer").remove();
  normalizeRichContent($);

  const { markdown, zipMarkdown, assets } = buildMarkdownVariants($);

  return { title: pageTitle, markdown, zipMarkdown, assets, platform: "wechat" };
}

module.exports = { convertWeChat };
