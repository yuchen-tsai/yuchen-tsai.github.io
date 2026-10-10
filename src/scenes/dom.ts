/** True when a pointer event landed on something that has its own click behavior. */
export const isInteractive = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('a, button, input, textarea, select, label, summary');
