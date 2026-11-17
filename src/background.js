/* DOM Inspector — service worker: side-panel lifecycle and last-pick cache. */
const LAST_KEY = "di:lastPick";

const createMenus = () => {
  chrome.contextMenus.create({
    id: "di-pick",
    title: "Pick element with DOM Inspector",
    contexts: ["all"]
  }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({
    id: "di-copy-best",
    title: "Copy best selector (DOM Inspector)",
    contexts: ["all"]
  }, () => void chrome.runtime.lastError);
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Recreate menus so updates never leave duplicate ids behind.
  if (chrome.contextMenus.removeAll) chrome.contextMenus.removeAll(createMenus);
  else createMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === "di-pick") {
    if (tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    chrome.tabs.sendMessage(tab.id, { type: "DI_START" }).catch(() => {});
  }
  if (info.menuItemId === "di-copy-best") {
    chrome.tabs.sendMessage(tab.id, { type: "DI_COPY_BEST" }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (_) {
    /* Side panel API may be unavailable in some browsers. */
  }
});

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "start-pick") return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;
    if (tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    chrome.tabs.sendMessage(tab.id, { type: "DI_START" }).catch(() => {});
  });
}

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
