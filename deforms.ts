// The hub tables that have a deformed shape. See "How a table adds its
// deformed shape" in the README. The dev server, the rail and the viewer read
// this list, so a new table needs no change there.
import { BRACE_DEFORM } from './deform-braces.ts';
import { COLUMN_DEFORM, HSS_COLUMN_DEFORM } from './deform-column.ts';
import { CONNECTION_DEFORM } from './deform-connection.ts';
import { LINK_DEFORM } from './deform-links.ts';
import { deformParts, type DeformState, type DeformTable, type Protocol } from './deform.ts';
import type { Result } from './generate.ts';
import { renderHLR } from './hlr.ts';
import type { HubRecord } from './hub.ts';
import type { Specimen } from './specimen.ts';
import type { Part, RenderOpts } from './steel.ts';

export const DEFORMS: Record<string, DeformTable> = {
  connections: CONNECTION_DEFORM,
  braces: BRACE_DEFORM,
  columns: COLUMN_DEFORM,
  hss_columns: HSS_COLUMN_DEFORM,
  eccentric_braced_frames: LINK_DEFORM,
};

// The shape of a test at one step, from 0 as the slider of the playground. A
// step past the end gives the last one. The scale is the auto scale of the
// table by default. The playground (app/response.ts), cli.ts and shot.ts all
// call it, so they show the same shape.
export function shapeAt(table: string, r: Result, spec: Specimen, record: HubRecord, p: Protocol, step: number, scale = DEFORMS[table].autoScale(p)): DeformState {
  return DEFORMS[table].shape(r, spec, record, p.at(Math.min(step, p.n - 1)), scale);
}

// One deformed frame as SVG, with the exact renderer. "Copy SVG at this step"
// in the playground and `node cli.ts --step` both draw it here.
export const shapeSvg = (parts: Part[], state: DeformState, o: RenderOpts) => renderHLR(deformParts(parts, state), o);
