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

async function notifyReadyForReview(event) {
  const pr = event.payload.pull_request;
  const title = `PR ready for review: ${pr.title}`;
  const message = `${event.actor.login} marked #${pr.number} ready in ${event.repo.name}`;

  await browserApi.notifications.create(event.id, {
    type: "basic",
    iconUrl: browserApi.runtime.getURL("icons/icon96.png"),
    title,
    message
  });
  await playChime();
}

async function fetchReadyEvents(settings) {
  const headers = {
    Accept: "application/vnd.github+json"
  };

  if (settings.token) {
    headers.Authorization = `token ${settings.token}`;
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
    return;
  }

  try {
    const events = await fetchReadyEvents(settings);
    const seen = await getSeenEvents();
    const newSeen = Array.from(seen);

    for (const event of events) {
      if (event.type !== "PullRequestEvent" || event.payload.action !== "ready_for_review") {
        continue;
      }

      if (newSeen.includes(event.id)) {
        continue;
      }

      await notifyReadyForReview(event);
      newSeen.unshift(event.id);
    }

    if (newSeen.length !== seen.length) {
      await saveSeenEvents(newSeen);
    }
  } catch (error) {
    console.error("Failed to process GitHub events", error);
  }
}

browserApi.runtime.onInstalled.addListener(async () => {
  await browserApi.alarms.clear("poll");
  browserApi.alarms.create("poll", { periodInMinutes: POLL_INTERVAL_MINUTES });
  const settings = await getSettings();
  if (!settings.username) {
    await saveSettings({ token: "", username: "" });
  }
  processEvents();
});

browserApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll") {
    processEvents();
  }
});

browserApi.runtime.onMessage.addListener((message) => {
  if (message && message.type === "refresh") {
    processEvents();
  }
});
