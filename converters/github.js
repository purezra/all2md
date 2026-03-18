const axios = require("axios");

function parseRepoUrl(url) {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i);
  if (!match) {
    throw new Error("请提供有效的 GitHub 仓库链接，格式如 https://github.com/owner/repo");
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, "")
  };
}

function isAbsoluteUrl(value) {
  return /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:#|mailto:|tel:|data:)/i.test(value);
}

function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

function resolveRepoPath(baseDir, target) {
  const stack = baseDir.split("/").filter(Boolean);
  const parts = target.split("/");

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.join("/");
}

function rewriteRelativeMarkdown(markdown, { owner, repo, branch, readmePath }) {
  const normalizedReadmePath = toPosixPath(readmePath || "README.md");
  const readmeDir = normalizedReadmePath.includes("/")
    ? normalizedReadmePath.slice(0, normalizedReadmePath.lastIndexOf("/"))
    : "";
  const repoRoot = `https://github.com/${owner}/${repo}`;
  const rawRoot = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;

  const rewriteTarget = (target, isImage) => {
    const cleanTarget = (target || "").trim();
    if (!cleanTarget || isAbsoluteUrl(cleanTarget)) return cleanTarget;

    const suffixMatch = cleanTarget.match(/^([^?#]+)([?#].*)?$/);
    const purePath = suffixMatch ? suffixMatch[1] : cleanTarget;
    const suffix = suffixMatch ? suffixMatch[2] || "" : "";
    const resolvedPath = purePath.startsWith("/")
      ? purePath.replace(/^\/+/, "")
      : resolveRepoPath(readmeDir, purePath);

    if (isImage) {
      return `${rawRoot}/${resolvedPath}${suffix}`;
    }
    return `${repoRoot}/blob/${branch}/${resolvedPath}${suffix}`;
  };

  let output = markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (_, alt, target, tail) => {
    return `![${alt}](${rewriteTarget(target, true)}${tail})`;
  });

  output = output.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (_, text, target, tail) => {
    return `[${text}](${rewriteTarget(target, false)}${tail})`;
  });

  output = output.replace(/<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi, (_, before, quote, src, after) => {
    return `<img${before}src=${quote}${rewriteTarget(src, true)}${quote}${after}>`;
  });

  output = output.replace(/<(a)\b([^>]*?)\bhref=(["'])([^"']+)\3([^>]*)>/gi, (_, tag, before, quote, href, after) => {
    return `<${tag}${before}href=${quote}${rewriteTarget(href, false)}${quote}${after}>`;
  });

  return output;
}

async function convertGitHub(url) {
  const { owner, repo } = parseRepoUrl(url);
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "article-to-md"
  };

  let repoMeta;
  let readmeMeta;
  try {
    const [repoRes, readmeRes] = await Promise.all([
      axios.get(apiBase, { headers, timeout: 15000 }),
      axios.get(`${apiBase}/readme`, { headers, timeout: 15000 })
    ]);
    repoMeta = repoRes.data;
    readmeMeta = readmeRes.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error("未找到公开 GitHub 仓库或该仓库缺少 README");
    }
    throw new Error(`获取 GitHub 仓库 README 失败: ${error.message}`);
  }

  const readmeContent = Buffer.from(readmeMeta.content || "", "base64").toString("utf8");
  const branch = (readmeMeta.download_url || "").match(
    /^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\//
  )?.[1] || repoMeta.default_branch || "main";

  const normalizedMarkdown = rewriteRelativeMarkdown(readmeContent, {
    owner,
    repo,
    branch,
    readmePath: readmeMeta.path || "README.md"
  }).trim();

  const header = [
    `# ${repoMeta.full_name || `${owner}/${repo}`}`,
    repoMeta.description ? `> ${repoMeta.description}` : "",
    `原始仓库: ${repoMeta.html_url || `https://github.com/${owner}/${repo}`}`,
    "---",
    normalizedMarkdown
  ].filter(Boolean).join("\n\n");

  return {
    title: repoMeta.full_name || `${owner}/${repo}`,
    markdown: header,
    zipMarkdown: header,
    assets: [],
    platform: "github"
  };
}

module.exports = { convertGitHub, parseRepoUrl, rewriteRelativeMarkdown };
