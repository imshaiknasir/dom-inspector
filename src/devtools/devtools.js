/* Registers DOM Inspector in the Elements sidebar and as a standalone panel. */
chrome.devtools.panels.elements.createSidebarPane("DOM Inspector", (pane) => {
  pane.setPage("../panel/panel.html");
  if (typeof pane.setHeight === "function") pane.setHeight("420px");
});

chrome.devtools.panels.create("DOM Inspector", "icons/icon-48.png", "../panel/panel.html", () => {});
