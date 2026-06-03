/** Print daily closing report in-place (no new tab). */
export function printClosingReport() {
  document.body.classList.add("closing-report-printing");
  window.print();
  const cleanup = () => {
    document.body.classList.remove("closing-report-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(cleanup, 3000);
}
