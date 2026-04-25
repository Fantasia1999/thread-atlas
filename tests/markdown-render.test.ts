import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../src/ui/markdown.ts";

type FakeNode = FakeDocumentFragment | FakeElement | FakeText;

class FakeDocumentFragment {
  readonly nodeType = 11;
  readonly childNodes: FakeNode[] = [];

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      if (node.nodeType === 11) {
        this.childNodes.push(...node.childNodes);
      } else {
        this.childNodes.push(node);
      }
    }
  }
}

class FakeElement extends FakeDocumentFragment {
  override readonly nodeType = 1;
  readonly dataset: Record<string, string> = {};
  className = "";
  innerHTML = "";
  textContent = "";

  constructor(readonly tagName: string) {
    super();
  }
}

class FakeText {
  readonly nodeType = 3;
  readonly childNodes: FakeNode[] = [];

  constructor(readonly textContent: string) {}
}

function findElementsByTag(node: FakeNode, tagName: string): FakeElement[] {
  const matches: FakeElement[] = [];
  if (node.nodeType === 1 && node.tagName === tagName) {
    matches.push(node);
  }

  for (const child of node.childNodes) {
    matches.push(...findElementsByTag(child, tagName));
  }

  return matches;
}

function collectText(node: FakeNode): string {
  if (node.nodeType === 3) {
    return node.textContent;
  }

  if (node.nodeType === 11) {
    return node.childNodes.map(collectText).join("");
  }

  return [node.textContent, ...node.childNodes.map(collectText)].join("");
}

globalThis.document = {
  createDocumentFragment: () => new FakeDocumentFragment(),
  createElement: (tagName: string) => new FakeElement(tagName),
  createTextNode: (text: string) => new FakeText(text)
} as unknown as Document;

test("renderMarkdown treats indented fenced code as a block", () => {
  const fragment = renderMarkdown(
    [
      "4. Run the helper.",
      "   ```bash",
      "   python \"${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py\" \\",
      "     --input <source> \\",
      "     --out <final.png>",
      "   ```",
      "5. Validate the output."
    ].join("\n")
  ) as unknown as FakeDocumentFragment;

  const figure = fragment.childNodes.find(
    (node): node is FakeElement => node.nodeType === 1 && node.tagName === "figure"
  );

  assert.ok(figure);
  assert.equal(figure.className, "md-code-frame");
  assert.equal(figure.dataset.language, "bash");

  const caption = figure.childNodes.find(
    (node): node is FakeElement => node.nodeType === 1 && node.tagName === "figcaption"
  );
  assert.equal(caption?.textContent, "bash");

  const pre = figure.childNodes.find(
    (node): node is FakeElement => node.nodeType === 1 && node.tagName === "pre"
  );
  const code = pre?.childNodes.find(
    (node): node is FakeElement => node.nodeType === 1 && node.tagName === "code"
  );

  assert.match(code?.className ?? "", /\blanguage-bash\b/);
  assert.match(code?.innerHTML ?? "", /remove_chroma_key\.py/);
  assert.doesNotMatch(code?.innerHTML ?? "", /^ {3}/);
});

test("renderMarkdown does not emphasize underscore placeholders inside paths", () => {
  const fragment = renderMarkdown(
    [
      "Generated images are saved to /example/.codex/generated_images/session-id as",
      "/example/.codex/generated_images/session-id/_image_id_.png by default."
    ].join(" ")
  ) as unknown as FakeDocumentFragment;

  assert.equal(findElementsByTag(fragment, "em").length, 0);
  assert.match(collectText(fragment), /\/_image_id_\.png by default/);
});

test("renderMarkdown still emphasizes standalone underscore text", () => {
  const fragment = renderMarkdown("This is _important_ text.") as unknown as FakeDocumentFragment;
  const emphasis = findElementsByTag(fragment, "em");

  assert.equal(emphasis.length, 1);
  assert.equal(emphasis[0].textContent, "important");
});
