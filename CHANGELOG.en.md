# Changelog

Written for users, not a rehash of the git log. Only changes you can actually feel are listed.
This format is parsed by `scripts/changelog.mjs` into the website changelog page and the in-app update notice,
so do not change the heading line: `## <version> — <YYYY-MM-DD>`, with `### New / Improved / Fixed` groups below it.

## 0.4.121 — 2026-10-02

### Read Before Upgrading
- This version requires macOS 12+. macOS 11 users should keep using 0.4.113, which remains available on the download page. The app never installs updates automatically.

### New
- The plugin market now supports remote plugins that connect with an access token. The token is stored with system encryption, is never shown again after you save it, and can be tested with one click. When you turn a plugin off, chats already connected to it are disconnected immediately.

### Improved
- Using a plugin is more direct: click it under Plugins in the sidebar, right-click a Frame and choose Plugins, or click "Start chat" after setting it up, and you get a new AI chat that is already connected to that plugin. The chat header shows it as connected.
- @-mentioning a plugin in the input box doesn't connect it; the app now tells you where to open a chat that is connected to it.

### Fixed
- With a proxy such as Clash or Surge in fake-ip mode, remote plugins no longer fail to connect because their address was mistaken for a private network; through a proxy they connect by domain name.

### Compatibility and Limitations
- Windows remains 10+ x64. The installer is not code-signed and may trigger SmartScreen. Intel was verified under Rosetta, not on physical Intel hardware.

## 0.4.120 — 2026-10-01

### Read Before Upgrading
- This version requires macOS 12+. macOS 11 users should keep using 0.4.113, which remains available on the download page. The app never installs updates automatically.
- English UI is here. If you already use the app, it stays in Chinese after upgrading; new installs follow the system language. You can switch in Settings.

### New
- English UI: the main window, canvas, panels, Settings, the Island, terminal, code map, timeline and knowledge base are all available in English. When the UI is in English, the AI replies in English too.
- The skill panel has a new "Let AI discover skills" switch. When it's off, the AI can't see those skills' names and descriptions and only uses one when you mention it with / in the input box. This saves context and avoids skills firing on unrelated tasks. Turn it off for everything, or right-click a single skill. Mentioning a skill with / runs it directly.
- Publish Desk plugin: keep drafts per platform, copy in one click, and open the publishing page on the canvas. It checks banned words locally (matches are only flagged, with the law or platform rule quoted) and reads your media to compare against each platform's specs, listing the assets and cover you still need.
- Settings now has "About & Open Source", listing the open-source software we use and its licenses.
- The plugin market has a new "Productivity" category.

### Improved
- When an AI task moves to the background, you hear a distinct sound and see a "Running in background" label instead of "Done". The notice stays until the AI continues its reply. The Island shows the AI's result directly, without flashing a placeholder first.
- Plugin drawer: brand plugins show their official logos and our own plugins share a unified icon style. System plugins no longer appear in My Plugins or the market and are now under Built-in Capabilities in Settings. Plugins are grouped by source.
- The gallery plugin is now a feed: a full-width responsive grid with infinite scroll, loading visible images first and prefetching the next page.
- The app no longer touches the system keychain at startup or when checking vault status, so you won't get an authorization prompt as soon as you open it.
- Update downloads now start immediately instead of waiting behind other tasks.

### Fixed
- Plugin panels on the canvas: your first click reaches the panel; the mouse wheel still pans the canvas while the panel isn't selected; drags are no longer swallowed by web or plugin panels; middle-button panning works again; and resizing no longer stops when you drag across a panel.
- When the AI continues on its own after a background task finishes, the execution checklist no longer reports "missing a valid project or turn".
- Starting a new chat while a background task is still wrapping up no longer lets the old chat's notices leak into the new one.
- Vault: after unlocking from any entry point, features waiting on the vault continue right away; the app checks the real vault state before asking you to unlock, so it no longer prompts by mistake; the "Trust this device" checkbox stays inside the popover's padding.

### Compatibility and Limitations
- Windows remains 10+ x64. The installer is not code-signed and may trigger SmartScreen. Intel was verified under Rosetta, not on physical Intel hardware.
- The "Let AI discover skills" switch only affects AI chats started in Eas-Term after you change it; CLIs you launch yourself in the terminal are not affected, and omp is not supported yet.

## 0.4.119 — 2026-09-29

### Read Before Upgrading
- This version requires macOS 12+. macOS 11 users should keep using 0.4.113, which remains available on the download page. The app never installs updates automatically.

### Improved
- You are now notified that "results are ready" as soon as the AI finishes its turn, even if it still has tasks running in the background. You will no longer miss the alert while the AI is already asking you a question. Background tasks still show "Background task running", and the Island still shows the running state.

### Compatibility and Limitations
- Windows remains 10+ x64. The installer is not code-signed and may trigger SmartScreen. Intel was verified under Rosetta, not on physical Intel hardware.

## 0.4.118 — 2026-09-29

### Read Before Upgrading
- This version requires macOS 12+. macOS 11 users should keep using 0.4.113, which remains available on the download page. The app never installs updates automatically.

### Fixed
- When the AI starts a long-running command in the background, such as a dev server (for example `cd project && npm run dev`), the chat no longer shows "Running" indefinitely while waiting for a completion notice. Background commands that start with cd are no longer counted as the chat still being in progress.
- When a web, file, or plugin panel module is maximized, its title bar, top-right buttons, address bar, and page content are now always shown at 100%, regardless of the canvas zoom level, instead of scaling with the canvas.

### Compatibility and Limitations
- Windows remains 10+ x64. The installer is not code-signed and may trigger SmartScreen. Intel was verified under Rosetta, not on physical Intel hardware.
- If you maximize a web page while the canvas is zoomed above 100%, the page sees a lower pixel density, and a few sites that pick images by pixel density may load low-resolution images. The display itself stays sharp.

## 0.4.117 — 2026-09-28

### Read Before Upgrading
- This version requires macOS 12+. macOS 11 users should keep using 0.4.113, which remains available on the download page. The app never installs updates automatically.

### New
- Eas-Term now has its own mascot, "Pixel Dumpling". It replaces the Island status, the "Processing…" and "Background task running" indicators in AI chat, the task monitor at the top left of the canvas, the empty-canvas hint, and the AI chat home page. While running, its left ear blinks like a cursor. It stops when the window is in the background or hidden, so it uses no extra power.

### Improved
- The "↑ History · ↓ Back" key hint below the input box is now fainter, so it no longer competes with the input placeholder for attention.

### Fixed
- When you resume a Claude chat that has unfinished background tasks, the first message no longer shows "done" without an answer and needs to be sent again before you get a reply.
- Task list cards no longer overlap the task monitor and quota bar at the top left of the canvas.

### Compatibility and Limitations
- Windows remains 10+ x64. The installer is not code-signed and may trigger SmartScreen. Intel was verified under Rosetta, not on physical Intel hardware.
- UI acceptance for this round used isolated instances and replays recorded from the real protocol. No end-to-end run against a live model was done. The leftover external Computer Use pointer issue is still unresolved.

## 0.4.116 — 2026-09-28

### Read Before Upgrading
- This version requires macOS 12+. macOS 11 users should keep using 0.4.113, which remains available on the download page. The app never installs updates automatically.

### New
- When the browser is maximized, "− / percentage / ＋" controls on the right of the address bar let you adjust the page zoom. Click the percentage to reset to 100%. Only the web page is scaled, not the canvas.
- Claude Code launched in a terminal can now submit report pages to the canvas by default (only this one built-in tool is allowed, and your global Claude settings are not modified).

### Improved
- A cleaner input box: model, effort, and refresh are tucked into a secondary popover, and @, /, and preview are grouped together. The effort slider can be dragged continuously, and expanding and collapsing are animated.
- Anonymous usage statistics now separate "open" from "in use": a session counts as in use only when the Eas-Term window is in the foreground and there has been keyboard or mouse activity in the last 60 seconds. It still contains no identifiers and can be turned off in Settings. The privacy notice has been updated to match.

### Fixed
- When Claude runs a command in the background (such as a long test), AI chat no longer wrongly shows "Done". The chat area shows "Background task running" and the command being executed, the Island and project status stay in the running state, and the completion notice appears only after the background task ends and the AI has finished replying. Background tasks are not reclaimed as idle while running.
- Images returned by the AI are saved locally as originals and remain viewable after reopening the chat, and only thumbnails of the visible area are loaded. If an original is missing, a local recovery option is offered, and the model is not called to regenerate it.
- "Redirect" now waits until the current task has actually stopped before sending the new message, so "The current message is waiting or running" and stuck queues no longer occur.

### Compatibility and Limitations
- Windows remains 10+ x64. The installer is not code-signed and may trigger SmartScreen. Intel was verified under Rosetta, not on physical Intel hardware.
- UI acceptance for this round used isolated instances and replays recorded from the real protocol. No end-to-end run against a live model was done. The system file picker for "Restore original file" was not tested. The leftover external Computer Use pointer issue is still unresolved.

## 0.4.115 — 2026-09-28

### Read Before Upgrading
- This version requires macOS 12+. macOS 11 users should keep using 0.4.113, which remains available on the download page. Older clients cannot detect system compatibility, and the app never installs updates automatically.

### New
- The Usage drawer adds a 90-day heatmap with a Token / App activity toggle (Token by default). It also adds local Eas-Term behavior and plugin usage statistics. Your personal behavior is not uploaded, and past records are not fabricated.
- The input box shows optional suggestions for the reply in progress. Tab only fills them in and does not send. In an empty input box, the up and down arrow keys fill in text from the current session history, without any extra model call.

### Improved
- Double-clicking the project menu pins running projects to the top. New AI chats now default to a taller size, and existing modules keep their size.
- The host supports the new Jev judgment protocol and protected connection recovery, while keeping explicit verification and timeline enhancement working for the older Jev on the marketplace. Jev 0.2.0 is a separate plugin that must be published and updated through the marketplace separately, so upgrading the main app does not replace it automatically.

### Fixed
- For Codex-specific routing failures, when there is confirmed to be no output, no billing activity, and a clear request outcome, up to five connection recovery attempts are made. Messages whose outcome is unknown are not blindly resent.
- Leftover retry notices are cleared promptly once text output or tool execution resumes.

### Compatibility and Limitations
- Windows remains 10+ x64. The installer is not code-signed and may trigger SmartScreen. Intel was verified under Rosetta, not on physical Intel hardware.
- Live models, the TypeSafe service, real long-running memory behavior, and Windows on-site use have not yet been accepted in this round. The leftover external Computer Use pointer issue is still unresolved.

## 0.4.114 — 2026-09-27

### Read Before Upgrading
- Only macOS 12+ can use this version. macOS 11 users should not install 0.4.114 and should keep using 0.4.113 from the download page. Older clients may still offer the new version, because they cannot detect system compatibility. The app never installs updates automatically.

### Improved
- CLI requests now go out first-come, first-served with staggered release, and a whole task is no longer limited to two running at once by default. When the network fluctuates, the send interval is lengthened adaptively and gradually shortened after recovery. Business requests are never resent automatically.
- After the background has had no active tasks for an hour, and when it is safe to do so, the main window's rendering resources are restored while registered sessions, drafts, and layout are kept. When there are risks such as unsaved edits, plugins, or dialogs, only a light cleanup is done and no restart is forced.
- AI chat has a roomier default size that fits the window. Scroll positioning on refresh and when new messages arrive is more sensible, and AI options are placed after the reply text.
- Before a session is awakened, the first message also supports pasting images.
- An empty skills folder now shows a neutral-toned hint. Next to the Jev key input, you can open the in-app browser directly to obtain a key, and unsaved content is preserved when you return.

### Fixed
- Fixed blank report pages, debug page size sync, and sharpness and edge-fit issues when maximized in the app. Preview screenshots now have a pixel budget and are encoded asynchronously, reducing main-thread load during long runs.
- Fixed the task checklist detaching from the chat box when panning, zooming, or moving chat modules on the canvas.
- Upgraded Electron and build dependencies, clearing the security warnings found by this round's npm dependency audit.

### Compatibility and Limitations
- The minimum macOS requirement for this version is raised to 12. macOS 11 users should keep using 0.4.113, and the download page keeps the entry for the old version. Windows remains 10+ x64.
- Idle recovery is not the same as restarting the whole app, and no fixed memory reduction is guaranteed. A real one-hour idle run, multi-monitor field testing, and end-to-end runs against live models have not yet been accepted in this round.
- The leftover external Computer Use pointer issue is still unresolved. The Windows installer is not code-signed, and SmartScreen prompts may appear.

## 0.4.113 — 2026-09-27

### New
- Claude Code, Codex, and the native engine in AI chat now share concurrency scheduling. By default 2 tasks run at the same time, with staggered starts, and you can adjust the concurrency limit in the runtime settings.
- You can opt in to process-tree memory diagnostics to help observe resource usage by the app and AI child processes.

### Improved
- Messages waiting for resources no longer leave the queue after the default 60 seconds. They run in order once resources recover, and you can also cancel them manually.
- Memory warning and critical levels are now distinguished, so ordinary pressure is no longer treated as severe pressure that blocks the first message from starting.
- User questions that have not started yet are preserved. If a start fails, a manual resend is offered, and nothing is quietly resent automatically.
- AI task plans are now checked off and archived automatically once the model completes them, so you no longer need to accept items one by one. The canvas task ring shows progress on hover.
- New projects now appear above the recent projects list.

### Fixed
- Fixed Claude errors that might not release a concurrency slot, leaving later messages waiting forever.
- Fixed resources not being rechecked at release time after memory pressure changed while a message was queued.
- Fixed image zoom reset clicks not working, the first click on a plugin panel not activating it, and interrupted tasks being wrongly reported as completed.

### Known Limitations
- Real 16GB devices, end-to-end runs against live models, and physical Windows/Intel user machines still need ongoing acceptance. This version does not promise a fixed percentage reduction in memory.
- The leftover external Computer Use pointer issue is still open. Existing Electron and build dependency security warnings have not been cleared in this version.

## 0.4.111 — 2026-09-26

### Improved
- Bold text in Markdown files, the Wiki, and AI answers now uses a soft gray-teal in both light and dark themes, making key points easier to spot and avoiding harsh pure-black or pure-white contrast.

### Known Limitations
- The leftover external Computer Use pointer issue is still open, and this version does not claim to fix it.

## 0.4.110 — 2026-09-25

### New
- While developing a page, you can observe the local page inside the app. After the AI explicitly submits an HTML report page, you can view it in a top-and-bottom split with the debug page and maximize each one separately for an immersive view.
- The top of AI chat can show the current execution plan. The execution plan plugin is responsible for saving progress, confirming stops, and session ownership.

### Improved
- Git history now loads earlier commits in batches when you scroll to the bottom, avoiding reading a large number of records at once.
- While panning the board, repeated measuring of the question navigation is reduced, and Frame animations hidden behind a maximized view are paused.
- When you switch AI sessions, observation of non-current pages is paused and resumes automatically when you return. Preview stops when the report file is no longer valid.

### Fixed
- Fixed the parsing of drive letters, network shares, and special characters in Windows project paths and local HTML report page URLs.

### Known Limitations
- The leftover external Computer Use pointer issue is still open, and this version does not claim to fix it.
- The page observation window accepts only local development addresses. Report pages must be explicitly submitted by the AI and cannot be guessed automatically from reply text.

## 0.4.109 — 2026-09-25

### Improved
- The Frame right-click menu now has "Components" as its own submenu, the submenu arrows are clearer, and the delete entry no longer uses an abrupt red.
- Timeline milestones now keep the user question that triggered them, and running plugins are confirmed and stopped before a plugin update.
- The Island preview is bound to the current module session and round, reducing preview mix-ups.

### Known Limitations
- The leftover external Computer Use pointer issue is still open, and this version does not claim to fix it.

## 0.4.108 — 2026-09-24

### New
- Plugin marketplace cards let you view features, scenarios, and usage instructions. The right drawer can open plugins that have a panel directly, and guides you to configuration when a required key is missing.
- Added a read-only, offline local Codex usage audit script. Reports are saved only on your machine and are not a provider bill.

### Improved
- Jev shows waiting feedback while verifying the connection. When the vault is locked, it guides you to unlock it in place, and a failed save no longer loses the key you entered.
- You can choose to trust this machine in the vault, so later unlocks no longer require the six-digit code. Locking manually revokes that trust. Keys are still encrypted by system secure storage.
- Codex replies are now presented progressively. Recoverable connection errors get a capped number of retries with progress hints.
- The spacing between AI chat and tool calls adapts to Frame width, and blueprint diagrams and preview switching are clearer.

### Fixed
- Fixed Codex cached input being counted twice in usage, and shortened the duplicated capability guide path.

### Known Limitations
- Jev's online TypeSafe account verification, physical Windows machines, and the Linux system keychain backend have not yet been accepted one by one. Plugin keys are stored in the plugin's own encrypted credential store and do not appear in the general key list.
- The leftover external Computer Use pointer issue is still open, and this version does not claim to fix it.

## 0.4.107 — 2026-09-23

### Fixed
- When a Codex long-running task hits a brief status-query timeout or loses the startup confirmation reply, the original task is kept running whenever possible, without duplicate submission or billing.
- A failed connection to an optional MCP tool no longer wrongly interrupts the main chat, and login failures and process or protocol problems now get clearer messages.
- After the native output channel is interrupted, it no longer shows running forever. Error logs record only anonymized categories.

### Known Limitations
- When the native process has actually exited or the task state cannot be confirmed, it still stops safely and does not redo the task automatically. Real online network drops and Windows still need continued observation.
- The leftover external Computer Use pointer issue is still unresolved.

## 0.4.106 — 2026-09-23

### New
- Right-click a project card to quickly move it to a specific board section, with support for custom sections and Uncategorized.
- Creative reference blueprints support clicking an SVG to locate the matching entry, with color-coded blocks and linked highlighting.
- Added an optional Jev plugin: connection setup, a dashboard, and on-demand tools. You need to set up the related services yourself.

### Improved
- Plugin startup and calls no longer enter the global waiting queue, while budget, cancellation, and safety controls are kept.
- The AI setup guide gives clearer progress, failure feedback, and a login entry, and supports re-entering.
- Design selection supports directly referencing prompts, full source code, and partial references, and category and light/dark filters stay visible.
- Creative References removes the secondary filter, and full entry rows adjust letter spacing so the left and right edges line up, with the last row keeping its natural width. The auto-record hint is now a short entry, with the explanation expanding on demand.
- The split-view empty state and the canvas now share the same AI and terminal launch entries.

### Known Limitations
- Besides the daily budget, Jev has a separate cumulative limit of 100 calls per process. After it is reached, the plugin must be restarted, and waiting until the next day or reconnecting does not reset it.
- The leftover external Computer Use pointer issue is still unresolved. This version does not include the timeline stage records that have not yet been merged.

## 0.4.105 — 2026-09-22

### Fixed
- Plugin marketplace cards now have a uniform height, with titles, descriptions, and status aligned, and installed and migration notices no longer stretch the cards.
- The full description, migration, and source notes can be expanded, and hovering over the settings area keeps the original layout.

### Known Boundaries
- The leftover Computer Use external service pointer issue is still unresolved, and this version does not claim to fix it.

## 0.4.104 — 2026-09-22

### Plugin Marketplace
- Added entries for checking updates and updating a single plugin, showing installed and available versions, so upgrades do not have to wait for a main app release.
- You can add external Eas-format plugin directories, browse and install from them, and update from the original source. Source and permissions are shown before installing, and arbitrary platform-specific plugins cannot be mixed in directly.
- The timeline is migrated offline to a standalone plugin on first launch, keeping project history and authorization settings. It does not overwrite a user-installed version, and is not reinstalled automatically after uninstalling.
- The official marketplace now includes the published Word, Excel, PowerPoint, and local file plugins. Supported scope and authorization requirements are as described in each plugin's documentation.
- Improved the plugin settings entry and connection status feedback. Capabilities without a configured account or authorization will not pretend to be available.

### Known Boundaries
- External sources require public HTTPS and a compatible Eas directory/plugin format. Private-network addresses, abnormal DNS, and cross-source overwrites of the same name are still rejected.
- The leftover pointer issue with the Computer Use external service is still unresolved, and this version does not claim to fix it.


## 0.4.103 — 2026-09-22

### New
- The global timeline aggregates results from multiple projects and supports filtering by project and time.
- Usage and the timeline can generate printable receipts. The Usage page can expand project details directly.

### Improved
- Improved multi-module canvas dragging, reducing unnecessary content updates while panning.

### Fixed
- Fixed the busy state and continuation handling when a Codex native goal continues across turns, while preserving the behavior of ordinary Q&A and manual stops.

## 0.4.102 — 2026-09-18

### New
- Built-in timeline plugin: records results by project, with a monthly overview, a date wheel, and details. Updates to the same task are not counted twice.
- Claude, Codex, and OMP chats can show inline images returned by the CLI, which can be clicked to enlarge and are saved with history. Images that were not sent out are not supported.

### Improved
- The Frame double-click insert menu adds a 3D category that recognizes GLB/GLTF/OBJ/FBX/STL. Canvas preview still supports GLB, and the other formats are only categorized.
- The plugin entry has moved to the Frame right-click menu. Double-click remembers your last "Folder / Recent" choice.
- In light mode, the project title bar now uses a silver-gray gradient with a soft highlight instead of pure black.

## 0.4.101 — 2026-09-16

### New
- Canvas preview now covers more media: **audio** (mp3/wav/m4a/flac/ogg and more) can play directly on the canvas, and **3D models (.glb)** can now be previewed too. The first time you view one, click once to download the viewer (about 1MB, only once, then available offline), and you can drag to rotate the view and let it auto-rotate.
- **Images can now be zoomed in for detail**: double-click to zoom in, double-click again to reset, and drag to pan after zooming. There are zoom buttons and a percentage at the bottom, and when a node fills the screen the scroll wheel also zooms directly.

### Improved
- The dialog where the AI asks for a key now tells you **"which project, which node, and which key the request is for"**. This is especially useful for the dialog that only unlocks the vault, which used to be just a six-digit code box. Now you can see at a glance who is asking and for what.

## 0.4.100 — 2026-09-16

### Improved
- When the machine is busy, generating images from the canvas no longer makes you wait around. The image-generation connector (Bizone Canvas) now starts "immediately, without queuing", like the terminal and plugins. Under heavy load it used to take more than ten seconds to connect.
- Voice dictation feels snappier when the machine is busy. The final text for a sentence you have just finished no longer gets stuck in the resource queue (which showed up as the words you just said disappearing first and landing a moment later). Live dictation now never queues. Batch jobs such as file and video transcription still queue as before, so they do not compete with the foreground for resources.

## 0.4.99 — 2026-09-15

### New
- Plugin Market: the "More" drawer now has a "Plugins" page. You can browse plugins and install them in one click (the permissions a plugin needs are shown first, and it is installed only after you confirm), and use a switch to control which plugins are active. **Only enabled plugins appear in the double-click insert panel and in the @ menu of the input box** (turning one off does not uninstall it, and you can turn it back on any time). This switch also governs plugins you installed in Claude / Codex.
- Click "View full Plugin Market" to enter the category store: browse by Office Documents / Life & Travel / Developer Tools / Communication / Content Creation / Design & Creative / Data & Search / Files & Storage, with search, and cards carry brand icons. The first plugin listed is the "Pomodoro" focus timer plugin (the AI can start it for you, and when it finishes you can log it to the canvas in one click).

### Fixed
- Signing in with a third-party account such as Google in the mini browser: clicking "Sign in with Google" no longer does nothing. The sign-in popup now opens in its own small window and returns to the original page automatically after sign-in (previously it would turn the sign-in page into a blank page).

## 0.4.98 — 2026-09-14

### Improved and Fixed
- Pressing the microphone for voice input no longer waits 3 seconds each time: the recognition model stays resident after loading once (released after 10 minutes idle), and after that every recording is ready within 0.1 seconds. Voice startup also no longer enters the resource waiting queue.

## 0.4.97 — 2026-09-14

### Improved
- The Runtime Center has moved into Settings as the "System › Runtime & Resources" page. Readings now come with threshold marks, hosted services are grouped into cards by project and collapsed to a one-line summary by default, and clicking a chip lets you shut one down or jump straight to the module on the canvas.
- The title bar no longer permanently shows the MCP light and the "Run" button. A temporary hint appears only when tasks are queued waiting for resources, or when MCP is off but calls are still being rejected, and clicking it takes you straight to the matching settings page.

## 0.4.96 — 2026-09-14

### New
- Idle watchdog: when no chat is running and no recording is in progress, yet the rendering process stays above 20% CPU for a full minute, it automatically captures a snapshot (a 5-second JS sample plus a list of running timers and animations), saves it under diagnostics/ in the data directory, and logs a line in the black box. It is meant for tracking down the kind of idle lag where the machine heats up while you are doing nothing.

### Improved and Fixed
- After a notification sound plays, the audio device is released, instead of being held as an output clock from the first sound onward.
- The launch button's halo on empty Frames outside the canvas viewport no longer spins idly.
- With many web nodes, duplicate internal listeners no longer pile up, which removes the listener count warning.

## 0.4.95 — 2026-09-14

### New
- Runtime Center: you can see tasks and services that are queued, running, and just finished, filter by project, and shut down or cancel them in one click. Terminals, AI chat, plugins, language servers, voice, Code Map, Wiki scans, and update downloads are all brought under unified management.
- Chat history is no longer trimmed: the archive keeps the full conversation, and the interface loads only the latest 100 entries. The history panel supports search, preview, pinning, and resuming.
- Clicking a file name or file node in Code Map opens a code preview in the same Frame.
- Symbol indexing, Wiki scans, and update downloads now run on background threads and can be canceled, so the interface no longer freezes.

### Improved and Fixed
- After the model exits with an error, AI chat no longer stays stuck on "Processing" and messages can be sent again.
- The command for installing a CLI now accepts only the app's built-in plan table. Web nodes are forcibly isolated. The main window is no longer navigated to an external page by a dragged-in link. Wiki paths and inbox sources go through a gate. Git arguments are validated.
- Actions you start yourself, such as terminals, AI chat, plugin panels, and recording, are not queued by resource thresholds and wait only under severe system memory pressure. On platforms that have not been calibrated, the resource gate is turned off automatically.
- Fixed plugins not restarting in a controlled way after a crash, child processes left behind when a terminal is closed from the Runtime Center, and the interface freezing after an AI session is closed from the Runtime Center.
- Known limitation: on Windows and Linux the resource gate is "monitor only", and the full microphone recording chain and the leftover external Computer Use pointer issue are still awaiting acceptance.

## 0.4.94 — 2026-09-12

### New
- The Dictionary adds a design selection desk, with filtering by interface type, real cover images, a popup preview of effects and design guidelines, plus color scheme and full design system prompts.
- AI nodes now connect to the vault's session credentials and wrapped commands. The six-digit code unlock dialog automatically continues the original request, and authorization still requires the user's approval.
- Images in AI chat can be enlarged in a popup, and documents and images explicitly delivered land in the current Frame.

### Improved and Fixed
- Fixed key preset name syncing, cleanup of the request timeout dialog, and the audit record layout.
- Improved keeping the document edit state, resolving image paths that contain spaces, and assigning tool records to the right turn.
- The Gantt view now hides abnormally ended tasks by default and keeps the user's filter choice.
- Improved text contrast on light and dark terminal backgrounds, and removed the number bubbles from the More drawer.
- The chat locator bar follows the latest question, and a fade at the top hints at scrollable history.
- Known limitation: the leftover external Computer Use pointer issue is still unresolved. Full end-to-end acceptance of first-time vault creation and of old passes becoming invalid after they are closed is still to be completed.

## 0.4.93 — 2026-09-11

### Improved and Fixed
- Improved the light-mode gray scale, secondary text, and the colors of vault file tags.
- Canvas AI chat and terminals now use fixed titles, sharing node badges and hover feedback.
- Updated the vault metadata navigation and detail layout, without changing the key authorization interface.
- Background terminal parsing is decoupled from visual frames, while keeping output complete.
- Test file concurrency is fixed at 4, reducing resource contention in real CLI integration tests.
- Known limitation: direct AI node key credentials and the first-time unlock guide are not implemented yet, and the leftover external Computer Use pointer issue is still open.


## 0.4.90 — 2026-09-09

### Improved
- New modules in a Frame now find an empty spot automatically and expand toward a compact square layout based on their actual size, instead of always stacking in a single column downward. Existing modules and manually dropped positions are kept.

## 0.4.89 — 2026-09-09

### Improved
- OMP quota now shows Gemini per model, with remaining amount and reset time on hover. When no data could be fetched, this is stated clearly instead of showing a fake zero quota.
- Voice input adds local voice filtering with three levels: standard, strong filtering, and basic device noise reduction. Recognition still happens on your machine, and recordings are not uploaded.
- AI chat, the launch page, the terminal input, and the to-do details now insert at the current cursor, with support for replacing a selection, continuous dictation across input boxes, and undoing the final text.

### Fixed
- Fixed an old cancel timer wrongly killing the new round's process, causing a SIGTERM exit, after clicking "Redirect" while OMP was working.
- Fixed late voice input leaking into a new draft while switching input boxes, sending, or stopping. When a manual edit conflicts, the candidate is kept and the new content is not overwritten.
- Fixed voice interfering during IME composition, duplicate final text, and the microphone still starting after initialization was canceled.

### Known Boundaries
- Voice filtering is not speaker (voiceprint) recognition and cannot guarantee excluding a TV or other people talking. Results with live microphones and soft speech vary with the device and environment.
- The lifecycle issue with the pointer left by the external Codex Computer Use is still being tracked, and this version does not claim to have resolved it.

## 0.4.88 — 2026-09-09

### New
- The browser favorites offer five entry categories: Motion, Design, Office, Server Sites, and Content Platforms, with support for custom folders, stickers, and sorting favorites into categories.
- Added a local website route table and HTML entry. The Agent can look up what a site is for and open the matching page, and the favorites form can prefill from HTML.
- Website preview supports local screenshots that the user turns on. No external screenshot service is used, and the browser keeps your login state.

### Improved
- Secondary website cards are now larger and laid out horizontally, with support for the scroll wheel and dragging. The right-edge fade and breathing hint appear only when there is still more content.
- Improved the shrink-back animation when a board module exits full screen, reducing repeated layout while keeping the state of other modules.

### Fixed
- Fixed the hover tooltip on Dictionary blueprint entries lingering after the mouse leaves.
- Fixed the missing flow for choosing or creating a custom folder for favorite sites.

## 0.4.87 — 2026-09-08

### New
- Version Control supports checking out a commit, creating a branch from a commit, returning to the original branch, comparing commits, adding tags, and copying commit messages. Switching asks for confirmation, and uncommitted changes block the switch.

### Improved
- Files changed in history are now color-coded as added, deleted, modified, or renamed, with added and removed line counts shown, and rename diffs correctly map to the original path. Binary files do not show fake line counts.
- The hover gradient glow on the icon at the top left of board modules now shows only along the rounded edge, and no longer covers the whole icon background.

### Fixed
- When a Windows short path and the Git long path representation do not match, an authorized folder is no longer wrongly judged to be out of bounds. The folder safety check is still kept.
- A new AI chat created in split view returns to the launch page and no longer inherits the old session, history restore, or automatic tasks.
- When Bizone Canvas is missing or its MCP tools fail to load, ordinary OMP chat is no longer blocked. Canvas capabilities are still honestly shown as unavailable.
- During OMP native authorization, the login panel is no longer closed by mistake, and credential verification progress is shown clearly.
- When the image preview count reaches its limit, the earliest previews are cleaned up in the order they were added, keeping pinned modules.

### Known Limitations
- The leftover external Codex Computer Use pointer issue is still open, and this release does not claim to fix it.
- This official release does not include the log upload feature of the private-test diagnostic package.

## 0.4.86 — 2026-09-08

### Fixed
- After Codex resumes from "Redirect", tool call numbers no longer conflict with historical results.
- The OMP native login screen now distinguishes browser authorization from credential saving, and keeps a manual authorization fallback.
- When a Google account lacks Cloud project configuration, the requirement is stated clearly to avoid repeated authorization.
- When an OMP chat has no valid working directory, the project association is stated clearly, without affecting other CLIs.
- Improved the visibility of the chat input cursor in dark and light modes.

## 0.4.85 — 2026-09-08

### Improved

- Workbench tools, the Bizone Canvas connector, and the usage guide are consolidated into built-in capabilities shipped with the app, and each can be turned on or off in Settings
- Managed sessions of Claude Code, Codex, and OMP now assemble base capabilities uniformly. When a chat is resumed, the connection is re-established and bound to the canvas where the original session lived
- The usage guide is read on demand, keeping user rules, third-party plugins, and disabled choices. Old managed rules are backed up and migrated by exact ownership only after the new path succeeds

### Fixed

- Launching and detecting Codex and Claude Code installed via the official npm on Windows are now consistent. Canceling a Codex task cleans up the launch process it owns

- Fixed the Codex child process not getting the canvas connection environment, so it could see the usage instructions but had no actual tools
- Bizone generation requests now include a persistent identity check. After a connection drops, the original request is queried, and when the state is unclear resending stops to avoid blind duplicate submissions. Requires Bizone 1.21.31 or later

### Known Limitations

- Bizone still needs to be installed and signed in, and generation still quotes a price first and then asks for confirmation. Paid generation on older canvas versions will prompt you to upgrade
- Remote third-party business plugins keep each CLI's native level of support, and OMP does not yet uniformly support HTTP/SSE plugins
- Windows has passed installer launch, settings, and CLI process tests, but real model calls with all three signed in still need to be tested
- In this round, a real Bizone generation hit a service error and was refunded. Reconnect claiming and no-duplicate submission have been verified, and the successful image-producing path still needs testing
- The leftover external Codex Computer Use pointer issue is still open, and this release does not claim to fix it

## 0.4.84 — 2026-09-07

### New

- While Codex, Claude Code, and OMP chats are busy, you can keep sending messages, which go into a pending queue by default. Click "Redirect" to stop the current task and send with priority, while other queued items are kept
- The input boxes of all three now support @ references and slash suggestions, with a Dictionary category added. References appear as colored tags, hovering shows the content, and images and plugins are previewed by type

### Improved

- Pending messages can be canceled and reordered. Stopping manually pauses the queue, and failures keep the content for retry. The queue is kept within the current session and is not preserved when you quit or reload the app
- Added spacing at the launch page's suggestion area and the bottom of resumed chats, so controls no longer sit against the edge

### Fixed

- Fixed Codex follow-up messages being blocked by stale state after a reply ended, requiring a refresh before sending
- Fixed the side question navigation going out of sync with the module when moving an AI chat module on the canvas
- "Redirect" keeps the confirmation step for the compact command. During the OMP startup handshake the old direction can be revoked, and retrying a failed asynchronous send no longer shows the question twice

### Known Limitations

- The external Codex Computer Use service may still leave a pointer behind. A software-level fix for this issue is not included in this release

## 0.4.83 — 2026-09-07

### New

- You can choose a model before starting a chat, and Codex also lets you choose sandbox permissions. Chats in progress show the CLI name and identifier, and for supported models you can adjust thinking effort with a slider
- Question navigation next to the chat, with hover preview and click-to-locate. Tool execution records collapse earlier entries by default, and you can expand them layer by layer
- Settings lets you turn on automatic updates for Codex and Claude Code separately, off by default. A new version is downloaded and verified, then enabled on the next launch. If verification fails, the current version continues to be used. CLI updates may affect compatibility
- The Board can generate a responsibilities charter and branch ledger for a role, and all three chat foundations can read their own role documents

### Improved

- Unified the spacing and hierarchy of the launch page, chat page, and split view, and updated the CLI, file, and worktree icons. Model selection is more compact, and the stop button is now a black icon on white
- When a CLI is not installed, install, login, and retry guidance is provided. After switching to an installed CLI, the old hint is cleared promptly and your draft is kept
- Canvas modules now share the same enlarge and shrink-back animation, reducing stutter when shrinking back. The launch button highlight now uses a compositor-layer animation
- Usage time is now grouped into ranges locally before being reported, and the privacy notice has been updated to match

### Fixed

- Fixed the resume parameters for Codex consecutive chats and the error message when an old CLI does not support a model. A failed optional MCP handshake no longer masks the real chat error
- Fixed controls being squeezed and wrapping when the chat module is too narrow, question navigation covering the drawer, and confusing highlight layers in split view. Question navigation is fixed outside the AI chat module and no longer shifts with the Frame boundary
- Fixed a certificate parsing failure caused by a particular random serial number when the remote connection generates its certificate for the first time

## 0.4.82 — 2026-09-06

### New

- **Let the AI see your screen**: a "Computer View" plugin now ships with the app (Frame double-click menu → Plugins). It can take screenshots for the AI to see. By default it captures only the frontmost window, always refuses to capture windows such as password managers and terminals, and does not capture Eas-Term itself. Images are stored locally and not stuffed into the chat, and you can see them in the plugin panel
- **It can also click the mouse and type for you, but only with separate authorization**: it takes effect only after you click "Allow 5 / 10 / 30 minutes" on the panel, with a countdown, and you can "Revoke now" at any time. **There is no permanent authorization option.** The authorization button exists only on the panel and is out of the AI's reach. It also never clicks Eas-Term itself or Bizone Canvas, and always refuses key combinations that cannot be undone, such as `cmd+Q`, `cmd+W`, and `cmd+Delete`. For first-time use, go to System Settings → Privacy & Security → Accessibility, check Eas-Term, and restart the app
- **Codex can now choose a model**: the dropdown lists the models your account can actually use, obtained by asking Codex itself rather than hard-coded. If that fails, it uses the last successful list, and only then the built-in list
- **Codex web searches are now visible**: previously what it was searching for was not shown at all, just a line saying "Processing". Now they are listed like command execution. New tools it calls (image generation, sub-agent collaboration) are no longer blank either

### Fixed

- **The interface occasionally flickered**: clicking on the blank canvas with a one-pixel hand tremor would flash a small square. Now the selection box is drawn only when you truly drag
- More complete diagnostic records when something goes wrong: when lag happens, which process was using CPU at the time is also recorded

## 0.4.81 — 2026-09-05

### New

- **Role cards now truly take effect on all three harnesses.** Role permissions are no longer described with Claude's tool names but with four capability intents: no file edits, no running commands, no image generation, and which MCPs are disabled. The same card, opened in Claude Code, Codex, or the default harness, is applied through each one's own mechanism. The editor has a three-column matrix stating what parameters each one actually ends up with, which are hard constraints, and which are downgraded. All of this text is computed live by code, so it can no longer drift from the actual parameters
- **Codex now has its two strongest guardrails**: the Scout and Reviewer roles run in a read-only sandbox on Codex, which also blocks writes through the command line, and "no running commands" removes the shell tool directly
- **Downgrade marker in the chat toolbar**: if a limitation of the selected role is downgraded on the current CLI, a small marker appears next to the role name, and hovering lists which items. It does not appear when nothing is downgraded
- **Team dispatch can use role cards**: each agent in `team_spawn` can take a `role_id`, which is recorded in the confirmation dialog and the roster, and the whole batch is rejected if an id does not exist
- Roles can set a separate model and thinking level for the default harness
- Settings adds the "Flicker Black Box": repeated component unmount and remount, long tasks, and GPU render process events are all logged, so you can look back when the interface flickers

### Improved

- The Painter card no longer turns off Codex's built-in image generation. The image generation path is constrained only by the responsibility contract, and the "no image generation" switch is kept for custom roles
- The role file format is upgraded to v2, and old files are migrated automatically with a backup kept. **Note: rolling back to 0.4.80 or earlier will lose the capability boundary settings**
- Codex sessions now consistently carry `--skip-git-repo-check`. When a CLI exits unexpectedly, the notification includes the reason from stderr

### Fixed

- When a role's default harness is given a model or level it does not recognize, the session no longer crashes outright and instead shows a "switch did not take effect" notice
- The text of the "Back to latest" pill no longer sits against its top and bottom edges

## 0.4.80 — 2026-09-05

### Fixed

- **The plugin panel could not start in the release build, reporting "spawn node ENOENT"**. Apps launched from the Dock get a stripped-down system PATH and cannot find node. Now it looks in fixed locations, and if it cannot find one it runs with the app's bundled runtime, so it starts on any machine
- **A plugin's "Chat" opened an empty chat**: without the plugin's tools and without sending a first message automatically. The root cause was that this entry on the canvas did not carry the plugin information into the actual session. It now takes the same path as the empty Frame guide button
- When the Board panel errors, the footer now shows the reason instead of staying on "Connecting to host…"

## 0.4.79 — 2026-09-05

### New

- **Plugin panels (phase one)**: plugins you write yourself can now have a UI, drawn directly on the canvas. A plugin = a standard MCP server + a manifest + an HTML panel. Claude Code, Codex, and the built-in foundation can all call its tools, and the panel exists on the canvas independently of the chat. When the model changes data in the chat, the panel refreshes itself. A sample "Board" ships with the app (Frame double-click menu → Plugins → Board), with data stored in `.eas/board.json` inside the project. Panels run in a sandbox: they cannot make outbound connections, cannot touch the main interface, and can only call this plugin's tools and allowlisted canvas capabilities
- **Role cards**: hover expands a short description of the role, the edit button at the top right opens detailed settings, "＋ New custom role" sits at the end, and left-right switching now has a full sliding animation
- **Skills search**: the drawer gets a search box that matches descriptions first and then names. The global section now follows the project section directly, without a big gap in between
- **Chat "Back to latest"**: after scrolling up through history, a small arrow floats up at the bottom, and one click returns to the latest. In an expanded tool call detail, the "Collapse" button is pinned to the bottom of the block and no longer scrolls away
- **Gantt milestones**: each diamond is now one commit (tagged ones are one size larger), no longer one per send or return. Projects without a repository have no diamonds

### Fixed

- Errors and warnings above the chat are now all dismissible: warnings disappear on their own after 5 seconds, and red errors are closed manually
- "Tidy up" now arranges modules in a grid instead of a single column

## 0.4.78 — 2026-09-05

### Fixed

- **After an update, continuing an AI chat popped "Internal error" and never recovered**. A chat that was originally on Claude Code could be mistaken for another foundation (omp) when reopened, so a session ID that only Claude recognizes was used to resume it elsewhere and could not connect. The result was an incomprehensible "Internal error", the same on every message, and that chat was completely stuck. Now **each chat remembers who started it** (Claude / Codex / the built-in foundation) and, when reopened, sticks to the original one and never swaps. Old chats that were already misidentified are **corrected automatically** when reopened after installing this version
- Also: if the foundation still reports an error, the **real cause is now shown**, instead of the generic "Internal error"
- **Text and buttons in the update prompt sat against the border**, looking cramped. Padding was restored on all four sides

## 0.4.77 — 2026-09-04

### New

- **Code Map**: a new module that lays your project out as a graph. The outer ring is "which areas" (divided by your own architecture blueprint), line thickness is how heavy the dependency is, and color is coupling risk. **Runtime circular dependencies are pulled out and placed at the very top**, since those are the ones that really need fixing. Supports **JS/TS · Python · C/C++ · Swift**, and mixed projects get results for both sides
- **Code Map can see down to the function level**: switch to "Symbols" to go from "which files depend on which" down to "which functions call which", with a **dead code list** attached (8 entries on this repository, every one verified correct). Click a symbol to see "who calls it / what it calls". C/C++ and Swift use the language servers that come with the system, and Python requires you to install pyright yourself
- **Two layouts**: the ring answers "who is connected to whom", and the cluster answers "which parts group together". Circle size follows the amount of content
- **Major Dictionary overhaul**: the top-level categories changed from "what it is" to **"what kind of work you are doing"** (Frontend · Components / Visual / Motion / Data, plus Backend · Services), and the 48 second-level technique names were not changed by a single character
- **The Dictionary gains a row of "Section" filters**: navigation bar, icon grid, popups, tables, footer... filter by whichever part you want to build. It cuts across categories, so one technique can belong to several sections, or to none
- **The Dictionary adds "Prototype presets"**: 10 common pages (mobile home / detail / form pages..., desktop landing page / console / board...), listing vertically which sections make up the page with a one-line key point each, and clicking a section expands the techniques usable for it
- **The Dictionary gained 74 entries** (455 in total), including **40 backend entries**, an entirely new branch: interfaces and contracts, storage and queries, reliability and fault tolerance, performance and capacity. They use a different prompt template with an extra [How to verify] section, because backend changes are often invisible to the eye
- **All new entries have animated previews**: frontend ones zoom in from the whole page to the section they belong to, and backend ones are drawn as a "caller → service → storage" flow diagram
- **Right-click in the Frame to insert modules**: right-click a blank spot in a Frame → "New", and directly below are Version Control / Design module / Team Panel / Code Map. Whichever you click is inserted at the position where you right-clicked
- **Maximized modules can adjust display zoom**: pinch with two fingers, or ⌘+ / ⌘- / ⌘0

### Improved

- **Role selection is now a carousel of cards**: one card at a time, draggable, with dot indicators below. The entry also moved from the toolbar to the empty state, next to "choose which CLI", which is exactly when you need to pick a role

### Fixed

- **Maximizing an HTML / file / component module made all the content vanish, leaving only a blank canvas**
- **After maximizing Code Map, the lower half of the screen was empty**, with the graph squeezed into a thin strip at the top
- **After a chat was remounted, it switched foundation** (it was using Codex and came back as something else). It is now pinned as soon as the session is established
- **Closed chats in the empty state were expanded into a big block by default**. They are now collapsed by default
- **The corner radius of the resize handle did not line up with the module**

## 0.4.76 — 2026-09-03

> This version and 0.4.75 were not released at the time, and their changes reach you together with 0.4.77.

### New

- **An empty Frame is no longer a blank space**: three AI buttons (Claude Code / Codex / omp) and a "Just open a terminal" button are placed in the middle, and clicking install starts installing directly, without one more confirmation
- **Roles can now truly constrain the AI**: the selected role is injected into the session as a contract, and tool boundaries tighten accordingly. Each of the three CLIs goes its own way, but the rules are the same
- **The AI panel can pin which CLI to use**, and it persists across restarts
- **Double-clicking the canvas has a burst effect**. The specular highlights on the three guide buttons slide along the edge and collapse into a sweep of light when the mouse gets close

### Improved

- **The terminal goes back to being just a terminal**: the Agent control bar that used to sit on top of the terminal has been removed. To talk to the AI, open an AI chat, and the terminal only does terminal things

### Fixed

- **After the omp process died, pressing Stop did nothing and the interface stayed on "Processing" forever**
- **After an omp session sat idle for a while, messages sent to it could never go out**. This was the real root cause of the "stuck" behavior
- **When maximized, the canvas sidebar covered the content**
- **The name on the pill was truncated**

## 0.4.74 — 2026-09-02

### New

- **A ready-to-use built-in AI foundation**. You no longer need to install Claude Code or Codex first: open the app and start chatting. It comes with the installer and never quietly downloads anything while you are using it
- **Two ways to connect it, using whichever you already have**: sign in with a **subscription you have already bought** (ChatGPT Plus/Pro, Claude Pro/Max, Zhipu GLM Coding Plan, Kimi Code, GitHub Copilot, Cursor... 69 providers in all), or **enter an API key**. Subscription sign-in opens a browser for you to log in, and credentials are stored on this machine and renewed automatically. An API key goes through the vault, and only enters this model process and does not follow into terminals you open later
- **Its tool calls still need your approval**. To run a command or edit a file, an approval card pops up first, following the same rules as Claude Code
- **Image-drawing tools are turned off on it**: on this machine, image generation goes only through Bizone Canvas

### Improved

- **The quota bar can now show a third provider**. After subscription sign-in, its usage and reset time are shown alongside Claude and Codex. With an API key there is no "quota" concept, so that section does not appear (you will not see a cell stuck at 0%)

## 0.4.73 — 2026-09-01

### Fixed

- **Claude Code was installed, but the app kept saying "Not installed" and offered no launch button**. New versions of Claude Code move themselves to another location (`~/.local/bin`), while the app only recognized two old locations, so the day after upgrading, something that worked yesterday suddenly looked "not installed". On the same machine, Codex had not moved and was displayed normally, which made it look more like the app was broken. Now it **first asks your own terminal "where exactly is the command"**, so it can be found wherever it is installed

## 0.4.72 — 2026-09-01

### New

- **⌘, opens Settings, and ⌘J creates a new AI chat**. ⌘J works in both split view and the canvas. On the canvas it opens in the Frame you selected (or the Frame at the center of the screen if none is selected), following the same rule as ⌘T
- **A batch of missing canvas keys filled in**: `⇧⌘O` tidy up · `⌘B` / `⇧⌘B` open and close the left "File Info" and right "Wiki" drawers · `⌘=` zoom in, `⌘-` zoom out, `⌘0` back to 100%, `⇧⌘0` fit everything on one screen. All can be changed under "Shortcuts" in Settings
- **"Processing" is now a dot-matrix ball that unwinds itself**. The old three dots breathing in turn were indistinguishable from loading animations elsewhere. Now it twists layer by layer and back again, so you can tell at a glance that "it is working"

### Improved

- **The Island really no longer competes with the main window this time**. The previous version said it would step back, but several paths could still make it pop up again: not being fully dismissed after you click into the app from it, a leftover "user is reading" flag surviving until the next time after it was dismissed, and it expanding again by itself because of a new notification the instant you switch back to the app. Now whenever the app is in the foreground it always yields, and wherever you click in the app, it steps back on the spot
- **"Show Island" in the Dock right-click menu finally works**. After the previous version's change this menu item had actually stopped working, and clicking it did nothing

### Fixed

- **After the canvas was zoomed in, clicks in the terminal were off and drag selection picked the wrong line**. At 130% the offset was exactly one full line, so clicking an AI option often hit the neighboring one
- **After chatting for a long time, your own question stuck at the top disappeared**. Scrolling through screen after screen of answers, the "what you asked" that should stay pinned at the top never appeared
- **After reopening a chat node, you could not see what you had asked**. When saving, questions were crowded out by answers: one question averages several dozen answer segments, and the saving quota was shared between both, so often not a single question was kept
- **Clicking a module of another project on the canvas, then switching back to split view, stayed on the original project's tab**. The "current project" followed along, but the "current tab" did not

## 0.4.71 — 2026-08-31

### New

- **"Term Dictionary" is renamed "Dictionary" and changed from a floating ball on the canvas to a panel summoned from the title bar**. The ball was always sitting on top of the canvas, but the Dictionary is a "quick lookup" tool that should not permanently take up space. Now it appears when you click at the top right, closes when you click anywhere outside the Dictionary, can be moved by dragging the bar at the top, and next time appears where you last closed it
- **Clicking an entry no longer dumps a big block of text into the input box, but attaches a small capsule**. A prompt is two or three hundred characters, and inserting it directly would drown out what you typed yourself and could not be undone. Now only the entry's name shows above the input box, hovering shows the full text, and **it expands into the complete prompt only at the moment of sending** to the model. Click ✕ if you do not want to include it. The terminal does not have this (it is a byte stream and cannot hold a block that can be clicked away), and still inserts the full text directly
- **All 381 entries now have an "how to implement" prompt**. Before, 242 entries inserted an **explanation** when clicked, and the model receiving it would only discuss the concept with you without knowing what you wanted it to do. Now each is an instruction you can follow directly: the effect to achieve, when it triggers, how exactly to do it, recommended parameter values, the easiest places to go wrong, and whether a library needs to be installed
- **Dictionary categories are now two levels organized by "what you want to do"**. They used to be split by technical area (interaction behavior / motion / UI visuals), so building a "loading" state meant browsing three categories: skeleton screens under interaction, pulse animations under motion, and placeholder gray blocks under visuals. Now the first level is scenarios (Input & Forms / Lists & Scrolling / Loading & Waiting / Transitions & Entrances / Gestures & Dragging / Feedback & Hints / Material & Texture / Layout & Style / Motion Principles), and the second level is the specific techniques, 48 of them
- **Dictionary search can now search the body text**. It used to search only names and keywords, so typing "closure" found nothing. Now prompts, explanations, and category names are all in the search scope: typing "closure" finds debounce, and typing "interaction behavior" pulls up the whole category. Because the names of entries matched by body text do not match what you searched, they are distinguished with a dashed border, and hovering tells you "the word you searched for is in this sentence"
- **When the sidebar is collapsed, the strip lists all projects**. A running project breathes, and a finished one is highlighted
- **The Island can be turned off in Settings**

### Improved

- **However you open the app's main window, the Island steps back to the background** and does not compete with the main window
- **"Extended capabilities" and "MCP call log" have moved into Settings**, and the title bar keeps only one indicator light
- **Frames always use the theme color, and the color you set for a category on the Board appears only in the dot in front of the title**. Recoloring an entire Frame was too noisy
- **Adding entries to the Dictionary is now something you ask for explicitly**. There used to be a switch that, when on, scanned code on every commit and handed terms not yet included to the model to turn into entries. It could only guess at categories, could not draw diagrams, and spent tokens when you were not looking. Now you tell the AI "add XXX to the Dictionary", and it confirms with you which category it belongs to, fills in search terms and descriptions, draws the diagram, writes the prompt, and only then adds the entry. **What to add and when to add it is up to you**

### Fixed

- **When a chat was saved, "what you asked" was dropped**. After reopening that chat, only the model's answers remained, and all your questions were gone
- **Clicking a notification to jump to a terminal zoomed the canvas to a scale where you could neither see the whole terminal nor drag it**. The terminal was taller than the screen, and wherever the mouse pressed it landed inside the terminal, leaving no blank canvas to grab. Now the jump zooms so the whole terminal is visible, with room left around it to drag
- **After the Island was expanded, clicking anywhere in the main window now collapses it**
- **AI chat showed an approval prompt on every tool call, and turning off the switch in Settings had no effect**. Old versions automatically installed an approval hook into each project's `.claude/settings.json`. Later, approval changed and no longer installs it, but **the ones already installed in your repository were never uninstalled**, so they kept blocking every time. The switch in Settings is called "Ask before acting", and it controls the system prompt (its own description says "writes no configuration files"), unrelated to this hook, so turning it off had no effect on it. Now when approval is not enabled, the session is not tagged, and the hook, getting no tag, lets things through by itself. To also clear that file, go to Settings and turn "Ask before acting" on and then off
- **Sessions opened on the phone were not received on the computer**, and **on the phone, AI answers did not appear character by character** and only showed after the whole passage was finished

## 0.4.70 — 2026-08-31

### New

- **Dragging a card to the edge on the Board now scrolls automatically**. One screen fits exactly four columns, and more columns slide to the right. Before, dragging a card from column 1 to column 6 was **impossible**: your hand kept pressing, with no second hand to scroll. Now pausing at the left or right edge scrolls horizontally, and pausing at the top or bottom edge of a column scrolls vertically
- **The project menu that appears when you double-click the canvas is now searchable**. With 27 projects in a flat column, finding one meant scanning from the top. Now you can start typing as soon as it opens, and Enter selects the first result. Matching works on "letters appearing in order", so `bg` finds `Bzone-Gateway` and `vct` finds `vibe coding/terminal`. This is the most natural way to type, and plain substring matching cannot do it. For Chinese, just type one or two characters
- **The Frame right-click menu is now two levels**. The status group used to be flat, and with many status columns it stretched the menu into a long strip, pushing "Rename / Collapse / Delete" out of sight. Now "New" and "Set project status" are each collapsed into a submenu, and the current status is shown at the first level, so you know what it is without expanding

### Improved

- **When a Frame is collapsed, its title bar keeps only "Expand"**. The whole row of buttons used to remain, but everything they do assumes you can see inside: tidy-up shows no result, and new nodes would land in a collapsed box
- **The project menu's sort toggle changed from a line of text to two icons at the top right**. The line used to sit between project rows, and clicking it by mistake cost you a wasted jump to a project

### Fixed

- **When checking for updates fails, it now tries again with a different network stack**. Someone reported "never receiving update notices" while Settings showed `net::ERR_FAILED`. Once this chain broke, the only way to notice was to go and look in Settings. Now both network stacks are tried once each, and the error carries the reasons from both attempts
- **The "Copy full diagnostics" button on the "Performance" page in Settings no longer uses the system default style**
- **An AI chat created on the phone showed as a blank box on the computer canvas**, with nothing inside when clicked. It is now a normal chat panel
- **Things done on the phone now leave a trace on the canvas**: nodes that were created or sent messages get a highlight ring and a badge, and the title bar of their Frame shows the number of items not yet viewed (visible even when collapsed). Before, nodes quietly appeared in the middle of a Frame thousands of pixels tall, and you would never notice

## 0.4.69 — 2026-08-30

### Fixed

- **On Windows, "anything involving the terminal lags, or even the whole app stops responding"**. The terminal automatically detects file paths in output (the links you can Cmd/Ctrl-click to open), and detection has to check whether each path exists one by one. This used to be done **blocking the main process**, once every time the mouse passed over a line, up to 15 per line. On Mac it takes under a millisecond and is unnoticeable. On Windows, with antivirus watching every file read and write, a single line could block for tens to hundreds of milliseconds, so moving the mouse in the terminal caused continuous stutter, and in severe cases the whole window stopped responding. Now the check runs in the background and results are remembered, so it no longer blocks the interface
- **A lone `:42` in the terminal is no longer drawn as a link** (it used to point to the project root)

### New

- **Settings gains a "Performance" section**: it shows whether graphics acceleration is actually working on this computer. With some graphics cards or drivers, interface rendering falls back entirely to the CPU, and then lag has nothing to do with how good your graphics card is and everything to do with whether this is on. **It is shown only on this machine and uploads nothing**, and next to it there is "Copy full diagnostics", which you can send to me to pinpoint the problem when things lag

## 0.4.68 — 2026-08-30

### Improved

- **Canvas panning and zooming no longer stutter**. Before, the dropped-frame rate was 24% while dragging the canvas, and dragging felt jerky. It turned out that every dragged frame re-laid-out the body text of every node on screen (chat records and document nodes included), nearly fifty thousand times in three seconds. Now the same content is laid out only once, and the **dropped-frame rate falls from 24% to 0%, with the average frame time down from 25 ms to 8.4 ms**. The more nodes and the longer the chats, the bigger the improvement
- **When the canvas is zoomed out, terminals are no longer top-heavy**. Before, zooming out just "showed fewer lines" while the font size stayed the same, but the input box is only one line with no content to trim, so the more you zoomed out, the more prominent it became: at 35%, the input box took up a quarter of the height and the hint text was truncated. Now the whole terminal scales proportionally, **with the same proportions at any zoom level**, looking like a shrunken photo. The slight jump at the end of a zoom gesture is also gone. To see the content, zoom in, or double-click to maximize

## 0.4.67 — 2026-08-29

### Fixed

- **Codex sign-in no longer asks you to change settings on the ChatGPT website first**. The previous version used device-code sign-in, which has a prerequisite that is **off by default**: opening the authorization page bounces you back, telling you to first enable "device code authorization" in "ChatGPT security settings" and try again. Now it uses regular sign-in with no such prerequisite, and after authorization it usually jumps back on its own, without even typing a code

### Improved

- **Sign-in is now a standalone popup**. It used to be embedded in the chat box, but nodes on the canvas are often only three or four hundred pixels tall, so expanding the panel squeezed out the input box and chat history, and the long sign-in URL had to scroll sideways inside it. Now it is a centered popup that closes with Esc or a click outside (**it will not be closed by mistake while an install is in progress**, because that would cancel an install that has been running for minutes, so to abandon it you have to click the × at the top right)
- **The sign-in popup has a question mark at the top right**: if the web page will not open or is blocked by your region or company network, hovering tells you what to do, and clicking opens a terminal that runs the sign-in command in one click, or lets you copy the command. After signing in and returning to the app, the status refreshes automatically. **By default everything is still completed inside the interface**, and this is only an exit for when that does not work
- **It no longer makes you think you must paste an authorization code manually**. Both CLIs actually jump back on their own after authorization, and that input box is a fallback (only useful when the web page really gives you a code). The old wording made it sound like a required step, so people would sit waiting for a code that never appears

## 0.4.66 — 2026-08-29

### New

- **There is now a guide page on first launch**. This app does not talk by itself, and the ones doing the work are Claude Code or Codex. But before, opening it showed only an empty canvas, with nobody telling you that you need to install something and then sign in. Now the first launch lists the status of each of the two CLIs (not installed / installed but not signed in / ready to use), and you can install and sign in on the spot. **It can be skipped**, and after skipping, you get one more reminder the first time you pick a CLI
- **The Gantt view gains a milestone mode and a project mode**. It used to record only "which messages you sent", laid out flat one by one. Milestone mode also counts stage-level tasks and replies, and project mode aggregates by "a stretch of work": if there is no new input for 30 minutes after the AI's last output, the stage is considered over, and the end time is that of the last return
- **When the AI asks "which one" in the body text, the options become clickable cards**. Before, it listed 1/2/3 and you had to type it yourself. Now you just click, and the choice is filled into the input box (not sent automatically, because after choosing you often want to add "but..."). Works with both Claude Code and Codex

### Improved

- **Installing and signing in are all done inside AI chat, without opening a terminal**. Before, clicking "Install" popped up a terminal to run the command, and you stared at a screen full of output not knowing whether to press Enter, and after installing you had to type `claude login` yourself. Now there is a progress bar and one line of "what the installer is doing", and after installing it connects straight to sign-in, all without leaving the chat box. **The original command is still shown to you before installing**, so you can see what you are agreeing to. If the install fails, the installer's raw error is expanded for you, with a "put the command into the terminal and I will do it myself" fallback, since problems with corporate networks, proxies, and permissions can only be solved with the raw error
- **Sign-in no longer opens a browser by itself**. It is now a "Click to sign in" button: a left-click opens it, and **a right-click copies the sign-in link** so you can open it in a browser you trust. The Codex path shows the one-time code in large type, and the Claude path lets you paste the authorization code right in the panel, so neither needs you to go back to the terminal
- **AI chat now has a memory cap and drops history together with context compaction**. Before, a chat left open for a long time kept all its records in memory. Now when the CLI compacts context on its side, the matching history is dropped here too, so long sessions no longer get heavier the longer you use them

### Fixed

- **Typing while not signed in no longer gives a baffling "CLI process exited"**. This is the most important item in this version: before, someone who was not signed in would type a sentence and send it, the CLI would start as usual, hit an authentication failure, retry repeatedly, and die, leaving only a red "CLI process exited (code 1)" on screen, which looked like "it crashes as soon as I type". Now it asks before sending, and if you are not signed in it guides you straight to sign-in, **keeping what you typed in the input box** so you can pick up sending after signing in. A mid-session sign-in drop (expired login) is also recognized, and the sign-in entry is given on the spot
- **Right-clicking on the sign-in panel no longer pops up the canvas's "Close terminal"**. The right-click there means "Copy sign-in link", and someone trying to copy the link almost closed the whole node

## 0.4.65 — 2026-08-27

### Improved

- **Two causes of "not responding" on Windows are dealt with**. One: checking whether a terminal is busy would launch a PowerShell to enumerate every process on the system. With many terminals this happened every second, and now a lighter method with caching is used. The other: web nodes on the canvas were exempt from background throttling, so when the app went to the background, a dozen or so web pages kept spinning at full speed. Both are noticeable only on Windows, and you cannot feel the difference on Mac
- **The Island's corner radius is doubled**, and hovering shows the same edge highlight as canvas modules
- **When a CLI is not installed, the "Launch" button becomes "Install" directly**. Before, an uninstalled CLI was grayed out in the menu and its button was grayed out too, saying "xx command not detected". It told you that you could not use it, but gave no way forward. Now uninstalled ones can also be selected (marked "Not installed" next to them), clicking the button asks whether to install, and if you agree, opens a terminal and installs it. On a new machine with no CLI installed, this control bar no longer disappears completely

## 0.4.64 — 2026-08-27

### New

- **The Island can be collapsed**. The permanent black block at the top covers content, so now **right-click it** to shrink it to a small breathing dot to the left of the camera, and click the dot to expand it again. Collapsing is not turning it off: notifications still arrive, the dot's color follows the state (amber and faster breathing when waiting for approval, green when running, gray when idle), and the top right carries the pending count. The collapsed state is remembered and stays collapsed after a restart
- **AI chats can now be seen on the Board**. Before, only terminals were counted, so even if a project had three AI chats running, its card said "No terminals yet". Now the terminal count and the AI chat count are shown separately, an icon in front of each row tells them apart, and both count for the "running / awaiting action" states
- **Clicking a Term Dictionary entry can insert it into the AI chat input box**. Before, it could only be inserted into a terminal. Now it is routed by whichever input box you touched last: if you just clicked the AI chat, it goes there, and if you just clicked a terminal, it goes into the terminal
- **When a CLI is not installed, one click asks whether to install it**. If you agree, it opens a terminal and runs the install command directly, so you do not have to press Enter yourself. The command is listed as is in the confirmation box so you can see what you are agreeing to, and you can also choose "Just put the command into the terminal" to handle it yourself

### Improved

- **Hovering over quota shows "how long until refresh"**, instead of an absolute time like "Resets Aug 28 09:00" that you have to work out yourself
- **The motion entry demos were redone**. Removed 6 that do not move at all in the selection desk (the demo was a still image), and fixed 36: some demoed interactive components that had no response at all (for example, hover on a component driven purely by the scroll wheel), some clicked positions that were not on the feature at all, and some were cropped too small to tell what they were. Any that stayed still for more than half a second at the start were also re-recorded, because if hovering has to wait half a second before anything moves, you are already wondering whether it is broken

### Fixed

- **In full screen the top bar did not reach the top**, and the buttons above are now unified in a "text + vertical divider" style, with the whole bar narrower
- **The project and file area on the left in split mode can be collapsed**, leaving a narrow strip with the project's first character
- **The settings menu is now tabs**, no longer piled onto one page
- **The voice button on the to-do list panel** moved into the bottom right of the input box, and the bottom of the input box is now spaced away from the window
- **When a module is maximized, right-clicking in its content area no longer pops up the canvas menu** (the canvas is not even visible then, and a "Delete node" popping up would mean acting on something you cannot see)

## 0.4.26 — 2026-08-14

### Fixed

- **After switching to the canvas and back, the "a terminal is waiting for you" marker disappeared**. This problem had existed for a while, and we had assumed that switching views triggered the terminal to recompute its size and collided with the shell's own title-setting hook. This time we added instrumentation and measured, and found it was not that at all: the title never changed during the view switch. The real cause is that when switching back to the terminal view, the current terminal is **automatically** focused once, and "terminal gained focus" had always been treated as "you have seen it", so the marker was cleared along the way. You did nothing but switch a view, and after that the fact that an agent was stuck waiting for you would never remind you again. Now "seen" is recognized only by real mouse clicks and keyboard input. **Side effect**: when you switch tabs past a terminal with a lit marker, the marker no longer disappears automatically, and you have to click it or press a key. Staying lit a bit longer is merely annoying, whereas clearing it wrongly could mean you never find out an agent is waiting
- **Animations on the canvas did not respect the system's "Reduce motion"**. With that accessibility switch on, breathing and pulsing in the rest of the interface stop, but the canvas kept moving as usual. This is now fixed: looping breathing and pulsing stop, and displacements such as drag-to-reorder and hover enlargement no longer play out and go straight to their final position. Color and opacity fades are kept (that is the alternative this setting recommends), and drawers, toolbars, and the lightbox still expand, because their position is itself expressed through displacement, and stopping them together would make drawers impossible to open

## 0.4.25 — 2026-08-14

### New

- **To-do list**. Right-click anywhere on the canvas to create one, and add an item with the `+` at the top right. Click the circle in front to check an item off, and the card moves into a collapsible "Completed" section. The handle on the right lets you drag to reorder up and down, and other cards make room in real time instead of jumping only when you let go. Click a card to open a lightbox for detailed body text, and click outside the lightbox to close it. **It is not cleared when you take a snapshot**: only annotations like rectangles, arrows, and notes are cleared with the snapshot, and to-dos are meant to stay
- **Skill management panel**. The name at the top left of the Wiki drawer is now a dropdown, and switching to "Skill" shows each CLI's skills: when a project Frame is selected it shows that project's skills, and when none is selected it shows the global ones. Click a skill name to expand its file tree, and files can be dragged onto the canvas to edit directly. Skills can be copied with right-click and pasted into another folder (**duplicate names are always rejected and you are told**, with no overwriting or automatic renaming to `xxx-2`), and can also be temporarily disabled with right-click. Disabling only writes a manifest, and **not a single byte of the files on disk is touched** (the cost is that the CLI itself will still load it, which is explained on the panel)
- **Skill folders are no longer hard-coded**. Besides the few built-in default locations, you can add your own folders. If you move skills into `design-skills` / `motion-skills` for progressive-disclosure style organization, the panel recognizes it
- **The agent can help you organize skill categories**. Tell it "organize my skills", and it will read all your skills and sort them into a flat single level of categories, shown directly on the panel with a collapsible header per category. Categories are written only to Eas-Term's own configuration, without touching your skill files or affecting how any CLI loads them

### Improved

- **When tidying a Frame, terminals are placed first at the top left of the first row**. Before, terminals could be pushed lower after tidying, and you had to look for them
- **"Sticky note" is renamed "Note"**
- **Things outside the canvas can now cover things inside it**. The File Info and Wiki drawers and the floating icons around them are all layered above everything inside the canvas (including rectangles, arrows, and notes)
- **The scroll wheel is no longer intercepted by annotations**. Before, once the mouse moved onto a rectangle or note, the canvas could not scroll or zoom. Now the wheel belongs to them only when they are selected (a note's long text can still scroll)

## 0.4.24 — 2026-08-14

### New

- **The reminder bubble at the top right now opens a list**, listing only projects that have finished their work, and clicking an entry jumps directly to the matching terminal

### Improved

- **The four places that show status now use the same logic**: the Island, the reminder at the top right, the status on the right side of a project, and the list that appears when you double-click a project. Before, each calculated on its own, which could produce contradictions like "the Island says running, the list says done". Now they share the same state machine
- **The list that appears when you double-click a project is now sorted dynamically**: awaiting approval first, then finished, and still-running last. Status is no longer shown as text but as animated icons: three dots bouncing in turn means running, a circle with a check means done, and a breathing circle with an exclamation mark means waiting for your approval. The useless "Already on canvas" status is removed

### Fixed

- **The notification at the top right disappeared**. When the previous version swapped the left and right drawers, this bubble went along to the left and landed inside the box of the run-monitor panel, where it was covered. It is now moved back to the top right, and it yields on its own when the Wiki drawer is expanded
- **After jumping into the app from the Island, the input method could not type and the mouse hover did not respond**. The cause was that this activation method only pushed the app to the foreground without truly making the window the "key window", and input methods and mouse pointers recognize only the latter. It now does the equivalent of "right-click the Dock icon → Show All Windows"
- **When the agent was still running and called for you, the five places showing status now light up again** (before, one path would wash out the "awaiting approval" marker)
- **The "Completed" list popped up by itself when you had not clicked the bubble**
- **The MCP bridge, key dialog, and second instance would pick the Island instead of the main window**. It showed up as dialogs popping onto a 40-pixel-high strip, or not being visible at all

## 0.4.23 — 2026-08-13

### New

- **You can now mark things up on the canvas**: rectangles, arrows, and notes to circle the area you mean
- **Box-select to take a snapshot and show it directly to the agent**. Draw a box over an area on the canvas, and the screenshot is sent to the agent along with your markings, saving the "screenshot → save file → drag in" routine

### Fixed

- **The marking layer swallowed drops and right-clicks**. After drawing a rectangle, the right-click menu and drag-and-drop over that area stopped working
- **Version Control landing on a non-git folder turned the whole interface white** (an existing problem, unrelated to this version's new features)
- **Snapshots sometimes captured another project**: if a node had been maximized earlier, leftover selection state would steer the snapshot to the wrong place
- The right-click menu on shapes should not contain "Close terminal"

## 0.4.22 — 2026-08-12

### Fixed

- **"Working / Work done" and the Island's status monitoring all disappeared**. The cause was not in Eas-Term: Claude Code 2.1.229 changed how it writes the terminal title. Before, while working, the title was prefixed with braille spinner characters (⠋⠙⠹…), and now it uses half-filled circles (◐◑ alternating), and ✳ when idle. The whole app recognized "is this terminal working" only through that single braille signal, so not recognizing it meant being idle forever, and three features went mute together. Now both old and new characters are recognized, **and a fallback that does not depend on specific characters was added**: as long as the first character of the title keeps changing while the name after it does not, it is treated as spinning, so it will not fail silently again if it changes symbols next time. That character is also stripped from tab names, so you will no longer see `◐` or `✳` in front of a name
- **The terminal occasionally showed "no output and the status not moving"**. A problem that could only be hit under specific timing: when a terminal subscribes to output, if there is buffered content to replay beforehand, the replay happens synchronously at the moment of subscription, and at that time a piece of code had not finished initializing, so the exception took down all the later event registrations (title, resize, bell). Moving that code before the subscription removes the window

## 0.4.21 — 2026-08-12

### New

- **The Wiki can now be built with your own categories**. It used to be eight hard-coded folders (Inbox / Me / People / Methods / Domains / Projects / Materials / Templates), and someone doing research who wanted "Topics / Literature / Experiments", or someone making content who wanted "Ideas / Materials / Drafts", just had to put up with it. Now tell the agent "the Wiki categories do not suit me, I want to build it my own way". It will first lay out the distribution in your current library (which folder is piled up, which is empty), then ask you one question at a time to find out roughly how many kinds of things you usually put in and how to describe each in one sentence, give a plan and wait for your approval, and then build the new library and switch to it
- **Not a single byte of your existing library is touched**: nothing moved, changed, or deleted. The new library is built elsewhere and you can point back at any time
- The new library has exactly the same capabilities as the built-in one: queries, graph, health check, inbox badge, archiving, and backlinks all work as usual

### Improved

- **The usage guide for the AI is now loaded on demand**. It used to be a 300-line document read in full for every chat. Now what stays resident is under 100 lines of "what to do when", and the detailed how-to for the four areas of canvas operation, image generation, keys, and the Wiki is split into separate files, read only for the area being used. This is most noticeable in Codex: before, changing a single line of code there meant first paying tokens for a whole canvas guide

### Fixed

- **The footprint list in the "Extended capabilities" panel under-reported files**. It is the table that tells you "what we wrote onto your machine and what uninstalling will delete", and it could only list one of the files before. Now it lists every file actually written

## 0.4.20 — 2026-08-11

### New

- **Terminals in split mode now have command buttons too**, just like the row on the canvas. It recognizes by itself whether Claude or Codex is running in this terminal. The criterion is the real process in the terminal, so it is recognized whether you started it from the console's "Launch" or typed `claude` yourself, and the buttons disappear on their own after it exits

### Fixed

- **The CLI was fixed but the app kept saying "not detected"**. This actually happened: Claude Code's auto-update was blocked by npm's script policy and the native binary was not in place, and after it was fixed, Eas-Term still insisted it did not exist, and the slash command buttons disappeared with it, until the app was restarted. The cause was that the detection **ran only once per panel and never re-probed**, and the recovery listener that only hooks in when "neither CLI is present" missed the most common case of "only one of them is broken". Now the window re-probes every time it regains focus, so if you install or fix it elsewhere, it is recognized when you switch back

## 0.4.19 — 2026-08-11

### New

- **A row of command buttons under the canvas terminal's control bar**. One click sends the command straight to the agent, so you do not have to type slash commands yourself. Six common ones are always shown: compact context, view context usage, plan mode, start a new round, copy the last reply, and usage and cost. Click "⋯" for more: review changes, security review, resume session, switch model, thinking level, reload skills, and generate a project description. The buttons carry plain-language labels, Claude and Codex are sent different commands underneath, and you do not need to remember them
- **Irreversible actions ask first**, and state clearly what you would lose: compacting replaces the conversation with a summary (details cannot be recovered), starting a new round clears the context (the old session is still on disk), and a review takes time and quota. In the submenu these are marked "Needs confirmation" so you know before clicking
- **The buttons appear only on terminals that are actually running an agent**: a bare shell does not show them (otherwise clicking would only give a `command not found`), and while the agent is working the buttons are grayed out and unclickable (a command inserted at that moment would be swallowed by it as a paste)

## 0.4.18 — 2026-08-10

### New

- **Code blocks in Markdown now have a copy button at the top right**, and one click copies the whole block, with the icon turning into a check to show success. It is available in file preview and the Wiki. What is copied is the original text, and `<`, `&`, and quotes do not become web escape sequences

### Fixed

- **After jumping in from the Island, Chinese could not be typed and the mouse pointer did not change**. The previous version added a check to confirm it had "really come to the foreground", and that check asked the accessibility layer, which **cannot see Eas-Term** (measured: while this app was truly in the foreground, that query reported "no foreground process found" 40 times in a row, while in the same second it answered quickly and accurately when Finder was brought to the front). So every jump was judged "did not switch over", and then a remedial action was run, and that action had a 3/8 chance of handing the foreground to an entirely unrelated background app while the window was still lit in front of you, looking like it was in front but the system had not given it the input method and mouse pointer. The fix itself became the source of the fault. Now it uses a different query that does not go through accessibility, and **does nothing when it cannot get an answer** (if you do not know, do not meddle), and the remedial action was replaced with one measured to have zero side effects
- **Notes in the Wiki could not be opened**. The placeholder on the right saying "Select a note on the left" filled the entire panel and covered the note list on the left completely, visible but unclickable
- **A video on the canvas now pauses automatically when you click elsewhere**. Before, once you opened a video it kept playing, even though you were already typing in a terminal and it was still decoding next to it, wasting power. Now clicking elsewhere stops it, the playback position is kept, and clicking back resumes
- **The microphone now closes when you click the send button**. Before, only ⌘↵ closed the mic, and clicking the send button beside it did not count, so the message went out while the mic was still recording, and your next sentence got attached after it. Now the mic closes no matter where you send from, and to speak again you click the microphone yourself
- **You no longer need to open Bizone Canvas yourself before asking the AI to generate an image**. Before, if the canvas was not open, saying "draw a cover" would just fail inexplicably, because the canvas interface exists only while it is running and nothing started it. Now before the call it automatically opens the canvas in the background (without stealing the window you are using) and continues once it is ready, and if it was already open there is no delay at all
- **When the Bizone Canvas version is too old, a channel that can never connect is no longer set up**. The installer of old canvas versions (before 1.21.20) does not include the dependencies MCP needs, so installing it was useless, and the error was only "connection failed", making it impossible to see that the canvas needed an update. Now it is verified before installing, and if verification fails it is not set up, so you can see at a glance in the interface that it is not connected, instead of a fake setup. Also, the connection method now uses the canvas's own runtime, so whether node is installed on your machine and which version does not matter
- **Fixed "the AI says it is generating, but the result never arrives"**. To keep the AI from spending money on its own, Bizone Canvas generation takes two steps: first write the parameters, then you confirm (or explicitly declare unattended) before it truly starts. The instructions we gave the AI left out the second step, so it would keep polling a task that had never started. Also fixed a few other things it used to get wrong: with multiple reference images the prompt must name which one is which, the parameter names for connections, and prompts should be written in Chinese
- **Deleting a terminal now closes all four modes together, leaving no blank boxes that cannot be dismissed**. Before, the canvas and split view each deleted on their own, and deleting from either side left half behind on the other. The half left on the canvas was especially troublesome: a terminal node is recognized by the terminal panel inside it in the right-click menu, and with the panel gone, right-clicking it showed no options at all, and it only went away after a restart. Now deleting from any place clears all four modes together, and closing a tab or deleting a project also cleans up completely

## 0.4.17 — 2026-08-09

### New

- **Right-click a bar on the Gantt view to choose which mode to view that terminal in**: Canvas, Terminal, or Board. After you choose once, a left-click on a bar goes straight to the mode you last chose (Board the first time). When going to the canvas, the viewport moves onto that node, so you do not have to find it yourself

### Fixed

- **When you switch away to copy a key while filling in a new one, the panel is still there when you come back**. Before, the first click back into the app was treated as "clicking outside", the panel closed on the spot, and everything you filled in was lost. Now it closes only when you click Save, click Close, or press Esc
- **Confirmation dialogs are no longer covered by the panel that opened them**. Deleting a key, deleting a Gantt record, and the rollback confirmation at launch: these confirmation dialogs sat in a lower layer than the panel that called them, visible but unclickable. This was not just a vault problem, six places hit it, and all were fixed together
- **The Island now rebuilds itself after crashing**. Before, once its display process had a problem it stayed broken until you restarted the whole app. After long use it would turn into a line of unstyled bare text, most likely because of this
- When the Island has a problem, it now leaves a record in the log. Before, anything that went wrong with it was silent: even a stylesheet failing to load raises no error at the system level, so "not seeing what the error looks like" was not a failure to find it but that there really was nothing

## 0.4.16 — 2026-08-09

### New

- **Right-click the terminal input box to insert a to-do list**. It sits just above the input box: add a few things to do, and click them off when done. It follows the terminal, different terminals do not interfere with each other, and it is still there after you quit and reopen the app
- **The Gantt view can zoom its timeline**: ⌃+scroll wheel or a two-finger pinch on the trackpad, from at most three days down to one hour per screen, anchored to the cursor (the moment under the cursor does not drift while zooming). The original "24 hours / 3 days" buttons remain as shortcut jumps
- **A project shows as many rows as it has terminals open**, and the project name becomes a collapsible group header. Before, one project was squeezed onto one row and parallel tasks were stacked on top of each other, so you could not tell which belonged to which terminal
- **You can now delete records yourself**: hover over a bar to delete a single one, and the chart also has "Clear this range" and "Clear all", with the button stating exactly how many will be deleted

### Fixed

- **Problems with Gantt data no longer drag down other things**. It now has its own layer of protection, so bad data is blocked before drawing, and even if it really crashes, only the Gantt view is lost. Terminals, the canvas, and the Board keep working, and you just switch over

## 0.4.15 — 2026-08-08

### Fixed

- **Dragging the video progress bar broke playback**. To jump to a point in time, the player relies on requests that fetch only a middle range of the file, but the app's internal channel for fetching local files only ever returned the whole file and did not understand such requests, so every seek failed silently. This is now supported properly, and playback continues wherever you jump
- **The video full-screen button did nothing**. The permission layer was rejecting full screen altogether, unrelated to how the picture was laid out. Full screen now works, and after exiting, the video returns to its original spot on the canvas, following canvas panning and zooming as before
- **On the Gantt view, when hovering put the details box against the right edge of the window, it was squashed** (text crammed into columns of two or three characters per line). It now pulls back inside the window automatically, flips to open upward when near the bottom, and scrolls inside the box when the content is especially long

## 0.4.14 — 2026-08-08

### Fixed

- **Hovering on the Gantt view mixed a large block of garbled text into the details** (looking like `<35;22;13M<35;23;13M…`). It is not garbage: it is the coordinates the terminal reports when the mouse moves inside it. The code that records what you said did not recognize it as a control sequence and took it in as characters you typed. It now recognizes **any** control sequence by the standard structure and skips it whole, instead of enumerating them one by one, so sequences it has never seen will not leak in later either

> Content recorded before this version already has these coordinates mixed in, and they will not disappear automatically: they go away as the records expire (kept for one week). The timeline itself is accurate, and only the text part is affected.

## 0.4.13 — 2026-08-07

### New

- **Gantt view**. The fourth view: the horizontal axis is time, each row is a project, and each bar is one "what you said → the agent finished". The bar shows the first ten characters, hovering shows the full text and duration, and one click jumps back to that terminal. When several things run at the same time in a project, the bars stack up and down instead of overlapping
- **A navigation strip at the bottom** draws the density of activity over a whole week, and you drag the selection box on it to view a stretch. The span of the main area can be switched between 24 hours and 3 days. Positions with abnormal interruptions are red on the strip, easy to find at a glance
- **Dragging directly on the chart also pans**, with the box at the bottom following in real time, and conversely dragging the box moves the chart too
- The four views are gathered into one "Switch view" button, and clicking it opens a dropdown of four choices, since the original three-segment control had no room for a fourth

### Fixed

- **Opening a terminal from the Board showed a blank screen**. And it was intermittent: the first time after switching to the Board it was usually fine, and after that none would open, until you switched away and back to the Board. So it looked like "only certain terminals have a problem", but it had nothing to do with which terminal, and depended on which time you were opening one
- **After jumping back to the app from the Island, the whole window occasionally could not be clicked** (canvas zoom did nothing, the input box could not be clicked), and you had to go to "Show All Windows" and switch back to recover. The cause is at the system level: macOS does not honor "a background app switching itself to the foreground", so the app thought it was activated, but keyboard and mouse were actually still being fed to the previous app. It now hands the job of opening itself to the system. Measured on the same machine, the old approach succeeded 0 out of 10 times, and now it is 10 out of 10

## 0.4.12 — 2026-08-06

### New

- **With Bizone Canvas installed, you can generate images right in the terminal**. Tell the agent "draw a cover", and it will open a project, create nodes, pick a model, start generation, and wait for the result by itself, then place the image on the canvas for you to see, so you no longer have to switch over and click through it manually. If the canvas app is in "Applications" it is recognized automatically, with no configuration to fill in. But it must be open during generation (the tools connect to the running canvas)
- The canvas's other capabilities, such as video, background removal, upscaling, and outpainting, can also be requested directly in the terminal

### Fixed

- **When a module is maximized to fill the screen, the canvas toolbar and zoom bar at the bottom right no longer show through**. They were already covered underneath, but the module background is translucent glass, so that row of icons and the "100%" floated over the terminal input row, crowding in with Send and Voice. When it fills the screen the canvas is entirely covered, and zooming the canvas makes no sense anyway

## 0.4.11 — 2026-08-06

### Fixed

- **After jumping back to the app from the Island, the first click is no longer swallowed**. Before, reaching out to click a module after the jump, that click was used up by the system as "activate the window", making it look unclickable. Now whatever you see, you can click
- **After a module is maximized to fill the screen, it can scroll right away**, without needing another click to select it. The canvas is entirely covered by then, so the scroll wheel should belong to the module's content
- After opening a terminal from the Board, the control bar above (role / model / thinking level) now **matches the same terminal on the canvas**. Before, it could not read the configuration, always showed defaults, and changes were not saved
- When the Board is full screen, the bar at the top can now drag the window
- The rollback confirmation box popped up by "Launch" no longer goes past the right edge of the window
- The "In progress" float at the top left of the Board no longer slides away when scrolling horizontally

## 0.4.10 — 2026-08-06

### Improved

- **Memory use per terminal drops substantially**. The number of history lines a terminal keeps was reduced from 20,000 to 5,000. When one terminal is filled with long logs, usage goes from +68MB to +2MB. The difference is obvious when working for a long time with a dozen or twenty terminals open. You can still scroll back about 60 screens, and the agent's approval parsing is not affected

## 0.4.9 — 2026-08-06

### Improved

- **The canvas renders only the part you can see**. Before, terminals thousands of pixels outside the viewport were still being drawn, and with thirty terminals spread out, memory kept climbing as you panned (measured 536 → 668 MB). Now it stays steady at 378 MB
- **A web node that has been off-screen for two minutes is reclaimed along with its process**, and rebuilt automatically when you scroll back, returning to the page you last stayed on. Before, once a web node had been viewed even once, its process lived until you quit the app
- **Terminals can now be closed from the Board**: hovering over a terminal row on a card shows a ×, and the top bar has one too in full screen. Before, you had to switch back to Terminal or Canvas to close one

### Fixed

- **A terminal opened from the Board could not scroll its history**. The scroll wheel was intercepted by the canvas logic "scroll on a module = pan the board", and it was also quietly panning the canvas, so if you scrolled a few times on the Board and switched back to the canvas, you would find the view had drifted away entirely
- **The screen occasionally jumped up as a whole, with the top cut off**. To make some element visible, the browser scrolls whichever container it thinks can scroll, and those few layers of containers are not supposed to scroll at all by design. Now `overflow: clip` shuts this off at the root, instead of resetting it after the fact

## 0.4.8 — 2026-08-06

### New

- **Board mode**. A third view, alongside "Terminal" and "Canvas". Columns are split by status, with one card per project: how many terminals are open, what each is busy with, and which is waiting for you, all visible on one screen. Click a card to fill the screen and work, and press Esc or click "Board" to come back
- **You decide the Board's columns**: create, double-click to rename, and delete are all supported. Deleting a board does not delete the projects in it, and they return to "Uncategorized". One screen fits exactly four columns, and extra ones slide to the right
- **Dragging a card changes its status**, and the three views share the same data: the project's frame on the canvas changes color along with it, and in split view you can right-click a project to set the same label
- **Split view can also set project status labels now**. Before, the status was recorded on the canvas frame, so a project that had never entered the canvas had nowhere to be labeled

### Improved

- On the Board, the scroll wheel always scrolls the list unless you have really clicked into a terminal, so the pointer merely passing by will not accidentally scroll some terminal's history
- Cards that scroll out of view upward collapse into a stack at the top, and expand automatically when you scroll back

## 0.4.7 — 2026-08-05

### New

- **Cards and buttons glow with the mouse**. When the mouse gets near the border of a canvas node, that edge seeps a ring of light, and a white light sweeps diagonally across the primary button as you pass over it
- **The primary button now has depth**, and when pressed it really sinks in, with the lit face flipping over instead of the whole thing sliding down
- **The Claude / Codex switch on the terminal is now a star button on the left**. You can recognize which one is in use from the icon, and it no longer takes up the space of two text buttons. When a role pins the CLI, the button locks and tells you why, whereas before clicking it in that case did nothing at all
- **Role selection is now paged**: a row of dots at the top, a page of roles in the middle, left and right paging at the bottom, and you can click any dot to jump straight there. When opened it lands on the role you are currently using
- **A role's "disabled tools" no longer needs typing names by hand**. They are laid out grouped as "Edit files / Run commands / Read code / Web / Collaboration / MCP", one click disables a tool, and hovering over each shows a sentence on what it is for. Wildcards and the like can still be typed by hand, tucked under "Manual additions"

### Improved

- The vault layout is more relaxed, with more space between titles and body text, and variable names in two columns
- The colored dot in front of each item in the role list is now gray, and only the currently selected one lights up. Those colors looked like they meant a category, but in fact they did not

### Fixed

- **Clicking "Got it" on the Island no longer drags the whole app to the foreground**. When you are working in another app and click it in passing, Eas-Term stays quietly where it is, since you only wanted that notification to stop chiming and did not intend to switch over
- **Text in the role edit panel no longer piles together**. When the window was not tall enough, the "Responsibility contract" section would be squeezed to zero height, and its contents overflowed in place and pressed onto the two sections below
- Clicking two tools to disable in quick succession no longer loses one of them

## 0.4.6 — 2026-08-04

### Fixed

- **While you are working in the app, the Island no longer pops up by itself**. It is a very high-level window, and to display it macOS pulls you away from the current desktop, which when you are in full screen feels like "being forced to switch windows". A finished task still has its chime and the pending count in the title bar, and the Island appears only after you have switched away. To take a look on purpose, right-click the Dock icon
- **Links in the terminal no longer launch Safari**. The layer used to keep links inside the app had actually never taken effect (it was pushed out by the system's PATH reordering), so as soon as the agent opened a web page, the whole app was pushed to the background
- The tab bar no longer jumps along with the agent's spinner animation. That character changes every 100 milliseconds right next to the title bar, and it looked like a strip at the top flickering
- When you click Send (or ⌘↵) in the terminal input box, the content sometimes stayed in the agent's own input box and was not sent, and you had to press Enter again, especially noticeable with images. Now the text and the Enter are sent separately, with a short wait in between for the agent to react
- Multi-line content is no longer split into several sends, and the whole passage counts as one

## 0.4.5 — 2026-08-04

### New

- After box-selecting a group of modules on the canvas, the **Delete key** deletes them all at once. The delete key on the Mac keyboard is now recognized too (before it recognized only Fn+delete and did nothing when pressed)
- When the selection includes terminals, it asks once, "Some of these are running commands, and deleting will terminate them", and after you confirm, they are all deleted together, with no dialog for each

### Improved

- When a task finishes, the Island **announces it only in its collapsed form** and no longer spreads out a card that blocks the top of the screen. It expands automatically only when waiting for approval (since that needs your decision, and the card has options you can click directly)
- Clicking the collapsed bar does just one thing, "expand": you see which have finished and which are still running, and it does not clear the pending items along the way
- After expanding, clicking anywhere outside the Island makes it collapse by itself

## 0.4.4 — 2026-08-04

### New

- **Right-clicking** the Dock icon lets you see "who finished and who is still running" directly, and clicking an entry goes straight to that terminal, without opening the app or waiting for the Island to pop up

### Improved

- **When you are working in the app, the Island no longer pops up a card that blocks the top of the screen**: only a collapsed capsule remains, stating whether it is "Task complete" or "Approval needed", and you click it yourself to expand for details
- After expanding it is a list: which finished and which are still running, and clicking any entry jumps to that terminal
- "Got it" no longer treats a task as handled: it just stops reminding you, the pending marker stays, and it goes away only when you actually go to that terminal
- Voice input is inserted **at the cursor**, and no longer always appended at the very end

### Fixed

- On Windows, zooming the canvas with the mouse wheel dropped straight to 20% in a single notch (the zoom step was written for a macOS trackpad, and a Windows wheel notch spans ten times as much)

## 0.4.3 — 2026-08-03

### New

- When a new version is available, the title bar tells you. Click to see what changed in this version, and download the package for your chip and open it in one click
- The website has a new [Changelog](https://eas.biily.top/changelog.html) page, where what changed in each version is recorded
- **Added anonymous usage statistics, on by default, and can be turned off**: only usage time, launch count, version and OS category, and the usage count of each feature.
  Terminal content, commands, file paths, project names, conversations with the AI, and keys never leave your computer, not a single byte,
  and no identifier that could recognize you across days is generated. If you do not want it, turn it off under Settings → Privacy, and after that not a single request is sent.
  See [Section 4 of the Privacy Notice](https://eas.biily.top/privacy.html#usage) for details. This item is a change to the earlier statement that "no usage statistics are collected", so it is written out separately.

### Improved

- The current version number is shown in Settings, and you can check for updates manually

## 0.4.2 — 2026-08-03

### New

- The terminal gains a text input box: write long prompts first and then send, Chinese input methods no longer misalign, and pasting multiple lines is no longer run line by line as commands
- The input box supports pasting or dragging in images, and on ⌘↵ the image paths are sent to the agent together with the text
- Voice input results now land in the input box, so if you misspoke you can fix it before sending (before, it was written directly into the terminal)

### Improved

- Settings moved to the far right of the title bar, in the same position in both views, and the theme and notification sounds are gathered inside it
- The project highlight and file tree in the right drawer of the canvas now follow the project you are operating on (select a Frame or click into a terminal node)

### Fixed

- The voice button and input box overlapped in a heap at the bottom right
- When you were staring at a terminal and it finished without a sound: now you are reminded whether or not it is focused
- When the main window is in the foreground, the Island is no longer completely silent: a new notification appears for a few seconds, and ones awaiting approval stay
- A floating tooltip against the right edge of the window was squeezed into a vertical column of characters

## 0.4.1 — 2026-08-03

### New

- **Island**: after you minimize the app, a status capsule appears at the top of the screen showing how many projects are running.
  When a task finishes or needs approval, a notification pops up giving the project, elapsed time, model, and a summary of this round's Q&A, and one click jumps straight back to that session
- Interruptions that need approval can be handled directly on the Island, without switching back
- Notification sounds for pending items (a marimba timbre), with different sounds for task complete and awaiting approval, which can be turned off or adjusted in volume in Settings
- Canvas Frames support color status labels: blue in progress, yellow pending, red closed

### Improved

- The Windows package is back to being released together with the rest (before, it had to be uploaded manually)

## Earlier Versions

0.4.0 and earlier have no organized changelog. 0.3.x was mainly iterations on the canvas, Wiki, and vault.
