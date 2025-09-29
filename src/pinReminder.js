const runtime =
  typeof browser !== "undefined" && browser?.runtime
    ? browser.runtime
    : chrome?.runtime;
const storage =
  typeof browser !== "undefined" && browser?.storage
    ? browser.storage
    : chrome?.storage;

const PIN_REMINDER_DISMISSED_KEY = "codexPinReminderDismissed";

function storageSet(key, value) {
  if (!storage?.local?.set) {
    return Promise.resolve();
  }
  const payload = { [key]: value };
  return new Promise((resolve) => {
    let settled = false;
    const finalize = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    try {
      const result = storage.local.set(payload, () => {
        if (runtime?.lastError) {
          console.error(
            "Failed to persist pin reminder preference",
            runtime.lastError
          );
        }
        finalize();
      });

      if (result && typeof result.then === "function") {
        result
          .catch((error) => {
            console.error(
              "Failed to persist pin reminder preference",
              error
            );
          })
          .finally(finalize);
        return;
      }

      if (storage?.local?.set?.length < 2) {
        finalize();
      }
    } catch (error) {
      console.error("Failed to persist pin reminder preference", error);
      finalize();
    }
  });
}

async function markDismissed() {
  await storageSet(PIN_REMINDER_DISMISSED_KEY, true);
}

function closeWindow() {
  window.close();
}

document.addEventListener("DOMContentLoaded", () => {
  const gotItButton = document.getElementById("got-it");
  const dismissButton = document.getElementById("dismiss");

  if (gotItButton) {
    gotItButton.addEventListener("click", () => {
      closeWindow();
    });
  }

  if (dismissButton) {
    dismissButton.addEventListener("click", async () => {
      await markDismissed();
      closeWindow();
    });
  }
});
