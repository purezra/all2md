const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { getBrowserLaunchOptions, preparePage } = require("./helper");

const PROJECT_PROFILE_DIR = path.join(__dirname, "../.chrome-profile");

let browserPromise = null;
let browserMode = "disconnected";

function normalizeWsEndpoint(input) {
  if (!input) return "";
  if (input.startsWith("ws://") || input.startsWith("wss://")) return input;
  return "";
}

function normalizeHttpEndpoint(input) {
  if (!input) return "";
  if (input.startsWith("http://") || input.startsWith("https://")) return input.replace(/\/$/, "");
  return "";
}

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
}

async function resolveWsEndpoint() {
  const wsEndpoint = normalizeWsEndpoint(process.env.PUPPETEER_WS_ENDPOINT);
  if (wsEndpoint) return wsEndpoint;

  const browserUrl = normalizeHttpEndpoint(process.env.PUPPETEER_BROWSER_URL || "http://127.0.0.1:9222");
  const version = await fetchJson(`${browserUrl}/json/version`);
  if (!version.webSocketDebuggerUrl) {
    throw new Error("Remote Chrome missing webSocketDebuggerUrl");
  }
  return version.webSocketDebuggerUrl;
}

async function connectBrowser() {
  const wsEndpoint = await resolveWsEndpoint();
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  browserMode = "remote";
  browser.on("disconnected", () => {
    browserPromise = null;
    browserMode = "disconnected";
  });
  return browser;
}

async function launchBrowser() {
  const launchOptions = getBrowserLaunchOptions();
  if (!launchOptions.userDataDir && launchOptions.headless === false) {
    if (!fs.existsSync(PROJECT_PROFILE_DIR)) {
      fs.mkdirSync(PROJECT_PROFILE_DIR, { recursive: true });
    }
    launchOptions.userDataDir = PROJECT_PROFILE_DIR;
  }

  const browser = await puppeteer.launch(launchOptions);
  browserMode = "managed";
  browser.on("disconnected", () => {
    browserPromise = null;
    browserMode = "disconnected";
  });
  return browser;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        return await connectBrowser();
      } catch (connectError) {
        console.warn(`[browser] remote connect failed: ${connectError.message}`);
        return await launchBrowser();
      }
    })().catch(error => {
      browserPromise = null;
      browserMode = "disconnected";
      throw error;
    });
  }

  return await browserPromise;
}

async function withPage(referer, task) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await preparePage(page, referer);
    return await task(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function getBrowserHealth() {
  try {
    const browser = await getBrowser();
    const pages = await browser.pages().catch(() => []);
    const launchOptions = getBrowserLaunchOptions();
    return {
      ok: true,
      mode: browserMode,
      wsConfigured: Boolean(process.env.PUPPETEER_WS_ENDPOINT || process.env.PUPPETEER_BROWSER_URL),
      headless: launchOptions.headless,
      executablePath: launchOptions.executablePath || "",
      userDataDir: launchOptions.userDataDir || (launchOptions.headless === false ? PROJECT_PROFILE_DIR : ""),
      pageCount: pages.length
    };
  } catch (error) {
    return {
      ok: false,
      mode: browserMode,
      wsConfigured: Boolean(process.env.PUPPETEER_WS_ENDPOINT || process.env.PUPPETEER_BROWSER_URL),
      error: error.message
    };
  }
}

module.exports = {
  getBrowser,
  getBrowserHealth,
  withPage
};
