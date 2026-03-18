(function initAll2MdContent(global) {
  const { htmlToMarkdown, collapseWhitespace, absolutizeUrl } = global.All2MdMarkdown;
  const { detectPlatform, platformLabel, extractXResource } = global.All2MdPlatform;

  function findFirst(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function walkStructuredData(input, visit, seen = new WeakSet()) {
    if (!input || typeof input !== 'object') return;
    if (seen.has(input)) return;
    seen.add(input);
    visit(input);
    if (Array.isArray(input)) {
      input.forEach(item => walkStructuredData(item, visit, seen));
      return;
    }
    Object.values(input).forEach(value => walkStructuredData(value, visit, seen));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizeXText(value) {
    return collapseWhitespace(String(value || '').replace(/\s+/g, ' ').trim());
  }

  function safeUrl(value, baseUrl) {
    try {
      return absolutizeUrl(value, baseUrl);
    } catch (_error) {
      return '';
    }
  }

  function pickImageSource(node, baseUrl) {
    const candidates = [
      node?.getAttribute?.('src'),
      node?.getAttribute?.('data-src'),
      node?.getAttribute?.('data-original'),
      node?.getAttribute?.('data-actualsrc'),
      node?.getAttribute?.('data-image-url'),
      node?.getAttribute?.('data-web-uri')
    ];

    for (const candidate of candidates) {
      const normalized = safeUrl(candidate, baseUrl);
      if (normalized) return normalized;
    }
    return '';
  }

  function guessAssetFilename(src, index) {
    const fallback = `image-${index + 1}.jpg`;
    try {
      const parsed = new URL(src);
      const pathname = parsed.pathname || '';
      const rawName = pathname.split('/').pop() || fallback;
      const cleanName = rawName.split('?')[0].split('#')[0].replace(/[^a-z0-9._-]+/gi, '-');
      if (/\.[a-z0-9]{2,5}$/i.test(cleanName)) return cleanName;
      return `${cleanName || `image-${index + 1}`}.jpg`;
    } catch (_error) {
      return fallback;
    }
  }

  function isUsefulImageUrl(src) {
    if (!src) return false;
    if (/^data:/i.test(src)) return false;
    if (/\/(emoji|avatar|profile_images|abs-0|hashflags)\//i.test(src)) return false;
    return true;
  }

  function collectAssetsFromHtml(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const assets = [];
    const seen = new Set();

    doc.querySelectorAll('img').forEach((img, index) => {
      const src = pickImageSource(img, sourceUrl);
      if (!isUsefulImageUrl(src) || seen.has(src)) return;
      seen.add(src);
      assets.push({
        url: src,
        filename: guessAssetFilename(src, index)
      });
    });

    return assets;
  }

  function cloneAndNormalize(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, noscript').forEach(node => node.remove());
    clone.querySelectorAll('[href]').forEach(node => {
      node.setAttribute('href', absolutizeUrl(node.getAttribute('href'), location.href));
    });
    clone.querySelectorAll('img').forEach(node => {
      const resolved = pickImageSource(node, location.href);
      if (resolved) node.setAttribute('src', resolved);
    });
    clone.querySelectorAll('[src]:not(img)').forEach(node => {
      node.setAttribute('src', absolutizeUrl(node.getAttribute('src'), location.href));
    });
    return clone;
  }

  function buildMarkdownResult({ title, platform, sourceUrl, html }) {
    const bodyMarkdown = htmlToMarkdown(html, { baseUrl: sourceUrl });
    const markdown = [
      `# ${title}`,
      `原始链接: ${sourceUrl}`,
      `平台: ${platformLabel(platform)}`,
      '---',
      bodyMarkdown
    ].filter(Boolean).join('\n\n');

    return {
      title,
      platform,
      platformLabel: platformLabel(platform),
      url: sourceUrl,
      markdown,
      assets: collectAssetsFromHtml(html, sourceUrl)
    };
  }

  function extractGitHub() {
    const readme = findFirst([
      "[data-testid='readme'] article",
      "[data-testid='readme']",
      'article.markdown-body',
      '.markdown-body'
    ]);
    if (!readme) throw new Error('当前 GitHub 页面没有找到 README 内容');

    const title = collapseWhitespace(document.querySelector('strong.mr-2 a')?.textContent || document.title || 'GitHub README');
    return buildMarkdownResult({
      title,
      platform: 'github',
      sourceUrl: location.href,
      html: cloneAndNormalize(readme).innerHTML
    });
  }

  function extractWeChat() {
    const content = document.querySelector('#js_content');
    if (!content) throw new Error('当前微信公众号页面没有找到正文');

    const clone = cloneAndNormalize(content);
    clone.querySelectorAll('img[data-src]').forEach(img => {
      img.setAttribute('src', img.getAttribute('data-src'));
    });

    const title = collapseWhitespace(document.querySelector('#activity-name')?.textContent || document.title || '微信公众号文章');
    const author = collapseWhitespace(document.querySelector('#js_name')?.textContent || '');
    const date = collapseWhitespace(document.querySelector('#publish_time')?.textContent || '');
    const header = [
      `<h1>${escapeHtml(title)}</h1>`,
      author ? `<p><strong>公众号：</strong>${escapeHtml(author)}</p>` : '',
      date ? `<p><strong>发布时间：</strong>${escapeHtml(date)}</p>` : '',
      '<hr />',
      clone.innerHTML
    ].filter(Boolean).join('');

    return buildMarkdownResult({ title, platform: 'wechat', sourceUrl: location.href, html: header });
  }

  function extractZhihu() {
    const content = findFirst(['.Post-RichTextContainer', '.RichContent-inner', '.RichText', 'article']);
    if (!content) throw new Error('当前知乎页面没有找到正文');

    const title = collapseWhitespace(
      document.querySelector('.Post-Title')?.textContent ||
      document.querySelector('.QuestionHeader-title')?.textContent ||
      document.title ||
      '知乎内容'
    );
    const author = collapseWhitespace(document.querySelector('.AuthorInfo-name')?.textContent || '');
    const header = [
      `<h1>${escapeHtml(title)}</h1>`,
      author ? `<p><strong>作者：</strong>${escapeHtml(author)}</p>` : '',
      '<hr />',
      cloneAndNormalize(content).innerHTML
    ].filter(Boolean).join('');

    return buildMarkdownResult({ title, platform: 'zhihu', sourceUrl: location.href, html: header });
  }

  function extractToutiao() {
    const content = findFirst(['article', '.article-content', '.tt-article-content', "[data-testid='article-content']", 'main']);
    if (!content) throw new Error('当前头条页面没有找到正文');

    const title = collapseWhitespace(document.querySelector('h1')?.textContent || document.title || '头条文章');
    const author = collapseWhitespace(findFirst(['.article-author', '.author-name'])?.textContent || '');
    const header = [
      `<h1>${escapeHtml(title)}</h1>`,
      author ? `<p><strong>作者：</strong>${escapeHtml(author)}</p>` : '',
      '<hr />',
      cloneAndNormalize(content).innerHTML
    ].filter(Boolean).join('');

    return buildMarkdownResult({ title, platform: 'toutiao', sourceUrl: location.href, html: header });
  }

  function buildXHtml(meta, pageUrl) {
    const bodyParts = [];
    if (meta.html) bodyParts.push(`<div>${meta.html}</div>`);
    else if (meta.text) bodyParts.push(`<p>${escapeHtml(meta.text).replace(/\n/g, '<br>')}</p>`);
    for (const image of meta.images || []) {
      bodyParts.push(`<p><img src="${absolutizeUrl(image, pageUrl)}" alt="x-media" /></p>`);
    }
    return [
      `<h1>${escapeHtml(meta.title || 'X 内容')}</h1>`,
      meta.author ? `<p><strong>作者：</strong>${escapeHtml(meta.author)}</p>` : '',
      '<hr />',
      ...bodyParts
    ].filter(Boolean).join('');
  }

  function extractXFromStructuredScripts(resource, pageUrl) {
    const scripts = Array.from(document.querySelectorAll('script'));
    const candidates = [];
    for (const script of scripts) {
      const raw = script.textContent || '';
      if (!raw.trim()) continue;
      const parsed = safeJsonParse(raw);
      if (!parsed) continue;
      walkStructuredData(parsed, node => {
        if (!node || typeof node !== 'object') return;
        const articleBody = normalizeXText(node.articleBody || node.description || node.full_text || node.text);
        const headline = normalizeXText(node.headline || node.title || '');
        const url = String(node.url || node.permalink || '');
        const image = Array.isArray(node.image)
          ? node.image.filter(Boolean)
          : Array.isArray(node.photos)
            ? node.photos.map(item => item?.url || item?.media_url_https).filter(Boolean)
            : (node.image ? [node.image] : []);
        const authorName = typeof node.author === 'object'
          ? (node.author.alternateName || node.author.name || '')
          : (node.user?.screen_name ? `@${node.user.screen_name}` : '');
        const score = (articleBody ? Math.min(articleBody.length, 1200) : 0) + (headline ? 40 : 0) + (image.length ? 15 : 0) + (url && resource.id && url.includes(resource.id) ? 200 : 0);
        if (score < 80) return;
        candidates.push({ score, title: headline || articleBody.slice(0, 80) || 'X 内容', text: articleBody, html: '', images: image, author: authorName, url: url || pageUrl });
      });
    }
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function extractXFromLongformDom(pageUrl) {
    const candidates = Array.from(document.querySelectorAll("main article, main section, article, [role='article'], [data-testid='primaryColumn'] section"))
      .map(node => {
        const paragraphs = Array.from(node.querySelectorAll('p'));
        const text = normalizeXText(node.innerText || '');
        return { node, text, score: text.length + paragraphs.length * 40 };
      })
      .filter(item => item.text.length > 140)
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;
    const title = normalizeXText(findFirst(['h1', 'header h1'])?.textContent || document.title || 'X 内容');
    const clone = cloneAndNormalize(best.node);
    const images = Array.from(clone.querySelectorAll('img')).map(img => pickImageSource(img, pageUrl)).filter(src => /twimg\.com/i.test(src));
    return { title, text: best.text, html: clone.innerHTML, images, author: '' };
  }

  function extractX() {
    const pageUrl = location.href;
    const resource = extractXResource(pageUrl);
    const targetPath = location.pathname;
    const articles = Array.from(document.querySelectorAll('article'));
    const article = articles.find(node => Array.from(node.querySelectorAll("a[href*='/status/'], a[href*='/article/']")).some(anchor => (anchor.getAttribute('href') || '').includes(targetPath))) || articles[0];

    const titleFromMeta = document.querySelector('meta[property="og:title"]')?.content || document.querySelector('meta[name="twitter:title"]')?.content || document.title || 'X 内容';
    const descFromMeta = document.querySelector('meta[property="og:description"]')?.content || document.querySelector('meta[name="twitter:description"]')?.content || '';
    const imageFromMeta = document.querySelector('meta[property="og:image"]')?.content || document.querySelector('meta[name="twitter:image"]')?.content || '';
    const structuredMeta = extractXFromStructuredScripts(resource, pageUrl);
    const longformMeta = extractXFromLongformDom(pageUrl);

    if (!article) {
      const fallbackMeta = structuredMeta || longformMeta;
      if (fallbackMeta) return buildMarkdownResult({ title: fallbackMeta.title || collapseWhitespace(descFromMeta.split('\n')[0] || titleFromMeta), platform: 'x', sourceUrl: fallbackMeta.url || pageUrl, html: buildXHtml(fallbackMeta, pageUrl) });
      if (!collapseWhitespace(descFromMeta)) throw new Error('当前 X 页面没有找到可提取内容');
      return buildMarkdownResult({
        title: collapseWhitespace(descFromMeta.split('\n')[0] || titleFromMeta),
        platform: 'x',
        sourceUrl: pageUrl,
        html: [`<h1>${escapeHtml(titleFromMeta)}</h1>`, '<hr />', `<p>${escapeHtml(descFromMeta)}</p>`, imageFromMeta ? `<p><img src="${absolutizeUrl(imageFromMeta, pageUrl)}" alt="x-cover" /></p>` : ''].join('')
      });
    }

    const authorNode = article.querySelector("[data-testid='User-Name']");
    const names = Array.from(authorNode?.querySelectorAll('span') || []).map(node => collapseWhitespace(node.textContent)).filter(Boolean);
    const author = names.find(item => !item.startsWith('@')) || '';
    const username = names.find(item => item.startsWith('@')) || '';
    const textNode = article.querySelector("[data-testid='tweetText']");
    const textHtml = textNode?.innerHTML || '';
    const textPlain = collapseWhitespace(textNode?.textContent || descFromMeta || titleFromMeta);
    const images = Array.from(article.querySelectorAll('img')).map(img => pickImageSource(img, pageUrl)).filter(src => /twimg\.com/i.test(src));

    const preferred = textPlain.length >= 40
      ? { title: textPlain || titleFromMeta, author: [author, username].filter(Boolean).join(' '), html: textHtml, text: textPlain, images }
      : (structuredMeta || longformMeta || { title: textPlain || titleFromMeta, author: [author, username].filter(Boolean).join(' '), html: textHtml, text: textPlain || descFromMeta, images: images.length ? images : (structuredMeta?.images || []) });

    return buildMarkdownResult({ title: preferred.title || collapseWhitespace(titleFromMeta), platform: 'x', sourceUrl: pageUrl, html: buildXHtml(preferred, pageUrl) });
  }

  function extractCurrentPage() {
    const platform = detectPlatform(location.href) || 'unknown';
    if (platform === 'github') return extractGitHub();
    if (platform === 'wechat') return extractWeChat();
    if (platform === 'zhihu') return extractZhihu();
    if (platform === 'toutiao') return extractToutiao();
    if (platform === 'x') return extractX();
    throw new Error('当前页面暂不支持提取');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ALL2MD_EXTRACT_PAGE') return undefined;
    try {
      sendResponse({ ok: true, result: extractCurrentPage() });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || '提取失败' });
    }
    return true;
  });
})(globalThis);
