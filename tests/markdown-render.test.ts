import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../src/ui/markdown.ts";

import {
  FakeDocumentFragment,
  FakeElement,
  findElementsByTag,
  collectText
} from "./dom-mock.ts";

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

test("renderMarkdown renders bold text containing inline code with asterisks", () => {
  const fragment = renderMarkdown("This is **bold text with code (`*.ext`)** inside.") as unknown as FakeDocumentFragment;
  const strong = findElementsByTag(fragment, "strong")[0];
  const code = findElementsByTag(strong, "code")[0];

  assert.ok(strong);
  assert.equal(code.className, "inline-code");
  assert.equal(code.textContent, "*.ext");
  assert.match(collectText(strong), /bold text with code/);
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

test("renderMarkdown interactive code frames toggle collapsed class on click", () => {
  const fragment = renderMarkdown(
    [
      "```typescript",
      "const a = 1;",
      "```"
    ].join("\n")
  ) as any;

  const figure = fragment.childNodes.find((node: any) => node.tagName === "figure");
  assert.ok(figure);
  assert.equal(figure.classList.contains("collapsed"), false);

  const caption = figure.childNodes.find((node: any) => node.tagName === "figcaption");
  assert.ok(caption);

  // Trigger click on the caption (the collapsible header)
  caption.dispatchEvent("click");

  // Verify that it is now collapsed
  assert.equal(figure.classList.contains("collapsed"), true);

  // Click again to uncollapse
  caption.dispatchEvent("click");
  assert.equal(figure.classList.contains("collapsed"), false);
});

test("renderMarkdown renders mermaid code blocks as premium interactive cards with tab switching", () => {
  const fragment = renderMarkdown(
    [
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```"
    ].join("\n")
  ) as any;

  const card = fragment.childNodes.find((node: any) => node.className === "mermaid-diagram-card");
  assert.ok(card);

  // Validate header and tab buttons
  const header = card.childNodes.find((node: any) => node.className === "mermaid-card-header");
  assert.ok(header);
  
  const tabs = header.childNodes.find((node: any) => node.className === "mermaid-card-tabs");
  assert.ok(tabs);
  const btnPreview = tabs.childNodes.find((node: any) => node.textContent === "Preview");
  const btnCode = tabs.childNodes.find((node: any) => node.textContent === "Code");
  assert.ok(btnPreview);
  assert.ok(btnCode);

  // Validate body and tab contents
  const body = card.childNodes.find((node: any) => node.className === "mermaid-card-body");
  assert.ok(body);

  const previewContainer = body.childNodes.find((node: any) => node.className.includes("mermaid-preview-content"));
  const codeContainer = body.childNodes.find((node: any) => node.className.includes("mermaid-code-content"));
  assert.ok(previewContainer);
  assert.ok(codeContainer);

  const preMermaid = previewContainer.childNodes.find((node: any) => node.tagName === "pre");
  assert.ok(preMermaid);
  assert.equal(preMermaid.className, "mermaid");
  assert.equal(preMermaid.textContent, "graph TD\n  A --> B");

  const preCode = codeContainer.childNodes.find((node: any) => node.tagName === "pre");
  assert.ok(preCode);
  const codeNode = preCode.childNodes.find((node: any) => node.tagName === "code");
  assert.ok(codeNode);
  assert.match(codeNode.className, /\blanguage-mermaid\b/);
  assert.equal(codeNode.innerHTML, "graph TD\n  A --&gt; B");

  // Validate tab toggle behavior on click events
  assert.equal(btnPreview.classList.contains("active"), true);
  assert.equal(btnCode.classList.contains("active"), false);
  assert.ok(previewContainer.style.display === undefined || previewContainer.style.display === "");
  assert.equal(codeContainer.style.display, "none");

  // Click Code Tab
  btnCode.dispatchEvent("click");
  assert.equal(btnPreview.classList.contains("active"), false);
  assert.equal(btnCode.classList.contains("active"), true);
  assert.equal(previewContainer.style.display, "none");
  assert.equal(codeContainer.style.display, "");

  // Click Preview Tab
  btnPreview.dispatchEvent("click");
  assert.equal(btnPreview.classList.contains("active"), true);
  assert.equal(btnCode.classList.contains("active"), false);
  assert.equal(previewContainer.style.display, "");
  assert.equal(codeContainer.style.display, "none");
});

test("renderMarkdown renders local file:// links as anchor elements", () => {
  const fragment = renderMarkdown(
    "Check the [artifact report](file:///home/example-user/.gemini/antigravity-cli/brain/session/report.md) for details."
  ) as unknown as FakeDocumentFragment;

  const links = findElementsByTag(fragment, "a");
  assert.equal(links.length, 1);
  assert.equal(links[0].className, "md-link");
  assert.equal(links[0].getAttribute("href"), "file:///home/example-user/.gemini/antigravity-cli/brain/session/report.md");
  assert.equal(links[0].textContent, "artifact report");
});

test("renderMarkdown renders image syntax as image element and opens zoom modal on click", () => {
  const fragment = renderMarkdown(
    "Here is an image: ![Cool Image](data:image/png;base64,iVBORw0KGgoAAAANS)"
  ) as unknown as FakeDocumentFragment;

  const imgs = findElementsByTag(fragment, "img");
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].className, "md-image");
  assert.equal(imgs[0].getAttribute("src"), "data:image/png;base64,iVBORw0KGgoAAAANS");
  assert.equal(imgs[0].getAttribute("alt"), "Cool Image");

  // Click to open modal
  imgs[0].dispatchEvent("click");
  
  // Verify overlay is created on document.body
  const overlay = (globalThis.document as any).body.childNodes.find(
    (node: any) => node.className.includes("image-zoom-overlay")
  );
  assert.ok(overlay);
  assert.equal(overlay.classList.contains("active"), true);

  const zoomImg = overlay.childNodes.find((node: any) => node.className === "image-zoom-img");
  assert.ok(zoomImg);
  assert.equal(zoomImg.getAttribute("src"), "data:image/png;base64,iVBORw0KGgoAAAANS");

  // Click to close overlay
  overlay.dispatchEvent("click");
  assert.equal(overlay.classList.contains("active"), false);
});

test("renderMarkdown renders XML-like image tags as styled attachment badges and ignores closing </image> tags", () => {
  const fragment = renderMarkdown(
    `Attached file: <image name=[Image #1] path="/var/folders/tf/wqzy96dx0cn1zxt3x6s7nvmr0000gn/T/codex-clipboard-7632fb05-b0d4-42a5-b9fa-c0cd78fc76bc.png"></image>`
  ) as unknown as FakeDocumentFragment;

  const badges = findElementsByTag(fragment, "span").filter(
    (el) => el.className === "image-attachment-badge"
  );
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, "📷 Image #1");

  // Verify that </image> is not rendered in the text content
  assert.doesNotMatch(collectText(fragment), /<\/image>/);
});

test("renderMarkdown groups consecutive image badges and images into gallery cards", () => {
  const fragment = renderMarkdown(
    `<image name=[Image #1] path="/a.png">\n![Img1](data:image/png;base64,1)\n<image name=[Image #2] path="/b.png">\n![Img2](data:image/png;base64,2)`
  ) as unknown as FakeDocumentFragment;

  const galleries = findElementsByTag(fragment, "div").filter(
    (el) => el.className === "image-gallery"
  );
  assert.equal(galleries.length, 1);

  const cards = galleries[0].childNodes.filter(
    (node: any) => node.className === "image-card"
  );
  assert.equal(cards.length, 2);

  // First card has badge and image
  const card1 = cards[0];
  const badge1 = card1.childNodes.find((n: any) => n.className === "image-attachment-badge");
  const img1 = card1.childNodes.find((n: any) => n.className === "md-image");
  assert.ok(badge1);
  assert.ok(img1);
  assert.equal(badge1.textContent, "📷 Image #1");
  assert.equal(img1.getAttribute("src"), "data:image/png;base64,1");

  // Second card has badge and image
  const card2 = cards[1];
  const badge2 = card2.childNodes.find((n: any) => n.className === "image-attachment-badge");
  const img2 = card2.childNodes.find((n: any) => n.className === "md-image");
  assert.ok(badge2);
  assert.ok(img2);
  assert.equal(badge2.textContent, "📷 Image #2");
  assert.equal(img2.getAttribute("src"), "data:image/png;base64,2");
});
