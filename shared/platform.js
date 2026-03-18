(function initAll2MdPlatform(global) {
  function detectPlatform(url) {
    const href = String(url || "");
    if (/mp\.weixin\.qq\.com/i.test(href)) return "wechat";
    if (/zhihu\.com/i.test(href)) return "zhihu";
    if (/toutiao\.com/i.test(href)) return "toutiao";
    if (/(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com/i.test(href)) return "x";
    if (/github\.com/i.test(href)) return "github";
    return null;
  }

  function platformLabel(platform) {
    if (platform === "wechat") return "微信";
    if (platform === "zhihu") return "知乎";
    if (platform === "toutiao") return "头条";
    if (platform === "x") return "X";
    if (platform === "github") return "GitHub";
    if (platform === "batch") return "批量";
    return "网页";
  }

  function extractXResource(url) {
    const match = String(url || "").match(/\/(status|article)\/(\d+)/i);
    return {
      kind: match?.[1]?.toLowerCase() || "",
      id: match?.[2] || ""
    };
  }

  const api = { detectPlatform, platformLabel, extractXResource };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.All2MdPlatform = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
