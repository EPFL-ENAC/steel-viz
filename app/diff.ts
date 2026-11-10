// What differs between the base structure (a) and the one of this branch (b),
// for "Compare with main". One match for the box at the bottom right and for
// the one view mode: the parts by id, then their faces and bolts.
// No Vue and no Vite here, so node --test can load it.
import type { Result } from '../generate.ts';
import type { Part } from '../steel.ts';
import type { Mark } from '../webgl.ts';

export type Diff = { added: string[]; gone: string[]; changed: string[]; notes: string[] };

const shape = (p: Part) => JSON.stringify([p.faces, p.dots]);

export function diffParts(a: Result, b: Result): Diff {
  const was = new Map(a.parts.map((p) => [p.id, p]));
  const now = new Map(b.parts.map((p) => [p.id, p]));
  const added = b.parts.filter((p) => !was.has(p.id)).map((p) => p.id);
  const gone = a.parts.filter((p) => !now.has(p.id)).map((p) => p.id);
  const changed = b.parts.filter((p) => was.has(p.id) && shape(was.get(p.id)!) !== shape(p)).map((p) => p.id);
  const notes = [];
  if (a.st.col.id !== b.st.col.id) notes.push(`column ${a.st.col.id} → ${b.st.col.id}`);
  if (a.ok !== b.ok) notes.push(b.ok ? 'now stable' : 'now a mechanism');
  return { added, gone, changed, notes };
}

// the id of a base part in the one view: it can't take the id of the part of
// this branch, the viewer finds the parts (pick, joints, moves) by id
export const WAS = 'was:';

// Both structures in one list for the 3D view: all the parts of this branch,
// then the base parts that are gone or changed, renamed WAS + id. A changed
// part is in the list twice: its new shape marked 'new', its old one 'gone'.
// For the tooltip: was, the base part of each renamed id; base, the base
// structure; how, a word on each marked part.
export type Overlay = { parts: Part[]; marks: Record<string, Mark>; was: Map<string, Part>; base: Result; how: Record<string, string> };

export function overlayParts(a: Result, b: Result, d: Diff): Overlay {
  const marks: Record<string, Mark> = {};
  const how: Record<string, string> = {};
  const changed = new Set(d.changed);
  for (const id of [...d.added, ...d.changed]) {
    marks[id] = 'new';
    how[id] = changed.has(id) ? 'changed, its new shape' : 'new';
  }
  const old = new Set([...d.gone, ...d.changed]);
  const was = new Map<string, Part>();
  const copies = a.parts.filter((p) => old.has(p.id)).map((p): Part => {
    const id = WAS + p.id;
    marks[id] = 'gone';
    how[id] = changed.has(p.id) ? 'changed, its old shape' : 'gone';
    was.set(id, p);
    return { ...p, id, supports: (p.supports ?? []).map((s) => WAS + s), joint: p.joint && { ...p.joint, of: WAS + p.joint.of } };
  });
  return { parts: [...b.parts, ...copies], marks, was, base: a, how };
}
