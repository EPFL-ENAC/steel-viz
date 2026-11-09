// The haunch of a beam-to-column test: a wedge welded under the bottom flange,
// at the column face, so the beam hinge forms past it and not at the weld.
// steel.ts draws it (weldedHaunch), deform-connection.ts puts the beam hinge
// zone at its tip.
//
// The hub calls these tests KBB (Kaiser bracket), but the data speaks of a
// haunch. Only these rows have d_h ("shift of the beam effective depth due to
// presence of hanches"), their comments say "hanch", and db_plus = d_b + d_h on
// the tests with no slab. The data gives no outline. So we take a generic
// shape: d_h deep at the column face, s_h long (the distance from the column
// face to the plastic hinge), web and flange thick and wide as the beam.
//
// No Node API here: hub.ts uses it, and index.ts exports hub.ts.
import type { Haunch } from './steel.ts';

export const HAUNCH_NOTE = 'KBB: the row says KBB, but its data (d_h, comments) speaks of a haunch, so a haunch is drawn. The data has no outline: we take d_h deep at the column face, s_h long, web and flange thick and wide as the beam, triangular unless the comments say straight';

// dh: d_h, sh: s_h, comments: the free text of the record
export const hubHaunch = (dh: number, sh: number, comments: string): Haunch => ({ depth: dh, length: sh, straight: /straight/i.test(comments) });
