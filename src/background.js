console.log("Sample WebExtension background service worker loaded.");

browser.runtime.onInstalled.addListener(() => {
  console.log("Sample WebExtension installed and ready.");
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "ping") {
    console.log("Received ping from popup.");
    return { type: "pong", timestamp: Date.now() };
  }
  return undefined;
});
