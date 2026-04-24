const RELAY_URL = "http://127.0.0.1:19786/add";
const LINK_MENU_ID = "send-to-nas-link";
const SELECTION_MENU_ID = "send-to-nas-selection";
const URL_PATTERN = /(?:https?:\/\/[^\s<>"'\]]+|magnet:\?[^\s<>"'\]]+)/g;

function cleanExtractedUrl(url) {
  let cleaned = url.replace(/[.,;:!?]+$/, "");
  while (cleaned.endsWith(")") && (cleaned.split("(").length - 1) < (cleaned.split(")").length - 1)) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}
const BADGE_CLEAR_MS = 3000;

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

function showBadge(text, color) {
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
  setTimeout(() => browser.action.setBadgeText({ text: "" }), BADGE_CLEAR_MS);
}

async function sendUrl(url) {
  const response = await fetch(RELAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

browser.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === LINK_MENU_ID && info.linkUrl) {
      await sendUrl(info.linkUrl);
      showBadge("✓", "#22c55e");
    } else if (info.menuItemId === SELECTION_MENU_ID && info.selectionText) {
      const raw = info.selectionText.match(URL_PATTERN) || [];
      const urls = [...new Set(raw.map(cleanExtractedUrl))];
      if (urls.length === 0) {
        showBadge("0", "#eab308");
        return;
      }
      const results = await Promise.allSettled(urls.map(sendUrl));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === 0) {
        showBadge(`${urls.length}`, "#22c55e");
      } else {
        showBadge(`${failed}✗`, "#ef4444");
      }
    }
  } catch (error) {
    console.error("Send to NAS relay unreachable:", error.message);
    showBadge("✗", "#ef4444");
  }
});
