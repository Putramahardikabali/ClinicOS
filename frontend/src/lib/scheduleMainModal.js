/** Close utility drawer before opening a centered schedule modal. */
export function canCloseUtilityDrawer(closeGuardRef) {
  if (closeGuardRef?.current && closeGuardRef.current() === false) return false;
  return true;
}

export function clearUtilityDrawerState(setters) {
  setters.setActiveUtility(null);
  setters.setInvoiceDrawerInit?.(null);
  setters.setSessionsDrawerInit?.(null);
}
