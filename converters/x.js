const axios = require("axios");
const cheerio = require("cheerio");
const {
  downloadImages,
  buildMarkdownVariants,
  normalizeRichContent
} = require("../utils/helper");
const { withPage } = require("../utils/browser");
const { extractXResource } = require("../plugin/lib/platform");

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

async function convertViaSyndication(url, resource) {
  if (!resource?.id || resource.kind !== "status") return null;

  try {
    const res = await axios.get(`https://cdn.syndication.twimg.com/tweet-result?id=${resource.id}&lang=zh-cn`, {
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

async function convertViaHtmlMeta(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    const $ = cheerio.load(res.data || "");
    const pickMeta = (...keys) => {
      for (const key of keys) {
        const value =
          $(`meta[property="${key}"]`).attr("content") ||
          $(`meta[name="${key}"]`).attr("content");
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };

    const description = pickMeta("og:description", "twitter:description", "description");
    const title = pickMeta("og:title", "twitter:title") || "X 帖子";
    const image = pickMeta("og:image", "twitter:image");
    const author = pickMeta("twitter:site", "twitter:creator").replace(/^@/, "");

    // X 未登录页常返回 “登录 / 注册” 等通用文案，过滤掉这类无效描述
    if (!description || /log in|sign up|登录|注册|join x/i.test(description)) {
      return null;
    }

    return {
      title: description.split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 80) || title,
      author: author || "",
      username: author || "",
      date: "",
      textHtml: description
        .split(/\n{2,}/)
        .map(line => `<p>${escapeHtml(line).replace(/\n/g, "<br>")}</p>`)
        .join(""),
      images: image ? [image] : [],
      videoPoster: "",
      sourceUrl: url
    };
  } catch (_error) {
    return null;
  }
}

async function convertViaPage(url, resource) {
  let meta = null;

  await withPage("https://x.com/", async page => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (error) {
      if (error.name !== "TimeoutError") {
        throw error;
      }
      console.warn(`[x] navigation timeout, continue with partial DOM: ${url}`);
    }
    await page.waitForFunction(() => {
      return document.readyState !== "loading" || Boolean(document.body);
    }, { timeout: 5000 }).catch(() => {});

    meta = await page.evaluate((targetResource, pageUrl) => {
      const normalizeHref = href => {
        if (!href) return "";
        if (/^https?:\/\//i.test(href)) return href;
        return new URL(href, location.origin).href;
      };

      const pickMeta = (...keys) => {
        for (const key of keys) {
          const value =
            document.querySelector(`meta[property="${key}"]`)?.getAttribute("content") ||
            document.querySelector(`meta[name="${key}"]`)?.getAttribute("content");
          if (typeof value === "string" && value.trim()) return value.trim();
        }
        return "";
      };

      const normalizeDescription = value => {
        const text = String(value || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) return "";
        if (/^log in to x|^登录 x|^x\b/i.test(text)) return "";
        if (/from breaking news and entertainment/i.test(text)) return "";
        return text;
      };

      const buildMetaFallback = () => {
        const description = normalizeDescription(
          pickMeta("og:description", "twitter:description", "description")
        );
        if (!description) return null;

        const rawTitle = pickMeta("og:title", "twitter:title") || document.title || "X 帖子";
        const image = pickMeta("og:image", "twitter:image");
        const creator = pickMeta("twitter:creator", "twitter:site").replace(/^@/, "");

        return {
          title: description.split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 80) || rawTitle,
          author: creator || "",
          username: creator || "",
          date: "",
          textHtml: description
            .split(/\n{2,}/)
            .map(line => `<p>${escapeHtml(line).replace(/\n/g, "<br>")}</p>`)
            .join(""),
          images: image ? [image] : [],
          videoPoster: "",
          sourceUrl: pageUrl
        };
      };

      const buildLdJsonFallback = () => {
        const scripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"));
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent || "{}");
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              if (!item || typeof item !== "object") continue;
              const text = normalizeDescription(item.articleBody || item.description || "");
              if (!text) continue;

              const authorName = typeof item.author === "object"
                ? (item.author.alternateName || item.author.name || "")
                : "";
              const image = Array.isArray(item.image) ? item.image[0] : item.image || "";

              return {
                title: text.split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 80) || item.headline || "X 帖子",
                author: String(authorName || "").replace(/^@/, ""),
                username: String(authorName || "").replace(/^@/, ""),
                date: item.datePublished || "",
                textHtml: text
                  .split(/\n{2,}/)
                  .map(line => `<p>${escapeHtml(line).replace(/\n/g, "<br>")}</p>`)
                  .join(""),
                images: image ? [image] : [],
                videoPoster: "",
                sourceUrl: item.url || pageUrl
              };
            }
          } catch (_error) {}
        }
        return null;
      };

      const articles = Array.from(document.querySelectorAll("article"));
      const pickArticle = () => {
        if (!articles.length) return null;
        if (!targetResource?.id) return articles[0];

        return articles.find(article => {
          return Array.from(article.querySelectorAll("a[href*='/status/'], a[href*='/article/']")).some(anchor => {
            const href = anchor.getAttribute("href") || "";
            return href.includes(`/${targetResource.kind}/${targetResource.id}`);
          });
        }) || articles[0];
      };

      const article = pickArticle();
      if (!article) {
        return buildLdJsonFallback() || buildMetaFallback();
      }

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
      const statusLink = Array.from(article.querySelectorAll("a[href*='/status/'], a[href*='/article/']"))
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
    }, resource, url);
  });

  if (!meta || !meta.textHtml) {
    throw new Error("未能从 X 页面提取正文，可能需要可访问的公开帖子链接");
  }

  return meta;
}

async function convertX(url) {
  const resource = extractXResource(url);
  let meta = await convertViaSyndication(url, resource);

  if (!meta) {
    meta = await convertViaHtmlMeta(url);
  }

  if (!meta) {
    meta = await convertViaPage(url, resource);
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

module.exports = { convertX, extractXResource };

