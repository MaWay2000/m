# Fix list

1. **Done — detect an open task detail page.** Track the current
   `/codex/tasks/<id>` route even when the page does not render a link to itself.
2. **Done — make status detection resilient.** Recognize both active-task
   controls and completion text while continuing to prefer explicit status
   attributes supplied by the page.
3. **Done — add regression coverage.** Exercise a task conversation page with
   no task-list links and verify that it is sent to extension history.
4. **Manual verification remaining.** Reload the temporary
   add-on, refresh an existing Codex task tab, and confirm it appears in the
   popup without requiring a working-indicator square.
