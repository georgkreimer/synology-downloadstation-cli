const RELAY_URL = "http://127.0.0.1:19786/add";
const MENU_ID = "send-to-nas";

function createContextMenu() {
  browser.contextMenus.create({
    id: MENU_ID,
    title: "Send to NAS",
    contexts: ["link"],
  });
}

browser.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

// Safari doesn't always fire onInstalled, so also register at top level
createContextMenu();

function showBadge(text, color, durationMs) {
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
  setTimeout(() => {
    browser.action.setBadgeText({ text: "" });
  }, durationMs);
}

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;

  try {
    const response = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: info.linkUrl }),
    });

    const data = await response.json();

    if (response.ok && data.ok) {
      showBadge("✓", "#a6e3a1", 2000);
    } else {
      console.error("Send to NAS failed:", data.error || response.statusText);
      showBadge("✗", "#f38ba8", 3000);
    }
  } catch (error) {
    console.error("Send to NAS relay unreachable:", error.message);
    showBadge("✗", "#f38ba8", 3000);
  }
});
