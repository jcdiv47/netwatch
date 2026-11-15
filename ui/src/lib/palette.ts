// Identity colors for the devices in the Sankey. These are slots 3, 4, 5, 7 and 8 of the dataviz categorical
// palette, in their fixed order (validated as a set against --surface in both
// themes). Slot 6, a pure green, is left out: green already means "open".
// Slots 1–2, blue and orange, mean download and upload everywhere in the app,
// so no device may wear them. Routes use shades and texture instead
// (see RouteSplit).
export const CATEGORICAL = [
  { light: "#1baf7a", dark: "#199e70" },
  { light: "#eda100", dark: "#c98500" },
  { light: "#e87ba4", dark: "#d55181" },
  { light: "#6250d6", dark: "#9085e9" },
  { light: "#e34948", dark: "#e66767" },
] as const;
