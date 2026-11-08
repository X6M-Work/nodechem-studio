# Privacy and licensing

## Privacy: nothing leaves the machine

NodeChem Studio has no network capability. There is no telemetry, no crash reporting, no update
check, no account and no cloud call. The source contains no HTTP client and the automated test suite
fails if one is introduced.

What exists on disk:

| Data | Where | Who can read it |
| --- | --- | --- |
| Project (`.ncs`) | Wherever you saved it | You, and anyone you share the file with |
| Run records | `<userData>/runs/<runId>/` | You |
| Queue state | `<userData>/queues/<queueId>/` | You |
| Preferences (executable path, layout) | Electron `userData` local storage | You |

Run records contain the exact input, the raw output and the parsed result — which means a run record
can contain your chemistry, including structures you would rather not publish. Treat a run folder
like a dataset, not like a log file.

Sharing is explicit: you zip a run folder or export a bundle. Nothing is shared automatically.

## What the app does not protect you from

- **Licence compliance.** The app runs whichever Gaussian executable you point it at. Whether you are
  entitled to run it on that machine, under that licence, is your responsibility and the licence
  holder's.
- **Shared machines.** Run records are readable by anyone with access to your user profile. The app
  does not encrypt them.
- **A project file from someone else.** A `.ncs` file is data, and it cannot execute code: conditions
  use a tiny expression grammar with no `eval`, no property access and no function calls beyond
  `abs()`; input and output names are validated before any path join. But a project can still point
  at a route and geometry you did not intend to run. Read it before you run it.
- **The engine's own behaviour.** Scratch files, checkpoint files and Gaussian's licence server
  access are outside the app's control.

## How the app is put together (security posture)

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The renderer reaches the main process only through a small `contextBridge` API — open/save project,
  pick files, run, queue, export.
- Engine processes are spawned with an argument vector and `shell: false`. No shell string is ever
  assembled from project data.
- Project validation happens in the main process before anything renders.
- Queue, checkpoint and bundle file names are validated against explicit patterns before any path is
  joined, so a project cannot write outside its own folders.

## Licensing

**NodeChem Studio — Apache License 2.0.** See [`LICENSE`](../../LICENSE). That licence covers this
repository's own code and documentation. It does not grant any right to Gaussian.

**Gaussian 16 — licensed separately by Gaussian, Inc.** Commercial software, licensed per site and
per platform. What this repository does *not* do:

- it does not include, bundle, download or install Gaussian binaries or licence files;
- it does not grant a Gaussian licence, or any right to use Gaussian;
- it does not circumvent licensing: it starts the console executable that a licensed installation
  provides.

Gaussian licences are platform-bound. A Windows licence does not authorise a Linux binary, and a
Windows licence may not be used under WSL. Do not copy an installation to another computer or move
it to an operating system it is not licensed for. Confirm with the licence holder whether other users
or remote access are permitted before using this app on a shared machine.

**xTB — LGPL, open source.** Not bundled either; you install it yourself from its own distribution.
If you redistribute a build of this app, xTB is still not included.

**Third-party components.** The packaged app bundles Electron and Chromium, which keep their own
licences. This repository does not relicense them.

**Your results.** Nothing in this project's licence restricts what you do with data you produce with
your own licensed software. Publishing a result computed with Gaussian is governed by your Gaussian
licence, not by this one.

## Safety of the chemistry claims

The app is a driver and a bookkeeper, not an authority. Gates tell you whether a job ran and whether
the output contains the records you asked for. Validity checks flag conditions that commonly
invalidate a result. Neither replaces reading the output, and neither certifies a level of theory as
appropriate for your chemistry.

Where the app cannot judge something, it says so — `unknown`, `not reported`, or `needs-review`.
Those words are deliberate and should be read as "no evidence", never as "probably fine".

## Next

[Back to the documentation index](README.md)
