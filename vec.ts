// Small 3D vector helpers. Units are mm everywhere.
export type V = [number, number, number];

export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V): number => Math.sqrt(dot(a, a));
export const norm = (a: V): V => {
  const n = len(a);
  return n ? mul(a, 1 / n) : a;
};
// sum of several vectors
export const sum = (...vs: V[]): V => vs.reduce((s, v) => add(s, v), [0, 0, 0] as V);
