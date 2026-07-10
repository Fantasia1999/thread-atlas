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

const DATE_TIME_LONG_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long"
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

export function formatDateTimeLong(value?: string, fallback = ""): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return value ?? fallback;
  }
  return DATE_TIME_LONG_FORMATTER.format(timestamp);
}

export function formatLocalDateTime(value?: number, fallback = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return DATE_TIME_FORMATTER.format(value);
}

export function formatLocalDateTimeLong(value?: number, fallback = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return DATE_TIME_LONG_FORMATTER.format(value);
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
  toast.className = `toast toast-${type} ui-status status-${type}`;
  
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

export function ansiToHtml(text: string): string {
  const tokens = text.split(/([\u001b\x1b]\[[0-9;]*m)/);
  let html = "";
  
  let bold = false;
  let italic = false;
  let color: string | null = null;

  function getStyles(): string {
    const styles: string[] = [];
    if (bold) styles.push("font-weight: bold;");
    if (italic) styles.push("font-style: italic;");
    if (color) styles.push(`color: ${color};`);
    return styles.length > 0 ? ` style="${styles.join(' ')}"` : "";
  }

  for (const token of tokens) {
    if (token.startsWith('\u001b[') || token.startsWith('\x1b[')) {
      const code = token.slice(2, -1);
      
      if (code === '0') {
        if (bold || italic || color) {
          html += "</span>";
          bold = false;
          italic = false;
          color = null;
        }
      } else if (code === '1') {
        if (bold || italic || color) html += "</span>";
        bold = true;
        html += `<span${getStyles()}>`;
      } else if (code === '22') {
        if (bold || italic || color) html += "</span>";
        bold = false;
        if (italic || color) {
          html += `<span${getStyles()}>`;
        }
      } else if (code === '3') {
        if (bold || italic || color) html += "</span>";
        italic = true;
        html += `<span${getStyles()}>`;
      } else if (code === '23') {
        if (bold || italic || color) html += "</span>";
        italic = false;
        if (bold || color) {
          html += `<span${getStyles()}>`;
        }
      } else if (code === '39') {
        if (bold || italic || color) html += "</span>";
        color = null;
        if (bold || italic) {
          html += `<span${getStyles()}>`;
        }
      } else if (code.startsWith('38;5;')) {
        if (bold || italic || color) html += "</span>";
        const colorNum = parseInt(code.split(';')[2], 10);
        color = convert256Color(colorNum);
        html += `<span${getStyles()}>`;
      }
    } else {
      html += escapeHtml(token);
    }
  }

  if (bold || italic || color) {
    html += "</span>";
  }

  return html;
}

function convert256Color(num: number): string | null {
  const standardColors = [
    "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
    "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"
  ];
  if (num < 16) return standardColors[num];

  if (num >= 16 && num <= 231) {
    const index = num - 16;
    const r = Math.floor(index / 36) * 51;
    const g = (Math.floor(index / 6) % 6) * 51;
    const b = (index % 6) * 51;
    return `rgb(${r},${g},${b})`;
  }

  if (num >= 232 && num <= 255) {
    const grayscaleValue = 8 + (num - 232) * 10;
    return `rgb(${grayscaleValue},${grayscaleValue},${grayscaleValue})`;
  }

  return null;
}
