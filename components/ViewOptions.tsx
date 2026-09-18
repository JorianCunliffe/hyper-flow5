import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
/** Page-specific controls share the second navigation bar; standalone previews render inline. */
export function ViewOptions({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById("hf-extra-options"));
  }, []);
  return target ? createPortal(children, target) : <div>{children}</div>;
}
