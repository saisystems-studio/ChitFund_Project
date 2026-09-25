// Turns a failed API request into the message the backend sent, falling back only when it sent none.
export default function apiErrorMessage(error, fallback) {
  const data = error?.response?.data;
  if (typeof data?.detail === "string") return data.detail;
  if (data && typeof data === "object") {
    const messages = Object.values(data).flat().filter(item => typeof item === "string");
    if (messages.length) return messages.join(" ");
  }
  if (!error?.response) return `${fallback} The server could not be reached.`;
  return `${fallback} (server error ${error.response.status})`;
}
