const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const TurndownService = require("turndown");
const cheerio = require("cheerio");
const { gfm } = require("turndown-plugin-gfm");

const IMG_DIR = path.join(__dirname, "../downloads/images");
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
const IMAGE_MODE = (process.env.MARKDOWN_IMAGE_MODE || "remote").toLowerCase();

function getBrowserLaunchOptions() {
  const executableCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);

  const executablePath = executableCandidates.find(candidate => fs.existsSync(candidate));
  const headlessEnv = (process.env.PUPPETEER_HEADLESS || "").toLowerCase();
  const userDataDir = process.env.PUPPETEER_USER_DATA_DIR;

  return {
    headless: headlessEnv === "false" ? false : "new",
    executablePath,
    userDataDir: userDataDir || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  };
}

async function preparePage(page, referer) {
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ Referer: referer });
  await page.setRequestInterception(true);
  page.on("request", request => {
    const type = request.resourceType();
    if (["media", "font", "manifest"].includes(type)) {
      request.abort();
      return;
    }
    request.continue();
  });
}

async function downloadImage(src, referer) {
  try {
    const ext = (src.split("?")[0].match(/\.(jpg|jpeg|png|gif|webp|svg)/i) || ["", "jpg"])[1];
    const filename = `${uuidv4()}.${ext.toLowerCase()}`;
    const dest = path.join(IMG_DIR, filename);

    const res = await axios.get(src, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: referer || src
      }
    });

    fs.writeFileSync(dest, res.data);
    return {
      outputSrc: IMAGE_MODE === "local" ? `images/${filename}` : src,
      localSrc: `images/${filename}`,
      remoteSrc: src
    };
  } catch (e) {
    console.warn(`⚠️  图片下载失败: ${src} — ${e.message}`);
    return {
      outputSrc: src,
      localSrc: "",
      remoteSrc: src
    };
  }
}

async function downloadImages($, tasks, referer, concurrency = 4) {
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = tasks[index++];
      const result = await downloadImage(current.src, referer);
      if (!result) continue;
      $(current.el).attr("src", result.outputSrc);
      if (result.localSrc) $(current.el).attr("data-local-src", result.localSrc);
      if (result.remoteSrc) $(current.el).attr("data-remote-src", result.remoteSrc);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length || 1) }, () => worker());
  await Promise.all(workers);
}

function getInlineStyle(node, name) {
  const style = node.attribs?.style || "";
  const match = style.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, "i"));
  return match ? match[1].trim() : "";
}

function getTextContent($, node) {
  return $(node).text().replace(/\s+/g, " ").trim();
}

function hasVisualCardStyle(node) {
  const style = node.attribs?.style || "";
  return /(background(?:-color)?\s*:|border(?:-left)?\s*:|box-shadow\s*:)/i.test(style);
}

function hasCalloutAncestor($, el) {
  return $(el).parents("[data-md-block='callout'], [data-md-block='quote']").length > 0;
}

function hasStructuralContent($, el) {
  return $(el).children("table, pre, figure, img, video, iframe").length > 0;
}

function inferCalloutType(text, className) {
  const value = `${className} ${text}`.toLowerCase();
  if (/warning|warn|caution|风险|注意|警告|谨慎|避坑/.test(value)) return "warning";
  if (/tip|tips|hint|提示|建议|说明|注|补充/.test(value)) return "tip";
  if (/info|notice|note|信息|须知|提醒|链接|参考/.test(value)) return "info";
  return "note";
}

function inferCalloutTitle(type, text) {
  const firstLine = text.split("\n").map(line => line.trim()).find(Boolean) || "";
  if (firstLine.length > 0 && firstLine.length <= 24) {
    return firstLine;
  }

  if (type === "warning") return "注意";
  if (type === "tip") return "提示";
  if (type === "info") return "说明";
  return "备注";
}

function extractMathLatex($, el) {
  const $el = $(el);

  const candidates = [
    $el.attr("data-tex"),
    $el.attr("data-latex"),
    $el.attr("alttext"),
    $el.attr("aria-label"),
    $el.attr("data-formula"),
    $el.find("annotation[encoding='application/x-tex']").first().text(),
    $el.find("annotation[encoding='application/x-latex']").first().text(),
    $el.find("script[type='math/tex']").first().html(),
    $el.find("script[type='math/tex; mode=display']").first().html(),
    $el.find("script[type='math/latex']").first().html()
  ];

  const latex = candidates.find(value => typeof value === "string" && value.trim());
  return latex ? latex.trim() : "";
}

function isDisplayMath($, el) {
  const $el = $(el);
  const cls = ($el.attr("class") || "").toLowerCase();
  const displayAttr = ($el.attr("display") || $el.attr("mode") || "").toLowerCase();
  return (
    cls.includes("display") ||
    cls.includes("math-display") ||
    cls.includes("katex-display") ||
    displayAttr === "block" ||
    displayAttr === "display" ||
    $el.closest("p").children().length === 1
  );
}

function normalizeRichContent($) {
  // 去掉空容器，减少 Turndown 产生的噪音空行
  $("p, div").each((_, el) => {
    const text = getTextContent($, el);
    const hasMedia = $(el).find("img, video, iframe, table, pre, blockquote").length > 0;
    if (!text && !hasMedia && $(el).children().length === 0) {
      $(el).remove();
    }
  });

  // 归一化常见的强调语义，尽量用 Markdown 或内嵌 HTML 表达
  $("span, strong, b, em, i").each((_, el) => {
    const color = getInlineStyle(el, "color").toLowerCase();
    const bg = getInlineStyle(el, "background(?:-color)?").toLowerCase();
    const text = $(el).text();

    if (!text.trim()) return;

    if (bg && bg !== "transparent" && bg !== "rgba(0,0,0,0)") {
      $(el).replaceWith(`<mark>${$(el).html()}</mark>`);
      return;
    }

    if (color.includes("rgb(87, 107, 149)") || color.includes("#576b95")) {
      $(el).replaceWith(`<span>${$(el).html()}</span>`);
    }
  });

  // 将带对齐语义的段落保留下来
  $("p, div, section").each((_, el) => {
    const alignAttr = ($(el).attr("align") || "").toLowerCase();
    const textAlign = getInlineStyle(el, "text-align").toLowerCase();
    const align = alignAttr || textAlign;
    if (align === "center" || align === "right") {
      $(el).attr("data-md-align", align);
    }
  });

  // 图片标题常见于 figure / figcaption 或图片后紧邻说明文字
  $("img").each((_, el) => {
    const $img = $(el);
    const alt = ($img.attr("alt") || $img.attr("data-caption") || "").trim();
    if (alt && !$img.attr("alt")) {
      $img.attr("alt", alt);
    }

    const width = $img.attr("width") || getInlineStyle(el, "width");
    if (width) {
      $img.attr("data-width", width.replace("px", "").trim());
    }

    const parent = $img.parent()[0];
    const parentAlign = parent
      ? (($(parent).attr("align") || "").toLowerCase() || getInlineStyle(parent, "text-align").toLowerCase())
      : "";
    const selfAlign = ($img.attr("align") || "").toLowerCase() || getInlineStyle(el, "text-align").toLowerCase();
    const align = selfAlign || parentAlign;
    if (align === "center" || align === "right") {
      $img.attr("data-md-align", align);
    }
  });

  $("figure").each((_, el) => {
    const $figure = $(el);
    const caption = $figure.find("figcaption").first().text().trim();
    const $img = $figure.find("img").first();
    if (caption && $img.length && !$img.attr("data-caption")) {
      $img.attr("data-caption", caption);
    }
  });

  $("img").each((_, el) => {
    const $img = $(el);
    if ($img.attr("data-caption")) return;

    const next = $img.parent().next();
    if (!next.length) return;

    const className = next.attr("class") || "";
    const text = next.text().trim();
    if (!text) return;

    const looksLikeCaption =
      /caption|figcaption|image[-_ ]?desc|pic[-_ ]?desc|img[-_ ]?desc/i.test(className) ||
      (text.length <= 80 && (next.is("p") || next.is("div")));

    if (looksLikeCaption) {
      $img.attr("data-caption", text);
    }
  });

  // 知乎 / 微信常见分割线
  $("hr").attr("data-md-hr", "true");

  // 常见的代码块语义
  $("pre").each((_, el) => {
    const $pre = $(el);
    const $code = $pre.find("code").first();
    if ($code.length) {
      const cls = $code.attr("class") || $pre.attr("class") || "";
      const langMatch = cls.match(/language-([a-z0-9+#-]+)/i) || cls.match(/lang(?:uage)?-([a-z0-9+#-]+)/i);
      if (langMatch && !$code.attr("data-lang")) {
        $code.attr("data-lang", langMatch[1].toLowerCase());
      }
    }
  });

  // MathJax / KaTeX / MathML / SVG 公式归一为 LaTeX，避免把 path/g 节点直接吐进 Markdown
  $(
    "math, mjx-container, .MathJax, .katex, .katex-display, svg[data-mml-node='math'], span[data-formula], div[data-formula]"
  ).each((_, el) => {
    const $el = $(el);
    if ($el.attr("data-md-math")) return;
    if ($el.parents("[data-md-math]").length > 0) return;

    const latex = extractMathLatex($, el);
    const display = isDisplayMath($, el);

    if (latex) {
      $el.replaceWith(
        `<span data-md-math="true" data-md-math-mode="${display ? "block" : "inline"}">${latex}</span>`
      );
      return;
    }

    // 提取不到 LaTeX 时，至少不要把公式 SVG 的内部 path/g 原样输出到 Markdown
    if (["svg", "math", "mjx-container"].includes(el.tagName) || /mathjax|katex/i.test($el.attr("class") || "")) {
      $el.replaceWith(
        `<span data-md-math="true" data-md-math-mode="${display ? "block" : "inline"}">[公式]</span>`
      );
    }
  });

  // 引用块、提示框、信息卡片归一化
  $("blockquote, div, section, aside").each((_, el) => {
    const $el = $(el);
    const className = ($el.attr("class") || "").trim();
    const text = $el.text().replace(/\u00a0/g, " ").trim();
    if (!text) return;
    if (hasCalloutAncestor($, el)) return;

    const looksLikeQuote =
      el.tagName === "blockquote" ||
      /blockquote|quote|citation|blockquotecontainer|richcontent-blockquote/i.test(className);

    if (looksLikeQuote) {
      $el.attr("data-md-block", "quote");
      return;
    }

    const looksLikeCallout =
      /callout|note|tips|tip|hint|alert|warning|notice|message/i.test(className) ||
      (hasVisualCardStyle(el) && !hasStructuralContent($, el) && text.length <= 240);

    if (!looksLikeCallout) return;

    const type = inferCalloutType(text, className);
    const title = inferCalloutTitle(type, text);
    $el.attr("data-md-block", "callout");
    $el.attr("data-md-callout-type", type);
    $el.attr("data-md-callout-title", title);
  });
}

function buildTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined"
  });
  td.use(gfm);
  td.keep(["u", "sub", "sup", "mark", "kbd"]);

  td.addRule("alignedBlock", {
    filter(node) {
      return ["P", "DIV", "SECTION"].includes(node.nodeName) && node.getAttribute("data-md-align");
    },
    replacement(content, node) {
      const align = node.getAttribute("data-md-align");
      const inner = content.trim();
      if (!inner) return "\n\n";
      return `\n\n<p align="${align}">${inner}</p>\n\n`;
    }
  });

  td.addRule("semanticQuote", {
    filter(node) {
      return node.getAttribute?.("data-md-block") === "quote";
    },
    replacement(content) {
      const lines = content
        .trim()
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);
      if (!lines.length) return "\n\n";
      return `\n\n${lines.map(line => `> ${line}`).join("\n")}\n\n`;
    }
  });

  td.addRule("mathFormula", {
    filter(node) {
      return node.getAttribute?.("data-md-math") === "true";
    },
    replacement(content, node) {
      const raw = (content || node.textContent || "").trim();
      if (!raw) return "";
      const mode = node.getAttribute("data-md-math-mode") || "inline";
      if (raw === "[公式]") {
        return mode === "block" ? "\n\n[公式]\n\n" : "[公式]";
      }
      return mode === "block" ? `\n\n$$\n${raw}\n$$\n\n` : `$${raw}$`;
    }
  });

  td.addRule("calloutBlock", {
    filter(node) {
      return node.getAttribute?.("data-md-block") === "callout";
    },
    replacement(content, node) {
      const type = node.getAttribute("data-md-callout-type") || "note";
      const title = node.getAttribute("data-md-callout-title") || "备注";
      const body = content.trim();
      if (!body) return "\n\n";

      const icon = type === "warning"
        ? "[!WARNING]"
        : type === "tip"
          ? "[!TIP]"
          : type === "info"
            ? "[!INFO]"
            : "[!NOTE]";

      const lines = body
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      return `\n\n> ${icon} ${title}\n${lines.map(line => `> ${line}`).join("\n")}\n\n`;
    }
  });

  // 保留 <figure> 中图片顺序
  td.addRule("figure", {
    filter: "figure",
    replacement: (content) => `\n\n${content.trim()}\n\n`
  });

  td.addRule("image", {
    filter: "img",
    replacement(_, node) {
      const src = node.getAttribute("src") || "";
      if (!src) return "";

      const alt = (node.getAttribute("alt") || "").replace(/\|/g, "\\|");
      const title = node.getAttribute("title") || "";
      const caption = node.getAttribute("data-caption") || "";
      const width = node.getAttribute("data-width") || "";
      const align = node.getAttribute("data-md-align") || "";

      let imageMd = "";
      if (width || align) {
        const attrs = [`src="${src}"`];
        if (alt) attrs.push(`alt="${alt}"`);
        if (width) attrs.push(`width="${width}"`);
        if (align) attrs.push(`align="${align}"`);
        imageMd = `<img ${attrs.join(" ")} />`;
      } else {
        imageMd = title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
      }

      if (caption) {
        return `\n\n${imageMd}\n\n*${caption}*\n\n`;
      }

      return `\n\n${imageMd}\n\n`;
    }
  });

  td.addRule("figcaption", {
    filter: "figcaption",
    replacement(content) {
      const text = content.trim();
      return text ? `\n\n*${text}*\n\n` : "\n\n";
    }
  });

  td.addRule("lineBreak", {
    filter: "br",
    replacement() {
      return "<br>\n";
    }
  });

  td.addRule("horizontalRule", {
    filter(node) {
      return node.nodeName === "HR" || node.getAttribute?.("data-md-hr") === "true";
    },
    replacement() {
      return "\n\n---\n\n";
    }
  });

  td.addRule("fencedCodeBlock", {
    filter(node) {
      return node.nodeName === "PRE";
    },
    replacement(_, node) {
      const code = node.textContent.replace(/\n$/, "");
      const lang = node.querySelector("code")?.getAttribute("data-lang") || "";
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }
  });

  // 视频占位
  td.addRule("video", {
    filter: "video",
    replacement: (_, node) => {
      const src = node.getAttribute("src") || node.getAttribute("data-src") || "";
      return `\n\n> 🎬 视频：${src}\n\n`;
    }
  });

  return td;
}

function buildMarkdownVariants($) {
  const td = buildTurndown();
  const markdown = td.turndown($.html());

  const localClone = cheerio.load($.html());
  localClone("img").each((_, el) => {
    const $img = localClone(el);
    const localSrc = $img.attr("data-local-src");
    if (localSrc) {
      $img.attr("src", localSrc);
    }
  });

  const zipMarkdown = td.turndown(localClone.html());
  const assets = [];
  const seen = new Set();

  $("img").each((_, el) => {
    const localSrc = $(el).attr("data-local-src");
    if (localSrc && !seen.has(localSrc)) {
      seen.add(localSrc);
      assets.push(localSrc);
    }
  });

  return { markdown, zipMarkdown, assets };
}

module.exports = {
  downloadImage,
  downloadImages,
  buildMarkdownVariants,
  buildTurndown,
  normalizeRichContent,
  getBrowserLaunchOptions,
  preparePage
};
