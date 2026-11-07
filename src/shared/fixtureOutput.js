/**
 * Synthetic output for the no-Gaussian "dry run" path.
 * It is explicitly labelled FIXTURE and must never be presented as a real result.
 */

export function makeFixtureOutput({ imaginary = 0, multiplicity = 1 } = {}) {
  // The fixture mirrors the requested multiplicity so a dry run of an
  // open-shell job does not look like a closed-shell one to the validity
  // checks. It is still labelled synthetic; no calculation is implied.
  const method = Number(multiplicity) > 1 ? 'UB3LYP' : 'RB3LYP';
  const modes = imaginary > 0
    ? [-420.0, 610.0, 1580.0, 3650.0, 3760.0]
    : [610.0, 1580.0, 3650.0, 3760.0];
  const modeLine = modes.map((value) => value.toFixed(4).padStart(12)).join('');
  return [
    ' FIXTURE OUTPUT — synthetic, not a Gaussian calculation',
    ' This file exists only to exercise the runner and parser.',
    '',
    ' Entering Gaussian System, Link 0=g16',
    '',
    ' #P B3LYP/6-31G(d) Opt Freq',
    '',
    ' Synthetic water fixture',
    '',
    ' 0 1',
    ' O   0.000000    0.000000    0.117300',
    ' H   0.000000    0.757200   -0.469200',
    ' H   0.000000   -0.757200   -0.469200',
    '',
    ` SCF Done:  E(${method}) =  -76.000000000     A.U. after    8 cycles`,
    ' Optimization completed.',
    ' Stationary point found.',
    '',
    ' Harmonic frequencies (cm**-1), IR intensities',
    ` Frequencies --${modeLine}`,
    ' Red. masses --',
    '',
    ' Sum of electronic and thermal Free Energies=        -76.020000',
    '',
    ' Normal termination of Gaussian 16 at Fri Nov  7 12:00:00 2026.',
    '',
  ].join('\n');
}
