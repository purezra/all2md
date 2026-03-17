const cheerio = require("cheerio");
const {
  downloadImages,
  buildMarkdownVariants,
  normalizeRichContent
} = require("../utils/helper");
const { withPage } = require("../utils/browser");

async function convertToutiao(url) {
  let html;
  let pageTitle = "";
  let finalUrl = url;

  await withPage("https://www.toutiao.com/", async page => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    finalUrl = page.url();

    await page.waitForSelector(
      "article, .article-content, .tt-article-content, .a-con, [data-testid='article-content']",
      { timeout: 12000 }
    );

    const meta = await page.evaluate(() => {
      const pickText = selectors => {
        for (const selector of selectors) {
          const text = document.querySelector(selector)?.innerText?.trim();
          if (text) return text;
        }
        return "";
      };

      const pickHtml = selectors => {
        for (const selector of selectors) {
          const html = document.querySelector(selector)?.innerHTML;
          if (html) return html;
        }
        return "";
      };

      return {
        title: pickText([
          "h1",
          ".article-title",
          ".tt-article-title",
          "[data-testid='article-title']"
        ]) || document.title,
        author: pickText([
          ".article-author",
          ".author-name",
          ".tt-article-author",
          "[data-testid='article-author-name']"
        ]),
        date: pickText([
          ".article-sub-info span",
          ".time",
          ".tt-article-time",
          "[data-testid='article-publish-time']"
        ]),
        content: pickHtml([
          "article",
          ".article-content",
          ".tt-article-content",
          ".a-con",
          "[data-testid='article-content']",
          "main"
        ])
      };
    });

    pageTitle = meta.title;
    html = `<h1>${meta.title}</h1>` +
           (meta.author ? `<p><strong>作者：</strong>${meta.author}</p>` : "") +
           (meta.date ? `<p><strong>时间：</strong>${meta.date}</p>` : "") +
           `<hr/>` + meta.content;
  });

  const $ = cheerio.load(html);

  $("img").each((_, el) => {
    const real = $(el).attr("src") ||
                 $(el).attr("data-src") ||
                 $(el).attr("data-image-url") ||
                 $(el).attr("data-web-uri");
    if (real && /^https?:\/\//i.test(real)) {
      $(el).attr("src", real);
    }
  });

  const imgTasks = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && src.startsWith("http")) imgTasks.push({ el, src });
  });

  await downloadImages($, imgTasks, finalUrl);

  $("script, style, noscript, .tt-article-recommend, .related-link, .open-app, .download-app").remove();
  normalizeRichContent($);

  const { markdown, zipMarkdown, assets } = buildMarkdownVariants($);

  return { title: pageTitle, markdown, zipMarkdown, assets, platform: "toutiao" };
}

module.exports = { convertToutiao };
