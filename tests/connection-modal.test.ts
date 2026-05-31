import test from "node:test";
import assert from "node:assert/strict";

import "./dom-mock.ts";

const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, value: string) => {
    store[key] = String(value);
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  },
  key: () => null,
  length: 0
};

const { ConnectionManager } = await import("../src/store/connection.ts");
const { createConnectionModal } = await import("../src/ui/connectionModal.ts");

function freshManager() {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  return new ConnectionManager();
}

function findByText(overlay: any, selector: string, text: string): any {
  return overlay
    .querySelectorAll(selector)
    .find((node: any) => node.textContent.trim() === text);
}

test("connection modal renders saved connection rows", () => {
  const manager = freshManager();
  manager.upsertProfile({
    id: "p1",
    label: "bob@box",
    host: "box",
    port: 22,
    username: "bob",
    password: "",
    privateKey: "",
    passphrase: ""
  });

  const overlay = createConnectionModal({
    connection: manager,
    onClose: () => {},
    onChanged: () => {}
  });

  const savedRows = overlay.querySelectorAll(".connection-saved");
  assert.equal(savedRows.length, 1);
  assert.ok(savedRows[0].textContent.includes("bob@box"));
  assert.ok(findByText(overlay, ".button", "Connect"));
});

test("deleting a saved connection removes it from storage and the list", () => {
  const manager = freshManager();
  manager.upsertProfile({
    id: "p1",
    label: "bob@box",
    host: "box",
    port: 22,
    username: "bob",
    password: "",
    privateKey: "",
    passphrase: ""
  });

  const overlay = createConnectionModal({
    connection: manager,
    onClose: () => {},
    onChanged: () => {}
  });

  const deleteButton = findByText(overlay, ".button", "Delete");
  assert.ok(deleteButton);
  deleteButton.dispatchEvent("click");

  assert.equal(manager.getProfiles().length, 0);
  assert.equal(overlay.querySelectorAll(".connection-saved").length, 0);
});

test("submitting with missing fields shows a colour-coded error", () => {
  const manager = freshManager();
  const overlay = createConnectionModal({
    connection: manager,
    onClose: () => {},
    onChanged: () => {}
  });

  const saveButton = findByText(overlay, ".button", "Save");
  assert.ok(saveButton);
  saveButton.dispatchEvent("click");

  const errorFeedback = overlay
    .querySelectorAll(".connection-feedback")
    .find((node: any) => node.className.split(" ").includes("error"));
  assert.ok(errorFeedback, "expected an error-classed feedback element");
  assert.ok(errorFeedback.textContent.includes("required"));
});
