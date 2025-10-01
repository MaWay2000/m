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
      pageColor: params.get("page") || "",
      textColor: params.get("text") || "",
      edit: params.get("edit") === "1" || params.get("edit") === "true",
      sessionId: params.get("session") || "",
    };
  }

  const {
    title,
    message,
    audio,
    clickUrl,
    bgColor,
    pageColor,
    textColor,
    edit,
    sessionId,
  } =
    getQueryParams();

  // Populate the notification title and message elements. Using innerText
  // avoids interpreting any potential HTML in the message string.
  const titleEl = document.getElementById("notification-title");
  const messageEl = document.getElementById("notification-message");
  if (titleEl) titleEl.innerText = title;
  if (messageEl) messageEl.innerText = message;

  // Apply custom colours if provided. The caller can pass `bg`, `page`, and
  // `text` query parameters containing CSS colour values (e.g. "#ffffff"). These
  // values override the default appearance of the notification container and
  // surrounding page.
  if (pageColor) {
    document.documentElement.style.backgroundColor = pageColor;
    document.body.style.backgroundColor = pageColor;
  }
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

  // Handle clicks on the notification. In edit mode, clicking captures the
  // current bounds and notifies the options page before closing so the new
  // position persists. Outside edit mode the click behaves as before: open
  // the target URL (if any) and close the window.
  const root = document.getElementById("notification-root");
  const runtimeApi =
    (typeof browser !== "undefined" && browser?.runtime)
      ? browser.runtime
      : typeof chrome !== "undefined" && chrome?.runtime
        ? chrome.runtime
        : null;

  if (root) {
    root.addEventListener("click", async () => {
      if (edit) {
        const position = {};
        const size = {};
        const left = Number.isFinite(window.screenX)
          ? window.screenX
          : Number.isFinite(window.screenLeft)
            ? window.screenLeft
            : null;
        const top = Number.isFinite(window.screenY)
          ? window.screenY
          : Number.isFinite(window.screenTop)
            ? window.screenTop
            : null;
        const width = Number.isFinite(window.outerWidth)
          ? window.outerWidth
          : Number.isFinite(window.innerWidth)
            ? window.innerWidth
            : null;
        const height = Number.isFinite(window.outerHeight)
          ? window.outerHeight
          : Number.isFinite(window.innerHeight)
            ? window.innerHeight
            : null;
        if (typeof left === "number") {
          position.left = Math.round(left);
        }
        if (typeof top === "number") {
          position.top = Math.round(top);
        }
        if (typeof width === "number") {
          size.width = Math.round(width);
        }
        if (typeof height === "number") {
          size.height = Math.round(height);
        }
        if (sessionId && runtimeApi?.sendMessage) {
          try {
            const response = runtimeApi.sendMessage({
              type: "codexPopupPreviewBounds",
              sessionId,
              position,
              size,
            });
            if (response && typeof response.then === "function") {
              await response.catch(() => {});
            }
          } catch (err) {
            // Ignore errors reporting bounds; closing still triggers the usual save path.
          }
        }
        try {
          window.close();
        } catch (err) {
          // Ignore close errors; the window may already be closing.
        }
        return;
      }

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
    });
  }
})();
