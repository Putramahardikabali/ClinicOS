/** Print gift card certificate — same pattern as POS receipt print. */
export function printGiftCard() {
  document.body.classList.add("gift-card-printing");
  const cleanup = () => {
    document.body.classList.remove("gift-card-printing");
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(cleanup, 1000);
  window.print();
}
