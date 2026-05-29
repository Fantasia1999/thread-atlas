const TIME_ONLY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium"
});

export function formatDisplayTime(value?: string, fallback = ""): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return value ?? fallback;
  }
  return TIME_ONLY_FORMATTER.format(timestamp);
}

export function formatDateTimeTitle(value?: string): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return value ?? "";
  }
  return DATE_TIME_FORMATTER.format(timestamp);
}

export function formatDateTime(value?: string, fallback = ""): string {
  const formatted = formatDateTimeTitle(value);
  return formatted || fallback;
}

export function formatLocalDateTime(value?: number, fallback = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return DATE_TIME_FORMATTER.format(value);
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.opacity = "0";

  document.body.append(textArea);
  textArea.select();
  textArea.setSelectionRange(0, value.length);

  const copied = document.execCommand("copy");
  textArea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function showToast(message: string, type: "success" | "error" = "success"): void {
  let container = document.querySelector(".toast-container") as HTMLDivElement | null;
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.append(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  const icon = type === "success" ? "✓" : "✗";
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  container.append(toast);

  // Trigger layout reflow
  toast.getBoundingClientRect();
  toast.classList.add("visible");

  setTimeout(() => {
    toast.classList.remove("visible");
    toast.classList.add("exiting");
    setTimeout(() => {
      toast.remove();
      if (container && container.children.length === 0) {
        container.remove();
      }
    }, 300);
  }, 2500);
}
