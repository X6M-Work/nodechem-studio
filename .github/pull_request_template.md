# Pull request

## What this changes

<!-- One paragraph. What was wrong, and what the change does about it. -->

## Why

<!-- The constraint or user problem that makes this the right fix, not just a fix. -->

## Verification

<!-- What you ran, and the output. "Tests pass" is not enough for the parser, gate evaluator,
     input builder or anything that writes to disk: quote the failing case you exercised. -->

- [ ] `npm test`
- [ ] `npm run check`
- [ ] `npm run build`

## Invariants

- [ ] No network calls added (local execution only)
- [ ] No Gaussian or xTB binaries, licence files or data bundled
- [ ] Dry run still writes a labelled `FIXTURE OUTPUT` and is never presented as a calculation
- [ ] Missing or unjudgeable values still report `unknown`, never `pass`
- [ ] Renderer still reaches the main process only through the preload bridge
- [ ] Engine processes still spawned with an argument array, `shell: false`

## Documentation

- [ ] User-facing behaviour is documented in `docs/guide/` (or the change needs none)
- [ ] `test/docs.test.js` is green (links, index coverage, version chips, no-network scan)

## Honesty check

- [ ] Anything I could not verify in this environment is stated in the description, not implied
