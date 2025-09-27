# mozila

Firefox add-on that plays a notification chime when GitHub pull requests you follow become ready for review.

## Features

- Polls the GitHub Received Events API for `ready_for_review` pull request events.
- Shows a desktop notification and plays an audible chime for each newly ready pull request.
- Stores GitHub credentials using Firefox Sync so they stay in step across browsers.
- Provides an options page to configure your GitHub username and personal access token.

## Getting started

1. Generate a GitHub [personal access token](https://github.com/settings/tokens) with the `notifications` scope. Copy the token for later.
2. Open Firefox and browse to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and choose the `extension/manifest.json` file from this repository.
4. The add-on icon will appear in your toolbar. Open its preferences to enter your GitHub username and personal access token.
5. Click **Test now** to trigger an immediate poll. When someone marks a draft pull request ready for review, you will see a notification and hear the chime.

## Development notes

- The background script polls every minute using the GitHub REST API endpoint `users/:username/received_events`. Only `PullRequestEvent` entries with the `ready_for_review` action generate alerts.
- Seen event IDs are cached locally to avoid duplicate notifications.
- The chime is generated with the Web Audio API so no audio asset is required.

## Packaging

To build a distributable `.xpi`, run:

```bash
web-ext build --source-dir extension
```

Then upload the generated archive to [addons.mozilla.org](https://addons.mozilla.org/).
