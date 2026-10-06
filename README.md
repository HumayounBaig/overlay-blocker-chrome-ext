# ClearView Overlay Control

A dependency-free Chrome extension that reduces dark scrims placed over streaming video. It also includes a visual picker for hiding player controls or other distracting UI on a per-site basis.

## Features

- Detects dark, video-sized overlays without hard-coding a single streaming service
- Slider from original appearance to complete overlay removal
- Per-site enable/disable and settings
- Click-to-hide picker for specific player UI
- Automatically rescans when single-page apps replace the player
- Restores every original inline style when disabled

## Install locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open a streaming site, start playback, and click the extension.

After changing extension code, click the reload button on the extension card and refresh the streaming tab.

## Usage

- Move **Dark overlay reduction** toward **Remove**.
- Click **Rescan overlays** after opening a player if nothing was detected.
- Click **Pick UI to hide**, then click a control or panel on the page. Press `Esc` to cancel.
- Use **Reset hidden elements for this site** to restore manually hidden UI.

The extension intentionally avoids hiding interactive controls automatically. Site-specific UI should be hidden with the picker.

## Privacy

ClearView runs locally. It does not collect analytics, inspect video content, or send browsing data to a server. Settings are stored in Chrome's local extension storage.

## Limitations

- Chrome blocks extensions on internal pages such as `chrome://`.
- DRM-protected video pixels are not read or modified. ClearView fades separate overlay elements and full-size gradient layers, including CSS pseudo-elements. It does not fade a container that holds the video.
- Streaming sites frequently change their player markup. The picker is the fallback when an overlay cannot be safely identified.
