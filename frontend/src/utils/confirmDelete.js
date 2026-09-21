export default function confirmDelete(message = "Are you sure you want to delete the record?") {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "delete-confirm-backdrop";
    backdrop.innerHTML = `<section class="delete-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title"><h2 id="delete-confirm-title">Delete Record</h2><p>${message}</p><div class="delete-confirm-actions"><button type="button" data-delete-no>No</button><button type="button" class="delete-confirm-yes" data-delete-yes>Yes</button></div></section>`;
    document.body.appendChild(backdrop);
    const yes = backdrop.querySelector("[data-delete-yes]");
    const finish = value => { document.removeEventListener("keydown", onKeyDown, true); backdrop.remove(); resolve(value); };
    const onKeyDown = event => { if (event.key === "Enter") { event.preventDefault(); finish(true); } else if (event.key === "Escape") finish(false); };
    backdrop.querySelector("[data-delete-no]").onclick = () => finish(false);
    yes.onclick = () => finish(true);
    backdrop.onclick = event => { if (event.target === backdrop) finish(false); };
    document.addEventListener("keydown", onKeyDown, true);
    yes.focus();
  });
}
