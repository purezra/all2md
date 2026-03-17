const { convertWeChat } = require("./wechat");
const { convertZhihu } = require("./zhihu");
const { convertToutiao } = require("./toutiao");

function extractUrl(input) {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s"'`<>]+/i);
  return match ? match[0].trim() : trimmed;
}

function detectPlatform(url) {
  if (url.includes("mp.weixin.qq.com")) return "wechat";
  if (url.includes("zhihu.com")) return "zhihu";
  if (url.includes("toutiao.com")) return "toutiao";
  return null;
}

async function convertArticle(input, platformHint = "") {
  const url = extractUrl(input);
  const normalizedHint = typeof platformHint === "string" ? platformHint.trim().toLowerCase() : "";
  const platform = normalizedHint || detectPlatform(url);

  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("请提供有效的文章链接或包含链接的分享文本");
  }
  if (!platform) {
    throw new Error("仅支持微信公众号、知乎和今日头条文章链接");
  }
  if (platform === "wechat") return await convertWeChat(url);
  if (platform === "zhihu") return await convertZhihu(url);
  if (platform === "toutiao") return await convertToutiao(url);
}

module.exports = { convertArticle, detectPlatform, extractUrl };
