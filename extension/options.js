const browserApi = typeof browser !== "undefined" ? browser : chrome;

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("settings-form");
  const usernameInput = document.getElementById("username");
  const tokenInput = document.getElementById("token");
  const status = document.getElementById("status");
  const testButton = document.getElementById("test-button");

  const stored = await browserApi.storage.sync.get({ settings: { username: "", token: "" } });
  usernameInput.value = stored.settings.username || "";
  tokenInput.value = stored.settings.token || "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const token = tokenInput.value.trim();

    if (!username) {
      status.textContent = "Please enter your GitHub username.";
      status.className = "error";
      return;
    }

    await browserApi.storage.sync.set({ settings: { username, token } });
    status.textContent = "Settings saved.";
    status.className = "success";
    browserApi.runtime.sendMessage({ type: "refresh" });
  });

  testButton.addEventListener("click", () => {
    status.textContent = "Checking GitHub…";
    status.className = "";
    browserApi.runtime.sendMessage({ type: "refresh" });
  });
});
