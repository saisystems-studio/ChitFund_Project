// Existing PDF helpers create an iframe and return before its print dialog opens.
// Wait for that dialog to close before leaving an entry page.
// Browsers do not reliably fire `afterprint` for a PDF shown in an iframe, so
// completion also listens for the page regaining focus / the user interacting
// with the page once the (modal) dialog closes, plus a safety timeout, so a saved entry can never stay stuck in a busy state.
export const PRINT_SAFETY_TIMEOUT_MS = 60000;
const ACTIVITY_EVENTS = ["pointerdown", "mousemove", "keydown"];

export async function completeEntryOutput(output, action, frameClass, onComplete) {
  await output();
  if (action !== "print") { onComplete(); return; }
  const frame = document.querySelector(`iframe.${frameClass}`);
  if (!frame) throw new Error("The print preview could not be opened.");
  const host = typeof window !== "undefined" ? window : null;
  return new Promise((resolve, reject) => {
    let finished = false, timer = null, focusArmed = false;
    const cleanup = () => {
      clearTimeout(timer);
      host?.removeEventListener?.("focus", onHostFocus);
      host?.removeEventListener?.("afterprint", finish);
      ACTIVITY_EVENTS.forEach(name => host?.removeEventListener?.(name, onHostFocus, true));
    };
    function finish() { if (finished) return; finished = true; cleanup(); try { onComplete(); resolve(); } catch (error) { reject(error); } }
    function fail(error) { if (finished) return; finished = true; cleanup(); reject(error); }
    // The main window only regains focus after the print dialog (or its
    // Cancel) closes; ignore the focus events that fire while it opens.
    function onHostFocus() { if (focusArmed) setTimeout(finish, 300); }
    const watchHost = () => {
      host?.addEventListener?.("afterprint", finish, { once: true });
      host?.addEventListener?.("focus", onHostFocus);
      ACTIVITY_EVENTS.forEach(name => host?.addEventListener?.(name, onHostFocus, true));
      setTimeout(() => { focusArmed = true; }, 1000);
      timer = setTimeout(finish, PRINT_SAFETY_TIMEOUT_MS);
    };
    frame.onerror = () => fail(new Error("The print preview could not be loaded."));
    // Preserve the existing iframe print / new-tab fallback, with completion
    // tracking attached to whichever window actually shows the document.
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      try {
        frame.contentWindow.addEventListener("afterprint", finish, { once: true });
        frame.contentWindow.focus();
        watchHost();
        frame.contentWindow.print();
      } catch {
        const popup = host?.open?.(frame.src, "_blank");
        if (!popup) { fail(new Error("The print preview was blocked.")); return; }
        try { popup.addEventListener("afterprint", finish, { once: true }); } catch { /* PDF viewers can isolate their window. */ }
        const poll = setInterval(() => {
          if (popup.closed) finish();
          if (finished) clearInterval(poll);
        }, 500);
      }
    };
    frame.onload = start;
    // The frame may already have loaded before this handler was attached.
    try { if (frame.contentDocument?.readyState === "complete" && frame.contentDocument.URL !== "about:blank") start(); } catch { /* cross-origin viewer */ }
  });
}
