const axios = require("axios");
const cheerio = require("cheerio");
const {
  downloadImages,
  buildMarkdownVariants,
  normalizeRichContent
} = require("../utils/helper");
const { withPage } = require("../utils/browser");

function extractStatusId(url) {
  return url.match(/\/status\/(\d+)/i)?.[1] || "";
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtmlFromTweet(meta) {
  const blocks = [`<h1>${escapeHtml(meta.title || "X 帖子")}</h1>`];

  if (meta.author) {
    const authorLabel = meta.username ? `${meta.author} (@${meta.username})` : meta.author;
    blocks.push(`<p><strong>作者：</strong>${escapeHtml(authorLabel)}</p>`);
  }
  if (meta.date) {
    blocks.push(`<p><strong>时间：</strong>${escapeHtml(meta.date)}</p>`);
  }
  if (meta.sourceUrl) {
    blocks.push(`<p><strong>链接：</strong><a href="${meta.sourceUrl}">${meta.sourceUrl}</a></p>`);
  }

  blocks.push("<hr/>");

  if (meta.textHtml) {
    blocks.push(`<div>${meta.textHtml}</div>`);
  }

  for (const image of meta.images || []) {
    blocks.push(`<p><img src="${image}" alt="tweet-media" /></p>`);
  }

  if (meta.videoPoster) {
    blocks.push(`<p><img src="${meta.videoPoster}" alt="tweet-video-poster" data-caption="视频封面" /></p>`);
  }

  return blocks.join("");
}

async function convertViaSyndication(url, statusId) {
  if (!statusId) return null;

  try {
    const res = await axios.get(`https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&lang=zh-cn`, {
      timeout: 15000,
      headers: { "User-Agent": "article-to-md" }
    });
    const data = res.data || {};
    const images = []
      .concat(Array.isArray(data.photos) ? data.photos.map(item => item.url || item.media_url_https).filter(Boolean) : [])
      .concat(Array.isArray(data.mediaDetails) ? data.mediaDetails.map(item => item.media_url_https || item.url).filter(Boolean) : []);

    const text = (data.text || "").trim();
    if (!text) return null;

    return {
      title: text.split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 80) || "X 帖子",
      author: data.user?.name || "",
      username: data.user?.screen_name || "",
      date: data.created_at || "",
      textHtml: text
        .split(/\n{2,}/)
        .map(line => `<p>${escapeHtml(line).replace(/\n/g, "<br>")}</p>`)
        .join(""),
      images: [...new Set(images)],
      videoPoster: "",
      sourceUrl: url
    };
  } catch (_error) {
    return null;
  }
}

async function convertViaPage(url, statusId) {
  let meta = null;

  await withPage("https://x.com/", async page => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("article, main", { timeout: 12000 });

    meta = await page.evaluate((targetStatusId, pageUrl) => {
      const normalizeHref = href => {
        if (!href) return "";
        if (/^https?:\/\//i.test(href)) return href;
        return new URL(href, location.origin).href;
      };

      const articles = Array.from(document.querySelectorAll("article"));
      const pickArticle = () => {
        if (!articles.length) return null;
        if (!targetStatusId) return articles[0];

        return articles.find(article => {
          return Array.from(article.querySelectorAll("a[href*='/status/']")).some(anchor => {
            return anchor.getAttribute("href")?.includes(`/status/${targetStatusId}`);
          });
        }) || articles[0];
      };

      const article = pickArticle();
      if (!article) return null;

      const authorRoot = article.querySelector("[data-testid='User-Name']");
      const nameSpans = Array.from(authorRoot?.querySelectorAll("span") || [])
        .map(node => node.textContent?.trim())
        .filter(Boolean);
      const author = nameSpans.find(value => !value.startsWith("@")) || "";
      const username = nameSpans.find(value => value.startsWith("@"))?.replace(/^@/, "") || "";

      const tweetTextNode = article.querySelector("[data-testid='tweetText']");
      const textHtml = tweetTextNode?.innerHTML || "";
      const textPlain = tweetTextNode?.innerText?.trim() || "";
      const images = Array.from(article.querySelectorAll("img"))
        .map(img => img.getAttribute("src") || "")
        .filter(src => /pbs\.twimg\.com\/media|pbs\.twimg\.com\/ext_tw_video_thumb/i.test(src));
      const videoPoster =
        article.querySelector("video")?.getAttribute("poster") ||
        article.querySelector("[data-testid='videoPlayer'] video")?.getAttribute("poster") ||
        "";
      const timeNode = article.querySelector("time");
      const statusLink = Array.from(article.querySelectorAll("a[href*='/status/']"))
        .map(anchor => normalizeHref(anchor.getAttribute("href")))
        .find(Boolean) || pageUrl;

      return {
        title: textPlain.split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 80) || document.title || "X 帖子",
        author,
        username,
        date: timeNode?.getAttribute("datetime") || timeNode?.textContent?.trim() || "",
        textHtml,
        images: [...new Set(images)],
        videoPoster,
        sourceUrl: statusLink
      };
    }, statusId, url);
  });

  if (!meta || !meta.textHtml) {
    throw new Error("未能从 X 页面提取正文，可能需要可访问的公开帖子链接");
  }

  return meta;
}

async function convertX(url) {
  const statusId = extractStatusId(url);
  let meta = await convertViaSyndication(url, statusId);

  if (!meta) {
    meta = await convertViaPage(url, statusId);
  }

  const $ = cheerio.load(buildHtmlFromTweet(meta));
  const imgTasks = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && /^https?:\/\//i.test(src)) {
      imgTasks.push({ el, src });
    }
  });

  await downloadImages($, imgTasks, url);

  $("script, style, noscript").remove();
  normalizeRichContent($);

  const { markdown, zipMarkdown, assets } = buildMarkdownVariants($);
  return {
    title: meta.title || "X 帖子",
    markdown,
    zipMarkdown,
    assets,
    platform: "x"
  };
}

module.exports = { convertX, extractStatusId };
