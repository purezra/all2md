const cheerio = require("cheerio");
const {
  downloadImages,
  buildMarkdownVariants,
  normalizeRichContent
} = require("../utils/helper");
const { withPage } = require("../utils/browser");

async function convertZhihu(url) {
  let html, pageTitle;
  await withPage("https://www.zhihu.com/", async page => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const blockState = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return {
        title: document.title || "",
        text: text.slice(0, 500)
      };
    });

    if (/40362|当前请求存在异常|暂时限制本次访问|私信知乎小管家/.test(blockState.text)) {
      throw new Error(
        "知乎返回了风控拦截页，当前 IP 或无登录态浏览器被限制访问。可尝试使用本机已登录的 Chrome 配置启动，见 README 中的 `PUPPETEER_USER_DATA_DIR` / `PUPPETEER_HEADLESS=false` 说明。"
      );
    }

    // 判断是专栏文章还是回答
    const isAnswer = url.includes("/answer/");
    await page.waitForSelector(".QuestionHeader-title, .Post-Title, .RichContent-inner, .Post-RichTextContainer, .RichText, article", {
      timeout: 8000
    });

    const meta = await page.evaluate((isAnswer) => {
      let title = "", content = "", author = "", date = "";
      if (isAnswer) {
        title = document.querySelector(".QuestionHeader-title")?.innerText?.trim() ||
                document.title;
        author = document.querySelector(".AuthorInfo-name")?.innerText?.trim() || "";
        date = document.querySelector(".ContentItem-time")?.innerText?.trim() || "";
        content = document.querySelector(".RichContent-inner")?.innerHTML ||
                  document.querySelector(".Answer-content")?.innerHTML ||
                  document.querySelector("article")?.innerHTML || "";
      } else {
        title = document.querySelector(".Post-Title")?.innerText?.trim() || document.title;
        author = document.querySelector(".AuthorInfo-name")?.innerText?.trim() || "";
        date = document.querySelector(".ContentItem-time")?.innerText?.trim() || "";
        content = document.querySelector(".Post-RichTextContainer")?.innerHTML ||
                  document.querySelector(".RichText")?.innerHTML ||
                  document.querySelector("article")?.innerHTML || "";
      }
      return { title, author, date, content };
    }, isAnswer);

    pageTitle = meta.title;
    html = `<h1>${meta.title}</h1>` +
           (meta.author ? `<p><strong>作者：</strong>${meta.author}</p>` : "") +
           (meta.date ? `<p><strong>时间：</strong>${meta.date}</p>` : "") +
           `<hr/>` + meta.content;
  });

  const $ = cheerio.load(html);

  // 知乎图片用 data-original / data-actualsrc 存真实地址
  $("img").each((_, el) => {
    const real = $(el).attr("data-original") ||
                 $(el).attr("data-actualsrc") ||
                 $(el).attr("data-src");
    if (real) $(el).attr("src", real);
  });

  // 下载图片
  const imgTasks = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && src.startsWith("http")) imgTasks.push({ el, src });
  });

  await downloadImages($, imgTasks, url);

  $("script, style, .Reward, .FollowButton, .VoteButton").remove();
  normalizeRichContent($);

  const { markdown, zipMarkdown, assets } = buildMarkdownVariants($);

  return { title: pageTitle, markdown, zipMarkdown, assets, platform: "zhihu" };
}

module.exports = { convertZhihu };
