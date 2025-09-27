const browserApi = typeof browser !== "undefined" ? browser : chrome;
const POLL_INTERVAL_MINUTES = 1;
const STORAGE_KEYS = {
  SETTINGS: "settings",
  SEEN_EVENTS: "seenEvents"
};

async function getSettings() {
  const data = await browserApi.storage.sync.get({ [STORAGE_KEYS.SETTINGS]: { token: "", username: "" } });
  return data[STORAGE_KEYS.SETTINGS];
}

async function saveSettings(settings) {
  await browserApi.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

async function getSeenEvents() {
  const data = await browserApi.storage.local.get({ [STORAGE_KEYS.SEEN_EVENTS]: [] });
  return data[STORAGE_KEYS.SEEN_EVENTS];
}

async function saveSeenEvents(eventIds) {
  await browserApi.storage.local.set({ [STORAGE_KEYS.SEEN_EVENTS]: eventIds.slice(0, 50) });
}

let chimeAudio;

async function playChime() {
  try {
    if (typeof Audio === "undefined") {
      console.warn("Audio playback not supported in this context");
      return;
    }

    if (!chimeAudio) {
      chimeAudio = new Audio(browserApi.runtime.getURL("go.mp3"));
      chimeAudio.load();
    }

    chimeAudio.currentTime = 0;
    await chimeAudio.play();
  } catch (error) {
    console.error("Unable to play chime", error);
  }
}

// Lightweight inline PNG so we do not rely on packaged binary assets.
const NOTIFICATION_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABuklEQVR42u3dy1HEQAwFQMXAlQNnYiEOIiIOItpgIIMtbOx5kt2HCcCvpar9eKR6eX3/cXKnhAAAgAPg6Xn7/N51ACwOfCJIXTnwCSB1x+A7QdSU4D++HpvOFIjqGPzWsI9GuRxAMvT/YIwH6Bh8N4hKhZ8OfivEKIBJwW+BaA8wOfgURAk/i1Bnhj81+L9CtAC4evhnI5Twswgl/CzCoQBXD/8ZwlKAO4d/NEIJP4tQws8iAJgCIPxzEHYDCP45wqEAqv+8LijVn+2CUv3ZLijVn+2CUv3ZLijVn+2CUv3ZLijVn+0CAAAACD+IAAAAAACdAHz+X/t9oFR/tgsAAAAAAAAAAAAAAAAAAAAAAAA6AUBY/GOcLvB/AAAAAO4NAMF7QQAANAOAsPjlXF0Qfj1dFzS4oKELwleUdEGDS3q6IHxNVRc0uKitC8KjCnRBg2EdEMwLAgAhPLIMQoOhfRAefeeGGtxqdPGo8A3vDodvfH04fAscdgbfboGDFSaW+IwL3hqrDcGPW2NlkZtVhu2Dt8zzTss8rbO10NlCZyvNGwOsAun4rC0BjgKZ8GwjAK58AAAAIIjg+QVV18EXEcLTKQAAAABJRU5ErkJggg==";

async function notifyReadyForReview(event) {
  const pr = event.payload.pull_request;
  const title = `PR ready for review: ${pr.title}`;
  const message = `${event.actor.login} marked #${pr.number} ready in ${event.repo.name}`;

  await browserApi.notifications.create(event.id, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON_DATA_URL,
    title,
    message
  });
  await playChime();
}

function buildAuthorizationHeader(token) {
  if (!token) {
    return null;
  }

  // Fine-grained tokens must use the "Bearer" scheme, while classic tokens
  // (ghp_, gho_, etc.) continue to work with the legacy "token" scheme. Use
  // simple prefix heuristics to do the right thing for both formats.
  if (/^gh[pousr]_/.test(token)) {
    return `token ${token}`;
  }

  return `Bearer ${token}`;
}

async function fetchReadyEvents(settings) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mozila-ready-for-review"
  };

  const authorization = buildAuthorizationHeader(settings.token);
  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(settings.username)}/received_events?per_page=50`, {
    headers
  });

  if (!response.ok) {
    throw new Error(`GitHub API responded with ${response.status}`);
  }

  return response.json();
}

async function processEvents() {
  const settings = await getSettings();
  if (!settings.username) {
    console.debug("GitHub username not configured; skipping poll.");
    return { skipped: true };
  }

  try {
    const events = await fetchReadyEvents(settings);
    const seen = await getSeenEvents();
    const newSeen = Array.from(seen);
    let notificationsSent = 0;

    for (const event of events) {
      if (event.type !== "PullRequestEvent" || event.payload.action !== "ready_for_review") {
        continue;
      }

      if (newSeen.includes(event.id)) {
        continue;
      }

      await notifyReadyForReview(event);
      newSeen.unshift(event.id);
      notificationsSent += 1;
    }

    if (newSeen.length !== seen.length) {
      await saveSeenEvents(newSeen);
    }

    return { skipped: false, notificationsSent };
  } catch (error) {
    console.error("Failed to process GitHub events", error);
    throw error;
  }
}

browserApi.runtime.onInstalled.addListener(async () => {
  await browserApi.alarms.clear("poll");
  browserApi.alarms.create("poll", { periodInMinutes: POLL_INTERVAL_MINUTES });
  const settings = await getSettings();
  if (!settings.username) {
    await saveSettings({ token: "", username: "" });
  }
  try {
    await processEvents();
  } catch (error) {
    console.error("Failed to process events after installation", error);
  }
});

browserApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll") {
    processEvents().catch((error) => {
      console.error("Failed to process events from alarm", error);
    });
  }
});

if (browserApi.commands && browserApi.commands.onCommand) {
  browserApi.commands.onCommand.addListener((command) => {
    if (command === "check-now") {
      processEvents()
        .then((result) => {
          if (!result || result.skipped) {
            console.debug("Shortcut check skipped because username is not configured.");
          } else {
            console.debug(
              `Shortcut check processed events; notifications sent: ${result.notificationsSent}`
            );
          }
        })
        .catch((error) => {
          console.error("Failed to process events from shortcut", error);
        });
    }
  });
}

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "refresh") {
    (async () => {
      try {
        const result = await processEvents();
        sendResponse({ success: true, result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendResponse({ success: false, error: errorMessage });
      }
    })();
    return true;
  }
  return false;
});
