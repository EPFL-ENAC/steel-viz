// The hub tables that have a deformed shape. See "How a table adds its
// deformed shape" in the README. The dev server, the rail and the viewer read
// this list, so a new table needs no change there.
import { BRACE_DEFORM } from './deform-braces.ts';
import { COLUMN_DEFORM, HSS_COLUMN_DEFORM } from './deform-column.ts';
import { CONNECTION_DEFORM } from './deform-connection.ts';
import type { DeformTable } from './deform.ts';

export const DEFORMS: Record<string, DeformTable> = {
  connections: CONNECTION_DEFORM,
  braces: BRACE_DEFORM,
  columns: COLUMN_DEFORM,
  hss_columns: HSS_COLUMN_DEFORM,
};
