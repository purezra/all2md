# Install Guide

## For testers

### Load the extension locally

1. Open `chrome://extensions/`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select the `plugin/` folder

### Use the extension

1. Open a supported article page
2. Click the `All2MD` icon in the Chrome toolbar
3. Click `提取当前页`
4. Copy the Markdown, download `.md`, or download `.zip`

## Currently supported pages

- WeChat public articles
- Zhihu answers and articles
- Toutiao article pages
- GitHub repository README pages

## Notes

- Extraction runs in the browser on the current page
- ZIP export tries to download the page images and package them locally
- Some sites may block part of the image download because of anti-hotlink rules

## Reload after updates

If you receive a new plugin package:

1. Replace the local plugin folder with the new version
2. Open `chrome://extensions/`
3. Click `Reload` on the extension card
