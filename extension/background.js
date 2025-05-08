chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkSetupStatus") {
    const isSetupComplete = localStorage.getItem('setupComplete') === 'true';
    sendResponse({ isSetupComplete });
  }
});