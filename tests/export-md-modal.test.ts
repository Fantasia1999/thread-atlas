import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";

import type { Session } from "../src/parsers/types.ts";
import { createExportMdModal } from "../src/ui/exportMdModal.ts";

function getMockSession(): Session {
  return {
    id: "cd7d2767-7c09-4e74-8c2f-227efe147a35",
    source: "claude",
    title: "Test Session",
    summary: "A beautiful test session summary.",
    cwd: "/home/example-user/workspace/my-project",
    startedAt: "2026-06-01T10:00:00Z",
    updatedAt: "2026-06-01T10:05:00Z",
    primaryPath: "/home/example-user/.claude/projects/cd7d2767-7c09-4e74-8c2f-227efe147a35.jsonl",
    messageCount: 3,
    messages: [
      {
        id: "msg-1",
        role: "user",
        text: "Hello how are you"
      },
      {
        id: "msg-2",
        role: "assistant",
        text: "I am doing well",
        toolCalls: []
      },
      {
        id: "msg-3",
        role: "tool",
        text: "",
        toolCalls: [
          {
            id: "tc-1",
            toolName: "run_command",
            kind: "function",
            status: "completed",
            args: "{}",
            output: "success"
          }
        ]
      }
    ],
    metadata: {},
    rawFiles: []
  };
}

test("export md modal renders and defaults all messages checked", () => {
  const session = getMockSession();
  let closed = false;
  let exported = false;

  const overlay = createExportMdModal({
    session,
    onClose: () => { closed = true; },
    onExport: (filename, md) => { exported = true; }
  });

  const headerNode = overlay.querySelector(".modal-header");
  assert.ok(headerNode);
  assert.ok(headerNode.innerHTML.includes("Select messages to export"));

  // Renders filename preview containing workspace name and hashid/uuid
  const filenamePreview = overlay.querySelector(".export-filename-preview");
  assert.ok(filenamePreview);
  assert.ok(filenamePreview.textContent?.includes("my-project"));
  assert.ok(filenamePreview.textContent?.includes("cd7d2767-7c09-4e74-8c2f-227efe147a35"));

  // Renders three messages
  const items = overlay.querySelectorAll(".export-message-item");
  assert.equal(items.length, 3);

  // Checkboxes are checked by default
  const checkboxes = overlay.querySelectorAll(".export-message-checkbox") as any[];
  assert.equal(checkboxes.length, 3);
  assert.equal(checkboxes.every(cb => cb.checked), true);
});

test("export md modal filters work correctly", () => {
  const session = getMockSession();
  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: () => {}
  });

  // Renders 3 items initially (default filter)
  assert.equal(overlay.querySelectorAll(".export-message-item").length, 3);

  // Find user filter chip and click it
  const chips = overlay.querySelectorAll(".export-filter-chip") as any[];
  const userChip = chips.find(c => c.textContent?.trim() === "user");
  assert.ok(userChip);
  userChip.dispatchEvent("click");

  // Renders only 1 user message item
  const filteredItems = overlay.querySelectorAll(".export-message-item");
  assert.equal(filteredItems.length, 1);
  assert.ok(filteredItems[0].textContent?.includes("Hello how are you"));
});

test("export md modal accordion expands on click", () => {
  const session = getMockSession();
  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: () => {}
  });

  const firstItem = overlay.querySelector(".export-message-item");
  assert.ok(firstItem);
  assert.equal(firstItem.classList.contains("expanded"), false);

  const wrapper = firstItem.querySelector(".export-message-content-wrapper");
  assert.ok(wrapper);
  wrapper.dispatchEvent("click");

  assert.equal(firstItem.classList.contains("expanded"), true);
});

test("export md modal bulk actions select/deselect work", () => {
  const session = getMockSession();
  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: () => {}
  });

  const deselectAllBtn = overlay
    .querySelectorAll(".button")
    .find((node: any) => node.textContent.trim() === "Deselect All") as any;
  assert.ok(deselectAllBtn);
  deselectAllBtn.dispatchEvent("click");

  // Query checkboxes again after DOM re-render
  const checkboxesAfterDeselect = overlay.querySelectorAll(".export-message-checkbox") as any[];
  assert.equal(checkboxesAfterDeselect.every(cb => !cb.checked), true);

  const selectAllBtn = overlay
    .querySelectorAll(".button")
    .find((node: any) => node.textContent.trim() === "Select All") as any;
  assert.ok(selectAllBtn);
  selectAllBtn.dispatchEvent("click");

  // Query checkboxes again after DOM re-render
  const checkboxesAfterSelect = overlay.querySelectorAll(".export-message-checkbox") as any[];
  assert.equal(checkboxesAfterSelect.every(cb => cb.checked), true);
});

test("export md modal triggers export with generated filename and markdown", () => {
  const session = getMockSession();
  let exportedFilename = "";
  let exportedMd = "";

  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: (filename, md) => {
      exportedFilename = filename;
      exportedMd = md;
    }
  });

  const exportBtn = overlay
    .querySelectorAll(".button")
    .find((node: any) => node.textContent.trim() === "Export MD") as any;
  assert.ok(exportBtn);
  exportBtn.dispatchEvent("click");

  assert.ok(exportedFilename.includes("my-project"));
  assert.ok(exportedFilename.includes("cd7d2767-7c09-4e74-8c2f-227efe147a35"));
  assert.ok(exportedFilename.endsWith(".md"));

  assert.ok(exportedMd.includes("# Test Session"));
  assert.ok(exportedMd.includes("Hello how are you"));
  assert.ok(exportedMd.includes("run_command"));
});

test("export md modal does not export unchecked messages", () => {
  const session = getMockSession();
  let exportedMd = "";

  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: (filename, md) => {
      exportedMd = md;
    }
  });

  // Uncheck the first message (index 0)
  const checkboxes = overlay.querySelectorAll(".export-message-checkbox") as any[];
  checkboxes[0].checked = false;
  // Dispatch change event to trigger the listener
  checkboxes[0].dispatchEvent("change");

  const exportBtn = overlay
    .querySelectorAll(".button")
    .find((node: any) => node.textContent.trim() === "Export MD") as any;
  assert.ok(exportBtn);
  exportBtn.dispatchEvent("click");

  // Verify first message is NOT in the exported markdown, but second is
  assert.ok(!exportedMd.includes("Hello how are you"), "Should not include unchecked message text");
  assert.ok(exportedMd.includes("I am doing well"), "Should include checked message text");
});

test("export md modal under not-tool filter does not export tool calls", () => {
  const session = getMockSession();
  let exportedMd = "";

  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: (filename, md) => {
      exportedMd = md;
    }
  });

  // Switch filter to "not-tool"
  const chips = overlay.querySelectorAll(".export-filter-chip") as any[];
  const notToolChip = chips.find(c => c.textContent?.trim() === "not tool");
  assert.ok(notToolChip);
  notToolChip.dispatchEvent("click");

  const exportBtn = overlay
    .querySelectorAll(".button")
    .find((node: any) => node.textContent.trim() === "Export MD") as any;
  assert.ok(exportBtn);
  exportBtn.dispatchEvent("click");

  // Verify tool calls are NOT in the exported markdown
  assert.ok(!exportedMd.includes("run_command"), "Should not include tool calls under not-tool filter");
});

test("export md modal handles customized filename elements, order and persistence", () => {
  // Clear localStorage before testing
  localStorage.clear();

  const session = getMockSession();
  let exportedFilename = "";

  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: (filename) => {
      exportedFilename = filename;
    }
  });

  // Verify the config list is rendered with default elements
  const configList = overlay.querySelector(".filename-config-list");
  assert.ok(configList);
  
  const configItems = configList.querySelectorAll(".filename-config-item");
  assert.equal(configItems.length, 5);

  const getPreviewText = () => {
    const filenamePreview = overlay.querySelector(".export-filename-preview");
    return filenamePreview?.textContent || "";
  };

  const initialPreview = getPreviewText();
  assert.ok(initialPreview.includes("my-project_claude_Test_Session_cd7d2767-7c09-4e74-8c2f-227efe147a35_"));

  // Checkbox toggle: turn off workspace (the first item)
  const firstItemCheckbox = configItems[0].querySelector("input") as any;
  assert.ok(firstItemCheckbox);
  assert.equal(firstItemCheckbox.checked, true);
  firstItemCheckbox.checked = false;
  firstItemCheckbox.dispatchEvent("change");

  // Preview should no longer have workspace
  const updatedPreview = getPreviewText();
  assert.ok(!updatedPreview.startsWith("my-project"));
  assert.ok(updatedPreview.startsWith("claude_Test_Session"));

  // Reorder test: move agentname (now item index 1) to the top (index 0)
  // Let's reload overlay to read from localStorage first, confirming persistence of workspace state
  const overlay2 = createExportMdModal({
    session,
    onClose: () => {},
    onExport: (filename) => {
      exportedFilename = filename;
    }
  });
  
  const preview2 = overlay2.querySelector(".export-filename-preview")?.textContent || "";
  // Confirm persistence of disabled workspace from step before
  assert.ok(!preview2.startsWith("my-project"));
  assert.ok(preview2.startsWith("claude_Test_Session"));

  // Find the list in the second overlay
  const configList2 = overlay2.querySelector(".filename-config-list");
  const configItems2 = configList2!.querySelectorAll(".filename-config-item");

  // workspace (index 0) has 'enabled = false'. agentname (index 1) has 'enabled = true'.
  // Let's click the "↑" button on agentname (index 1) to swap it with workspace (index 0)
  const agentnameUpBtn = configItems2[1].querySelector(".filename-config-btn") as any; // First button is Up button
  assert.ok(agentnameUpBtn);
  assert.equal(agentnameUpBtn.textContent, "↑");
  agentnameUpBtn.dispatchEvent("click");

  // After reordering, agentname should be at index 0, workspace at index 1.
  // And the new order in localStorage should be saved.
  // Let's verify by re-enabling workspace. Since workspace is now index 1, when we enable it, it should append AFTER agentname (claude).
  // E.g. filename should be: "claude_my-project_Test_Session_..."
  const newConfigItems = overlay2.querySelectorAll(".filename-config-item");
  const workspaceCheckbox = newConfigItems[1].querySelector("input") as any;
  assert.ok(workspaceCheckbox);
  assert.equal(workspaceCheckbox.checked, false);
  workspaceCheckbox.checked = true;
  workspaceCheckbox.dispatchEvent("change");

  const preview3 = overlay2.querySelector(".export-filename-preview")?.textContent || "";
  assert.ok(preview3.startsWith("claude_my-project_Test_Session"));

  // Click Export MD and make sure exportedFilename matches preview3
  const exportBtn = overlay2
    .querySelectorAll(".button")
    .find((node: any) => node.textContent.trim() === "Export MD") as any;
  assert.ok(exportBtn);
  exportBtn.dispatchEvent("click");

  assert.equal(exportedFilename, preview3);
});

test("export md modal truncates long titles to 40 characters in filename", () => {
  const session = getMockSession();
  session.title = "This is an extremely long title that exceeds the limit of forty characters by a lot of letters";
  
  const overlay = createExportMdModal({
    session,
    onClose: () => {},
    onExport: () => {}
  });

  const filenamePreview = overlay.querySelector(".export-filename-preview");
  assert.ok(filenamePreview);
  const text = filenamePreview.textContent || "";
  
  // Cleaned title of 40 chars: "This is an extremely long title that exc"
  // Sanitized to: "This_is_an_extremely_long_title_that_exc"
  assert.ok(text.includes("This_is_an_extremely_long_title_that_exc"));
  assert.ok(!text.includes("exceeds_the_limit"));
});



