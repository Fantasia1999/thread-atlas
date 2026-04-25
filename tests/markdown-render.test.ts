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
