import { createPortal } from "react-dom";

/**
 * Render booking modals inside the schedule shell when browser fullscreen is active,
 * otherwise portal to document.body (default behavior).
 */
export function BookingModalPortal({ active, fullscreen, portalRef, children }) {
  if (!active || !children) return null;
  const container =
    fullscreen && portalRef?.current && portalRef.current.isConnected
      ? portalRef.current
      : document.body;
  return createPortal(children, container);
}
