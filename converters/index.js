const { convertWeChat } = require("./wechat");
const { convertZhihu } = require("./zhihu");

function detectPlatform(url) {
  if (url.includes("mp.weixin.qq.com")) return "wechat";
  if (url.includes("zhihu.com")) return "zhihu";
  return null;
}

async function convertArticle(url) {
  const platform = detectPlatform(url);
  if (!platform) throw new Error("仅支持微信公众号（mp.weixin.qq.com）和知乎文章链接");
  if (platform === "wechat") return await convertWeChat(url);
  if (platform === "zhihu") return await convertZhihu(url);
}

module.exports = { convertArticle };
