# Kindle to PDF

A Chrome extension that automatically captures pages from Kindle Cloud Reader and converts them into PDF files.

## Features

- Automatic page-by-page screenshot capture from Kindle Cloud Reader
- PDF generation from captured images with split file support
- Persistent image storage via IndexedDB (survives service worker termination)
- Auto-detection of end-of-book (stops gracefully when no more pages)
- Real-time progress bar during capture and PDF generation

## Installation

1. Clone or download this repository
   ```
   git clone https://github.com/daikiymmt/kindle-to-pdf.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the cloned folder

## Usage

1. Open a book on [Kindle Cloud Reader](https://read.amazon.co.jp/)
2. Navigate to the page where you want to start capturing
3. Click the extension icon to open the popup
4. Configure the settings:
   - **Capture count** — Number of pages to capture (auto-stops at end of book)
   - **Max wait time (ms)** — Max wait time for page load (default: 2000ms)
   - **PDF split size (pages)** — Pages per PDF file (default: 50)
5. Click **Start Capture** to start capturing
6. Once complete, click **PDF Download** to generate and download PDFs

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Capture screenshots of the visible tab |
| `debugger` | Send key events for page navigation and monitor network activity |
| `unlimitedStorage` | Store large volumes of captured images in IndexedDB |

## Technical Details

- **Manifest V3** Chrome Extension
- **IndexedDB** for persistent image storage (prevents data loss on service worker termination)
- **Chrome Debugger Protocol** for network idle detection and key input dispatch
- **jsPDF** for client-side PDF generation

## License

MIT
