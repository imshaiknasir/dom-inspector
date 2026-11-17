/* Registers DOM Inspector as an Elements sidebar pane. */
chrome.devtools.panels.elements.createSidebarPane("DOM Inspector", (pane) => {
  pane.setPage("../panel/panel.html");
});
