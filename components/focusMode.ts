/**
 * Focus mode for AI assistants: while any assistant is open the app root recedes
 * (scaled slightly; ::backdrop on the dialog blurs and dims it). Reference-counted
 * so nested or overlapping assistants release it cleanly.
 */
let depth = 0;
export function enterFocusMode(): () => void {
  depth += 1;
  document.documentElement.classList.add("hf-focus-mode");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (!depth) document.documentElement.classList.remove("hf-focus-mode");
  };
}
