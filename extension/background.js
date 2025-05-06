// Background script for Canvas Assistant
chrome.action.onClicked.addListener(async (tab) => {
    // Check if we're on a Canvas site
    if (tab.url.includes('instructure.com') || tab.url.includes('canvas.northwestern.edu')) {
      // Open side panel
      await chrome.sidePanel.open({ tabId: tab.id });
      // Set the side panel to our extension
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
      });
    } else {
      // notify the user they're not on Canvas, with a popup
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Canvas Assistant',
        message: 'Canvas Assistant only works on Canvas sites'
      });
      // chrome.action.setTitle({
      //   tabId: tab.id,
      //   title: "Canvas Assistant only works on Canvas sites"
      // });
    }
  });