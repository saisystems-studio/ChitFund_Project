// Existing PDF helpers create an iframe and return before its print dialog opens.
// Wait for that dialog to close before leaving an entry page.
export async function completeEntryOutput(output, action, frameClass, onComplete) {
  await output();
  if (action !== "print") { onComplete(); return; }
  const frame = document.querySelector(`iframe.${frameClass}`);
  if (!frame) throw new Error("The print preview could not be opened.");
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; onComplete(); resolve(); } };
    frame.onerror = () => reject(new Error("The print preview could not be loaded."));
    // Preserve the existing iframe print / new-tab fallback, with completion
    // tracking attached to whichever window actually shows the document.
    frame.onload = () => {
      try {
        frame.contentWindow.addEventListener("afterprint", finish, { once: true });
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        const popup = window.open(frame.src, "_blank");
        if (!popup) { reject(new Error("The print preview was blocked.")); return; }
        try { popup.addEventListener("afterprint", finish, { once: true }); } catch { /* PDF viewers can isolate their window. */ }
        const timer = setInterval(() => {
          if (popup.closed) finish();
          if (finished) clearInterval(timer);
        }, 500);
      }
    };
  });
}
