const extractButton = document.getElementById('extract-btn');
const copyButton = document.getElementById('copy-btn');
const downloadButton = document.getElementById('download-btn');
const downloadZipButton = document.getElementById('download-zip-btn');
const themeToggle = document.getElementById('theme-toggle');
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('markdown-output');
const previewEl = document.getElementById('preview-output');
const platformPill = document.getElementById('platform-pill');
const titleMeta = document.getElementById('title-meta');
const pageMeta = document.getElementById('page-meta');
const heroTitle = document.getElementById('hero-title');
const sourceTab = document.getElementById('tab-source');
const previewTab = document.getElementById('tab-preview');

const SUPPORTED_MESSAGE = '当前稳定支持：微信公众号、知乎、今日头条、GitHub README。';
const THEME_STORAGE_KEY = 'all2md-plugin-theme';
let currentResult = null;

function setStatus(type, text) {
  statusEl.className = `status status-${type}`;
  statusEl.textContent = text;
}

function setBusy(busy) {
  extractButton.disabled = busy;
  extractButton.textContent = busy ? '提取中…' : '提取当前页';
}

function sanitizeFilename(value) {
  return String(value || 'article').replace(/[\\/:*?"<>|]/g, '-').trim() || 'article';
}

function extensionFromMime(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('svg')) return '.svg';
  if (normalized.includes('bmp')) return '.bmp';
  if (normalized.includes('avif')) return '.avif';
  return '.jpg';
}

function sanitizeAssetName(value, index, blob) {
  const fallback = `image-${index + 1}`;
  const raw = String(value || fallback).split('?')[0].split('#')[0];
  const matchedExt = raw.match(/\.[a-z0-9]+$/i);
  const ext = matchedExt ? matchedExt[0].toLowerCase() : extensionFromMime(blob?.type);
  const base = (matchedExt ? raw.slice(0, -matchedExt[0].length) : raw) || fallback;
  const safeBase = base.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '') || fallback;
  return `${String(index + 1).padStart(3, '0')}-${safeBase}${ext}`;
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeButton(theme) {
  themeToggle.textContent = theme === 'dark' ? '亮色' : '暗色';
  themeToggle.setAttribute('aria-label', theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  updateThemeButton(theme);
}

function loadTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || getSystemTheme();
  } catch (_error) {
    return getSystemTheme();
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_error) {
    // ignore
  }
}

function toggleTheme() {
  const nextTheme = (document.documentElement.dataset.theme || 'light') === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  saveTheme(nextTheme);
}

function setView(mode) {
  const preview = mode === 'preview';
  sourceTab.classList.toggle('active', !preview);
  previewTab.classList.toggle('active', preview);
  outputEl.classList.toggle('hidden', preview);
  previewEl.classList.toggle('hidden', !preview);
}

function renderPreview(markdown) {
  previewEl.innerHTML = window.All2MdMarkdown.markdownToHtml(markdown || '');
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['lib/platform.js', 'lib/markdown.js', 'content.js']
  });
}

async function sendExtractMessage(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'ALL2MD_EXTRACT_PAGE' });
  } catch (error) {
    if (!/Receiving end does not exist/i.test(error.message || '')) {
      throw error;
    }
    await ensureContentScript(tabId);
    return await chrome.tabs.sendMessage(tabId, { type: 'ALL2MD_EXTRACT_PAGE' });
  }
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
}

function downloadMarkdown(filename, markdown) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(`${sanitizeFilename(filename)}.md`, blob);
}

function replaceAssetsInMarkdown(markdown, assetMap) {
  let output = markdown;
  for (const [remote, local] of assetMap.entries()) {
    output = output.split(remote).join(local);
  }
  return output;
}

async function fetchAsset(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`下载图片失败: ${response.status} ${url}`);
  return await response.blob();
}

async function downloadZip(result) {
  if (!result?.markdown) return;
  const zip = new JSZip();
  const assets = Array.isArray(result.assets) ? result.assets : [];
  const assetMap = new Map();
  const usedNames = new Set();

  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index];
    if (!asset?.url || assetMap.has(asset.url)) continue;
    try {
      const blob = await fetchAsset(asset.url);
      let fileName = sanitizeAssetName(asset.filename, index, blob);
      while (usedNames.has(fileName)) {
        fileName = sanitizeAssetName(`${fileName.replace(/\.[a-z0-9]+$/i, '')}-${index + 1}`, index, blob);
      }
      usedNames.add(fileName);
      const localPath = `images/${fileName}`;
      assetMap.set(asset.url, localPath);
      zip.file(localPath, blob);
    } catch (_error) {
      // keep remote link
    }
  }

  const markdown = replaceAssetsInMarkdown(result.markdown, assetMap);
  zip.file(`${sanitizeFilename(result.title)}.md`, markdown);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(`${sanitizeFilename(result.title)}.zip`, blob);
}

async function extractCurrentPage() {
  setBusy(true);
  setStatus('info', '正在从当前标签页提取内容…');

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('找不到当前标签页');
    if (!/^https?:/i.test(tab.url || '')) {
      throw new Error('当前标签页不是普通网页，无法提取');
    }

    pageMeta.textContent = tab.url || '当前页面';
    heroTitle.textContent = tab.title || '当前网页';

    const response = await sendExtractMessage(tab.id);
    if (!response?.ok) throw new Error(response?.error || SUPPORTED_MESSAGE);

    currentResult = response.result;
    outputEl.value = currentResult.markdown || '';
    renderPreview(currentResult.markdown || '');
    platformPill.textContent = (currentResult.platformLabel || currentResult.platform || '未知').toUpperCase();
    titleMeta.textContent = currentResult.title || '未命名内容';
    heroTitle.textContent = currentResult.title || tab.title || '当前网页';
    pageMeta.textContent = currentResult.url || tab.url || '当前页面';
    copyButton.disabled = !currentResult.markdown;
    downloadButton.disabled = !currentResult.markdown;
    downloadZipButton.disabled = !currentResult.markdown;
    setStatus('success', `提取完成，共 ${currentResult.markdown.length.toLocaleString()} 个字符，${(currentResult.assets || []).length} 张图片。`);
  } catch (error) {
    currentResult = null;
    copyButton.disabled = true;
    downloadButton.disabled = true;
    downloadZipButton.disabled = true;
    outputEl.value = '';
    previewEl.innerHTML = '';
    platformPill.textContent = '未支持';
    titleMeta.textContent = '尚无结果';
    setStatus('error', `${error.message || '提取失败'} ${SUPPORTED_MESSAGE}`.trim());
  } finally {
    setBusy(false);
  }
}

extractButton.addEventListener('click', extractCurrentPage);
sourceTab.addEventListener('click', () => setView('source'));
previewTab.addEventListener('click', () => setView('preview'));
themeToggle.addEventListener('click', toggleTheme);

copyButton.addEventListener('click', async () => {
  if (!currentResult?.markdown) return;
  await navigator.clipboard.writeText(currentResult.markdown);
  setStatus('success', 'Markdown 已复制到剪贴板。');
});

downloadButton.addEventListener('click', () => {
  if (!currentResult?.markdown) return;
  downloadMarkdown(currentResult.title, currentResult.markdown);
  setStatus('success', '已触发 Markdown 下载。');
});

downloadZipButton.addEventListener('click', async () => {
  if (!currentResult?.markdown) return;
  downloadZipButton.disabled = true;
  setStatus('info', '正在打包 ZIP（包含图片）…');
  try {
    await downloadZip(currentResult);
    setStatus('success', '已触发 ZIP 下载。');
  } catch (error) {
    setStatus('error', error.message || 'ZIP 打包失败');
  } finally {
    downloadZipButton.disabled = false;
  }
});

getActiveTab().then(tab => {
  pageMeta.textContent = tab?.url || '当前页面';
  heroTitle.textContent = tab?.title || '当前网页';
}).catch(() => {});

applyTheme(loadTheme());
setView('source');
