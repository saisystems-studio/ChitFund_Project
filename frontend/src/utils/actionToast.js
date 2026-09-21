export const actionToast = (message, success = true) => {
  const previous = document.querySelector(".global-action-toast");
  previous?.remove();
  const toast = document.createElement("div");
  toast.className = `global-action-toast ${success ? "success" : "error"}`;
  const text = String(message || (success ? "Operation completed." : "Operation failed."));
  const prefix = success ? "✅ " : "😔 ";
  toast.textContent = text.startsWith("✅") || text.startsWith("😔") || text.startsWith("😢") ? text : `${prefix}${text}`;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3500);
};
