/* DOM Inspector — service worker: side-panel lifecycle and last-pick cache. */
const LAST_KEY = "di:lastPick";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.create({
    id: "di-pick",
    title: "Pick element with DOM Inspector",
    contexts: ["all"]
  }, () => void chrome.runtime.lastError);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "di-pick" && tab && tab.id != null) {
    if (tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    chrome.tabs.sendMessage(tab.id, { type: "DI_START" }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (_) {
    /* Side panel API may be unavailable in some browsers. */
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "DI_ELEMENT") {
    chrome.storage.session.set({ [LAST_KEY]: message.payload }).catch(() => {});
    return undefined;
  }
  if (message && message.type === "DI_GET_LAST") {
    chrome.storage.session.get(LAST_KEY)
      .then((data) => sendResponse({ ok: true, payload: data[LAST_KEY] || null }))
      .catch(() => sendResponse({ ok: false, payload: null }));
    return true;
  }
  return undefined;
});
