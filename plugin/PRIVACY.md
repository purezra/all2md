# Privacy Policy

Last updated: 2026-03-18

All2MD Chrome Plugin is designed to convert the current article page into Markdown inside the user's browser.

## What the extension does

The extension reads the currently opened supported webpage, extracts article content, converts it to Markdown, and allows the user to copy or download the result.

## Data processing

- Article extraction is performed locally in the browser.
- The extension does not upload article正文 or Markdown output to a remote server.
- The extension does not create user accounts.
- The extension does not collect analytics, advertising identifiers, or tracking events.

## Permissions used

- `activeTab`: used to access the currently active tab when the user clicks the extension.
- `tabs`: used to read the current tab title and URL for extraction context.
- `scripting`: used to inject the extraction script into supported pages when needed.
- `downloads`: used to let the user save `.md` or `.zip` files locally.

## Network access

The extension may request image resources referenced by the current page when the user chooses `下载 .zip` so that images can be packaged together with the Markdown file.

These requests are used only to fetch page assets requested by the user and are not used for profiling or tracking.

## Stored data

The extension does not store personal content in a remote database.

Downloaded files are saved locally by the browser to the user's device.

## Contact

If you need a public-facing support email or website before Chrome Web Store submission, replace this section with your own contact information.
