const RELAY_URL = "http://127.0.0.1:19786/add";
const LINK_MENU_ID = "send-to-nas-link";
const SELECTION_MENU_ID = "send-to-nas-selection";
const URL_PATTERN = /(?:https?:\/\/[^\s<>"')\]]+|magnet:\?[^\s<>"')\]]+)/g;

function createContextMenus() {
  browser.contextMenus.removeAll(() => {
    browser.contextMenus.create({
      id: LINK_MENU_ID,
      title: "Send link to NAS",
      contexts: ["link"],
    });
    browser.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: "Send selected links to NAS",
      contexts: ["selection"],
    });
  });
}

browser.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

createContextMenus();

async function sendUrl(url) {
  const response = await fetch(RELAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    console.error("Send to NAS failed:", url, data.error || response.statusText);
  }
  return data;
}

browser.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === LINK_MENU_ID && info.linkUrl) {
      await sendUrl(info.linkUrl);
    } else if (info.menuItemId === SELECTION_MENU_ID && info.selectionText) {
      const raw = info.selectionText.match(URL_PATTERN) || [];
      const urls = [...new Set(raw.map((u) => u.replace(/[.,;:!?]+$/, "")))];
      if (urls.length === 0) {
        console.warn("Send to NAS: no URLs found in selection");
        return;
      }
      console.log(`Send to NAS: sending ${urls.length} URL(s)`);
      await Promise.allSettled(urls.map(sendUrl));
    }
  } catch (error) {
    console.error("Send to NAS relay unreachable:", error.message);
  }
});
