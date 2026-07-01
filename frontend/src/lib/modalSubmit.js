import { toast } from "sonner";

/**
 * Standard modal success: toast, optional data callback, then close.
 * Errors should keep the modal open and not call this.
 */
export function finishModalSuccess({
  message,
  onSuccess,
  onClose,
  result,
} = {}) {
  if (message) toast.success(message);
  onSuccess?.(result);
  onClose?.();
}

/**
 * Guard async modal submit: skip if already busy, run action, finish on success.
 * @returns {Promise<boolean>} true when action succeeded
 */
export async function runModalSubmit({
  busy,
  setBusy,
  action,
  onSuccess,
  onClose,
  successMessage,
  onError,
}) {
  if (busy) return false;
  setBusy(true);
  try {
    const result = await action();
    finishModalSuccess({
      message: successMessage,
      onSuccess: () => onSuccess?.(result),
      onClose,
      result,
    });
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  } finally {
    setBusy(false);
  }
}
