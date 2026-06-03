/** Same-page POS receipt print — toggles body class so only receipt content prints. */
export function printPosReceipt() {
  document.body.classList.add("pos-receipt-printing");
  const cleanup = () => {
    document.body.classList.remove("pos-receipt-printing");
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  // Fallback if afterprint is not fired (some browsers)
  setTimeout(cleanup, 1000);
  window.print();
}
