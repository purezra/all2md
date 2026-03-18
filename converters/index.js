const { convertWeChat } = require("./wechat");
const { convertZhihu } = require("./zhihu");
const { convertToutiao } = require("./toutiao");
const { convertX } = require("./x");
const { convertGitHub } = require("./github");
const { detectPlatform } = require("../plugin/lib/platform");

function extractGitHubRepo(input) {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();

  const titleMatch = trimmed.match(/github\s*-\s*([a-z0-9_.-]+\/[a-z0-9_.-]+)/i);
  if (titleMatch) return titleMatch[1];

  const repoMatch = trimmed.match(/(?:^|[\s(（])([a-z0-9_.-]+\/[a-z0-9_.-]+)(?=$|[\s:：)）])/i);
  if (repoMatch) return repoMatch[1];

  return "";
}

function extractUrl(input) {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s"'`<>]+/i);
  return match ? match[0].trim() : trimmed;
}

function normalizeInput(input) {
  const url = extractUrl(input);
  if (/^https?:\/\//i.test(url)) return url;

  const repo = extractGitHubRepo(input);
  if (repo) return `https://github.com/${repo}`;

  return url;
}

async function convertArticle(input, platformHint = "") {
  const url = normalizeInput(input);
  const normalizedHint = typeof platformHint === "string" ? platformHint.trim().toLowerCase() : "";
  const platform = normalizedHint || detectPlatform(url);

  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("请提供有效的文章链接或包含链接的分享文本");
  }
  if (!platform) {
    throw new Error("仅支持微信公众号、知乎、今日头条、X/Twitter 和 GitHub 仓库链接");
  }
  if (platform === "wechat") return await convertWeChat(url);
  if (platform === "zhihu") return await convertZhihu(url);
  if (platform === "toutiao") return await convertToutiao(url);
  if (platform === "x") return await convertX(url);
  if (platform === "github") return await convertGitHub(url);
}

module.exports = { convertArticle, detectPlatform, extractUrl, extractGitHubRepo, normalizeInput };

