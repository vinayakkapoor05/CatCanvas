// Relay messages from content script → service worker → popup
chrome.runtime.onMessage.addListener((msg, sender) => {
    chrome.runtime.sendMessage(msg);
  });
  