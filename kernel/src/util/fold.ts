// Folds a name the way a case-insensitive filesystem compares names, so a guard on a protected name cannot be
// sidestepped by spelling it differently. The default macOS filesystem folds Unicode case, so `.AOS` and
// `.aoſ` (with U+017F, long s) open `.aos`. Default-ignorable code points are dropped because HFS+ ignores
// some of them in names. NFKC goes further than any filesystem does; for a guard, over-matching is the safe
// side. The result is only for comparing, never for opening a path.
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

export function foldName(name: string): string {
  // Upper then lower case is full case folding for practical purposes: ſ becomes S then s, and K (Kelvin) k.
  return name.normalize("NFKC").replace(IGNORABLE, "").toUpperCase().toLowerCase();
}
