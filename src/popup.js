const responseOutput = document.getElementById("response");
const pingButton = document.getElementById("ping");

async function sendPing() {
  responseOutput.textContent = "Sending message...";
  try {
    const response = await browser.runtime.sendMessage({ type: "ping" });
    if (response?.type === "pong") {
      const formatted = new Date(response.timestamp).toLocaleTimeString();
      responseOutput.textContent = `Received pong at ${formatted}`;
    } else {
      responseOutput.textContent = "Unexpected response from background.";
    }
  } catch (error) {
    console.error("Failed to send ping", error);
    responseOutput.textContent = "Failed to reach background script.";
  }
}

pingButton.addEventListener("click", sendPing);
