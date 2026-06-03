/** Print POS-issued gift card certificates (hidden print area). */
export function printPosGiftCards() {
  document.body.classList.add("gift-card-printing");
  const cleanup = () => {
    document.body.classList.remove("gift-card-printing");
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(cleanup, 1000);
  window.print();
}
