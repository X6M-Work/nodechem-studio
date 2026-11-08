# Working agreement — NodeChem Studio

This project is developed by Xavier (product owner), the Hermes instance on the AI stack
(review/architecture), and the Hermes instance on Will's Windows machine (local build and test).
Will is the licensed Gaussian user and the person who can validate real runs.

The rule is simple: **one task, one branch, one reviewable change, real evidence.**

## 1. Roles

| Role | Owns | Does not do |
| --- | --- | --- |
| Xavier | product direction, licence decisions, final merge | run Gaussian without the owner's permission |
| Host Hermes (`aistack`) | architecture, shared domain layer, review, release bundles | edit Will's machine or run his licensed jobs |
| Will's Hermes (`will`) | Windows runner, UI iteration, local verification, screenshots | change licence terms, copy Gaussian, expose keys |
| Will | licensed Gaussian operator, acceptance of real runs | — |

## 2. Source of truth

- `docs/IMPLEMENTATION_PLAN.md` — phases, task queue, acceptance criteria.
- `AGENTS.md` — hard rules for every coding agent.
- `README.md` — how to run the app.
- `HANDOFF.md` — first-day setup on Will's machine.

If a task needs a rule change, change the document in the same PR and call it out. Do not
invent a parallel plan in chat.

## 3. Branch and PR protocol

1. Start from the latest `main`.
2. Use `gn/<task-id>-<short-slug>`, for example `gn/gn-002-project-schema`.
3. One task per branch. Do not mix a schema change with a UI redesign.
4. Commit in small, logical steps. Do not commit `node_modules/`, `dist/`, run folders, logs,
   licence files, or secrets.
5. Open a PR with:
   - the task ID and a one-paragraph goal;
   - files changed;
   - test commands and exact results;
   - screenshots for UI changes;
   - known limitations / follow-ups.
6. CI is not assumed. The author runs `npm test`, `npm run check`, and `npm run build` and pastes
   the result. A reviewer repeats at least `npm test`.
7. Merge only after the host Hermes (or Xavier) reviews. Squash merge. Delete the branch.

If GitHub is unavailable on Will's machine, produce a git bundle or a patch series and send it
through the exchange; the host applies it to a branch and reviews there. Never send a ZIP of
`node_modules`.

## 4. Work packet format

Every hand-off task should be copy-pasteable and contain:

```text
TASK: GN-00X — short title
GOAL: what the user can do after this
CONTEXT: files, current behaviour, known constraints
ACCEPTANCE:
  - observable behaviour
  - test command and expected result
  - screenshot or run-folder evidence for UI/runner work
CONSTRAINTS:
  - no new dependencies (or list the approved one)
  - no remote calls, no telemetry
  - dry run remains the default
  - no Gaussian binaries or licence files
REPORT BACK:
  - branch / commit
  - test output
  - files changed
  - open questions
```

A packet without acceptance evidence is not complete.

## 5. Verification contract

Evidence must be produced by the person claiming the result:

- `npm test` — paste the summary, not “tests pass”.
- `npm run check` — exit code.
- `npm run build` — output size and exit code.
- Dry run — a screenshot of the run console with `completed` and gates.
- Real run — the run folder path, `run.json` status, parsed termination, and the gate list.
  Do not paste proprietary output beyond what is needed for verification.
- UI — screenshot at 1440×900 and 390×844 if the change touches responsive layout.

Self-reports are not evidence. A successful `spawn` is not evidence that Gaussian succeeded;
the parser and gates are the authority.

## 6. Exchange and peer network

Two paths exist:

1. **Peer DM** (preferred once keys are exchanged): `will` at `http://192.168.0.16:8642`.
   The peer is registered on the host without a key. Xavier or Will must place the matching
   `API_SERVER_KEY` out of band:
   - On Will's Hermes: read `API_SERVER_KEY` from its `.env` (never paste it into chat or a
     bundle).
   - On the host: `hermes peer add will --url http://192.168.0.16:8642 --key <key>` or set
     `HERMES_PEER_WILL_KEY` in the host `.env`.
   - Verify with `hermes peer list` (must show `[key set]`) and a small `hermes peer dm will`.
2. **Shared folder / bundle**: place the tarball or patch in the agent exchange share. Do not
   put secrets, licence files, genotypes, medical data, or credentials there.

Bundles are versioned: `nodechem-studio-v0.2.0.tar.gz` plus `.sha256`. Verify the checksum
before unpacking. The bundle excludes `node_modules`, `dist`, `.git`, run folders, and logs.

## 7. Environment rules for Will's machine

- Windows 10/11, Node 22+ installed by the user.
- Work in `C:\Users\<user>\Projects\nodechem-studio` (avoid a path with spaces in the
  Gaussian scratch directory).
- `npm install` is allowed in this project (it is a normal dependency install; the Gaussian
  install is separate and must not be copied).
- Do not change system-wide environment variables. The runner sets `GAUSS_EXEDIR` and
  `GAUSS_SCRDIR` per child process.
- Do not run a real Gaussian job while another licensed user is using the machine without
  permission. One job at a time is the default for a reason.
- Stop on any sign of licence violation. Report it; do not work around it.

## 8. Communication cadence

- Post a short status when a task moves to review: branch, test result, screenshot/run folder.
- Ask for a decision only when it changes the implementation (licence, chemistry semantics,
  packaging). Otherwise choose the smallest reversible option and note it.
- Keep chat concise. Put durable decisions in the plan or an ADR under `docs/`.
- Do not notify remote agents unless Xavier asks. The peer is a tool, not a broadcast channel.

## 9. Merge checklist

- [ ] Task ID and goal match the PR.
- [ ] No secrets, licence files, Gaussian binaries, or generated run data.
- [ ] `npm test`, `npm run check`, `npm run build` green.
- [ ] New behaviour has a test or a documented manual check.
- [ ] Dry run still works and remains the default.
- [ ] Parser/gates still treat unknown as unknown, never pass.
- [ ] README/plan updated if the boundary moved.
- [ ] Reviewer has repeated the key verification.
