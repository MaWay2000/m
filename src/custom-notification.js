(() => {
  /**
   * Parse query parameters from the current window's URL. The background
   * script encodes the notification details in the query string when
   * opening this page. Each parameter is URL‑encoded and may be absent.
   */
  function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      title: params.get("title") || "",
      message: params.get("message") || "",
      audio: params.get("audio") || "",
      clickUrl: params.get("clickUrl") || "",
      bgColor: params.get("bg") || "",
      textColor: params.get("text") || "",
      edit: params.get("edit") === "1" || params.get("edit") === "true",
    };
  }

  const { title, message, audio, clickUrl, bgColor, textColor, edit } = getQueryParams();

  // Populate the notification title and message elements. Using innerText
  // avoids interpreting any potential HTML in the message string.
  const titleEl = document.getElementById("notification-title");
  const messageEl = document.getElementById("notification-message");
  if (titleEl) titleEl.innerText = title;
  if (messageEl) messageEl.innerText = message;

  // Apply custom colours if provided. The caller can pass `bg` and `text` query
  // parameters containing CSS colour values (e.g. "#ffffff"). These values
  // override the default appearance of the notification container.
  const rootEl = document.getElementById("notification-root");
  if (rootEl) {
    if (bgColor) {
      rootEl.style.backgroundColor = bgColor;
    }
    if (textColor) {
      rootEl.style.color = textColor;
    }
  }

  // For edit mode, disable automatic closing and do not play audio. The user
  // will move and resize the window manually and close it themselves to
  // persist the new bounds. When not editing, play the configured audio and
  // automatically close the notification when the sound ends or after a
  // fallback timeout.
  const audioEl = document.getElementById("notification-audio");
  if (!edit) {
    if (audio && audioEl) {
      audioEl.src = audio;
      // If playback fails (e.g., file missing), close after a delay anyway.
      let closed = false;
      const closeAfterFallback = () => {
        if (!closed) {
          closed = true;
          window.close();
        }
      };
      audioEl.addEventListener("ended", () => {
        closed = true;
        window.close();
      });
      audioEl.addEventListener("error", closeAfterFallback);
      // Fallback: close if audio does not finish within 20 seconds.
      setTimeout(closeAfterFallback, 20000);
      // Attempt to play the audio. Some browsers may require user
      // interaction; catch any promise rejection silently.
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          // If autoplay fails, still close after a delay.
          setTimeout(closeAfterFallback, 5000);
        });
      }
    } else {
      // No sound configured: close automatically after 5 seconds.
      setTimeout(() => {
        window.close();
      }, 5000);
    }
  }

  // Handle clicks on the notification when not in edit mode. If a click URL
  // is provided and the extension has tab permissions, open the URL in a new
  // tab and close the window. When editing, clicks should not close the
  // window or launch any URL so the user can reposition it without
  // interference.
  const root = document.getElementById("notification-root");
  if (root) {
    root.addEventListener("click", () => {
      if (!edit) {
        if (clickUrl) {
          try {
            const apiTabs =
              (typeof browser !== "undefined" && browser?.tabs) ||
              (typeof chrome !== "undefined" && chrome?.tabs);
            if (apiTabs && apiTabs.create) {
              apiTabs.create({ url: clickUrl });
            }
          } catch (err) {
            // Ignore errors opening new tabs; still close the window.
          }
        }
        window.close();
      }
    });
  }
})();