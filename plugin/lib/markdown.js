(function initMarkdownHelper(global) {
  function collapseWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function repeat(value, count) {
    return new Array(count + 1).join(value);
  }

  function trimBlock(value) {
    return String(value || '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function escapeMarkdownText(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/([*_`~\[\]])/g, '\\$1');
  }

  function escapeCodeFence(value) {
    return String(value || '').replace(/```/g, '``\\`');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function absolutizeUrl(url, baseUrl) {
    if (!url) return '';
    try {
      return new URL(url, baseUrl).href;
    } catch (_error) {
      return url;
    }
  }

  function textFromNode(node) {
    return collapseWhitespace(node?.textContent || '');
  }

  function convertChildren(node, context) {
    return Array.from(node.childNodes || []).map(child => convertNode(child, context)).join('');
  }

  function convertList(node, context, ordered) {
    const items = Array.from(node.children || []).filter(child => child.tagName === 'LI');
    if (!items.length) return '';

    return `\n\n${items.map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : '- ';
      const raw = trimBlock(convertChildren(item, context));
      const lines = raw.split('\n');
      return lines.map((line, lineIndex) => {
        if (!line) return lineIndex === 0 ? marker.trimEnd() : '';
        return lineIndex === 0 ? `${marker}${line}` : `  ${line}`;
      }).join('\n');
    }).join('\n')}\n\n`;
  }

  function convertTable(node) {
    const rows = Array.from(node.querySelectorAll('tr'));
    if (!rows.length) return '';

    const matrix = rows.map(row => Array.from(row.children).map(cell => collapseWhitespace(cell.textContent || '')));
    const header = matrix[0];
    if (!header.length) return '';
    const divider = header.map(() => '---');
    const body = matrix.slice(1);
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${divider.join(' | ')} |`
    ].concat(body.map(row => `| ${row.join(' | ')} |`));
    return `\n\n${lines.join('\n')}\n\n`;
  }

  function convertNode(node, context) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'noscript'].includes(tag)) return '';
    if (tag === 'br') return '  \n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'strong' || tag === 'b') return `**${trimBlock(convertChildren(node, context))}**`;
    if (tag === 'em' || tag === 'i') return `*${trimBlock(convertChildren(node, context))}*`;
    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${collapseWhitespace(node.textContent || '')}\``;
    if (tag === 'pre') {
      const code = node.textContent || '';
      const codeChild = node.querySelector('code');
      const cls = codeChild?.className || node.className || '';
      const lang = (cls.match(/language-([a-z0-9+#-]+)/i) || [])[1] || '';
      return `\n\n\`\`\`${lang.toLowerCase()}\n${escapeCodeFence(code.trimEnd())}\n\`\`\`\n\n`;
    }
    if (tag === 'a') {
      const href = absolutizeUrl(node.getAttribute('href'), context.baseUrl);
      const text = trimBlock(convertChildren(node, context)) || href;
      return href ? `[${text}](${href})` : text;
    }
    if (tag === 'img') {
      const src = absolutizeUrl(node.getAttribute('src'), context.baseUrl);
      if (!src) return '';
      const alt = escapeMarkdownText(node.getAttribute('alt') || '');
      return `\n\n![${alt}](${src})\n\n`;
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const content = trimBlock(convertChildren(node, context));
      if (!content) return '';
      return `\n\n${repeat('#', level)} ${content}\n\n`;
    }
    if (tag === 'p') {
      const content = trimBlock(convertChildren(node, context));
      return content ? `\n\n${content}\n\n` : '';
    }
    if (tag === 'blockquote') {
      const content = trimBlock(convertChildren(node, context));
      if (!content) return '';
      return `\n\n${content.split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
    }
    if (tag === 'ul') return convertList(node, context, false);
    if (tag === 'ol') return convertList(node, context, true);
    if (tag === 'table') return convertTable(node);
    if (tag === 'li') return trimBlock(convertChildren(node, context));

    const displayBreakTags = new Set(['article', 'section', 'main', 'div', 'figure', 'figcaption']);
    const content = convertChildren(node, context);
    if (displayBreakTags.has(tag)) {
      const trimmed = trimBlock(content);
      return trimmed ? `\n\n${trimmed}\n\n` : '';
    }
    return content;
  }

  function htmlToMarkdown(html, options = {}) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html || '', 'text/html');
    const markdown = trimBlock(convertChildren(doc.body, {
      baseUrl: options.baseUrl || location.href
    }));
    return markdown.replace(/\n{3,}/g, '\n\n').trim();
  }

  function renderInlineMarkdown(text) {
    let html = escapeHtml(text || '');
    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt, src) => `<img src="${src}" alt="${escapeHtml(alt)}">`);
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, label, href) => `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return html;
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let listType = '';
    let listItems = [];
    let quoteLines = [];
    let codeFence = false;
    let codeLang = '';
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      blocks.push(`<${tag}>${listItems.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
      listItems = [];
      listType = '';
    }

    function flushQuote() {
      if (!quoteLines.length) return;
      blocks.push(`<blockquote>${quoteLines.map(line => `<p>${renderInlineMarkdown(line)}</p>`).join('')}</blockquote>`);
      quoteLines = [];
    }

    function flushCode() {
      if (!codeLines.length && !codeFence) return;
      blocks.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      codeLines = [];
      codeLang = '';
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/\t/g, '  ');
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        if (!codeFence) {
          flushParagraph();
          flushList();
          flushQuote();
          codeFence = true;
          codeLang = trimmed.slice(3).trim();
        } else {
          codeFence = false;
          flushCode();
        }
        continue;
      }

      if (codeFence) {
        codeLines.push(rawLine);
        continue;
      }

      if (!trimmed) {
        flushParagraph();
        flushList();
        flushQuote();
        continue;
      }

      if (/^#{1,6}\s+/.test(trimmed)) {
        flushParagraph();
        flushList();
        flushQuote();
        const level = trimmed.match(/^#+/)[0].length;
        blocks.push(`<h${level}>${renderInlineMarkdown(trimmed.slice(level).trim())}</h${level}>`);
        continue;
      }

      if (trimmed === '---') {
        flushParagraph();
        flushList();
        flushQuote();
        blocks.push('<hr>');
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        flushParagraph();
        flushList();
        quoteLines.push(trimmed.replace(/^>\s?/, ''));
        continue;
      }

      const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      const bulletMatch = trimmed.match(/^-\s+(.+)$/);
      if (orderedMatch || bulletMatch) {
        flushParagraph();
        flushQuote();
        const nextType = orderedMatch ? 'ol' : 'ul';
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        listItems.push((orderedMatch || bulletMatch)[1]);
        continue;
      }

      flushList();
      flushQuote();
      paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();
    flushQuote();
    if (codeFence) flushCode();

    return blocks.join('');
  }

  global.All2MdMarkdown = {
    htmlToMarkdown,
    markdownToHtml,
    collapseWhitespace,
    absolutizeUrl,
    textFromNode
  };
})(globalThis);
