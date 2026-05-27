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

  const figure = findElementsByTag(fragment, "figure")[0];

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

test("renderMarkdown keeps indented continuation paragraphs inside list items", () => {
  const fragment = renderMarkdown(
    [
      "* **普通函数（Function）**：",
      "  普通函数是一个独立的、固定的代码块。它只能使用传入的参数。",
      "",
      "* **闭包（Closure）**：",
      "  闭包不仅可以像函数一样被调用，还能记住局部变量。"
    ].join("\n")
  ) as unknown as FakeDocumentFragment;

  const lists = findElementsByTag(fragment, "ul");
  const items = findElementsByTag(fragment, "li");

  assert.equal(lists.length, 1);
  assert.equal(items.length, 2);
  assert.equal(fragment.childNodes.length, 1);
  assert.match(collectText(items[0]), /普通函数是一个独立的/);
  assert.match(collectText(items[1]), /闭包不仅可以像函数一样被调用/);
});

test("renderMarkdown renders horizontal rules", () => {
  const fragment = renderMarkdown("Before\n\n---\n\nAfter") as unknown as FakeDocumentFragment;
  const rules = findElementsByTag(fragment, "hr");

  assert.equal(rules.length, 1);
  assert.equal(rules[0].className, "md-rule");
  assert.match(collectText(fragment), /BeforeAfter/);
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
  assert.equal(collectText(emphasis[0]), "important");
});

test("renderMarkdown renders inline code inside strong text", () => {
  const fragment = renderMarkdown("Use **the `--force` flag** carefully.") as unknown as FakeDocumentFragment;
  const strong = findElementsByTag(fragment, "strong")[0];
  const code = findElementsByTag(strong, "code")[0];

  assert.ok(strong);
  assert.equal(code.className, "inline-code");
  assert.equal(code.textContent, "--force");
  assert.equal(collectText(strong), "the --force flag");
});

test("renderMarkdown renders inline math inside strong text", () => {
  const fragment = renderMarkdown("Use **$E=mc^2$ here**.") as unknown as FakeDocumentFragment;
  const strong = findElementsByTag(fragment, "strong")[0];
  const inlineMath = findElementsByTag(strong, "span").find(
    (element) => element.className === "md-math-inline"
  );

  assert.ok(strong);
  assert.ok(inlineMath);
  assert.match(inlineMath.innerHTML, /\bkatex\b/);
});

test("renderMarkdown renders inline math", () => {
  const fragment = renderMarkdown("Energy is $E=mc^2$.") as unknown as FakeDocumentFragment;
  const paragraphs = findElementsByTag(fragment, "div");
  const inlineMath = findElementsByTag(fragment, "span").find(
    (element) => element.className === "md-math-inline"
  );

  assert.equal(paragraphs[0].className, "message-text md-paragraph");
  assert.ok(inlineMath);
  assert.match(inlineMath.innerHTML, /\bkatex\b/);
});

test("renderMarkdown keeps shell variables as plain text", () => {
  const text = "Set $CODEX_HOME or $HOME before launching.";
  const fragment = renderMarkdown(text) as unknown as FakeDocumentFragment;

  assert.equal(findElementsByTag(fragment, "span").length, 0);
  assert.equal(collectText(fragment), text);
});

test("renderMarkdown keeps currency amounts as plain text", () => {
  const text = "The plan costs $5 and $10 for add-ons.";
  const fragment = renderMarkdown(text) as unknown as FakeDocumentFragment;

  assert.equal(findElementsByTag(fragment, "span").length, 0);
  assert.equal(collectText(fragment), text);
});

test("renderMarkdown renders display math blocks", () => {
  const fragment = renderMarkdown(
    [
      "Before",
      "",
      "$$",
      "a^2 + b^2 = c^2",
      "$$",
      "",
      "After"
    ].join("\n")
  ) as unknown as FakeDocumentFragment;
  const mathBlock = findElementsByTag(fragment, "div").find(
    (element) => element.className === "md-math-block"
  );

  assert.ok(mathBlock);
  assert.match(mathBlock.innerHTML, /\bkatex-display\b/);
  assert.match(collectText(fragment), /BeforeAfter/);
});
