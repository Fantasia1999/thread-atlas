export type FakeNode = FakeDocumentFragment | FakeElement | FakeText;

export class FakeDocumentFragment {
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

export class FakeElement extends FakeDocumentFragment {
  override readonly nodeType = 1;
  readonly dataset: Record<string, string> = {};
  className = "";
  innerHTML = "";
  private _textContent = "";
  private listeners: Record<string, Function[]> = {};

  get textContent(): string {
    if (this._textContent) return this._textContent;
    return this.childNodes.map(node => {
      if (node.nodeType === 3) return (node as any).textContent;
      if (node.nodeType === 1) return (node as any).textContent;
      return "";
    }).join("");
  }
  set textContent(val: string) {
    this._textContent = val;
  }

  classList = {
    add: (...classes: string[]) => {
      const parts = this.className.split(" ").filter(Boolean);
      for (const c of classes) {
        if (!parts.includes(c)) parts.push(c);
      }
      this.className = parts.join(" ");
    },
    remove: (...classes: string[]) => {
      const parts = this.className.split(" ").filter(Boolean);
      this.className = parts.filter(p => !classes.includes(p)).join(" ");
    },
    toggle: (c: string, force?: boolean) => {
      const parts = this.className.split(" ").filter(Boolean);
      const has = parts.includes(c);
      const want = force !== undefined ? force : !has;
      if (want && !has) {
        parts.push(c);
      } else if (!want && has) {
        const idx = parts.indexOf(c);
        parts.splice(idx, 1);
      }
      this.className = parts.join(" ");
      return want;
    },
    contains: (c: string) => {
      return this.className.split(" ").filter(Boolean).includes(c);
    }
  };

  constructor(readonly tagName: string) {
    super();
  }

  addEventListener(type: string, listener: Function): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  dispatchEvent(type: string): void {
    if (this.listeners[type]) {
      for (const listener of this.listeners[type]) {
        listener();
      }
    }
  }
}

export class FakeText {
  readonly nodeType = 3;
  readonly childNodes: FakeNode[] = [];

  constructor(readonly textContent: string) {}
}

export function findElementsByTag(node: FakeNode, tagName: string): FakeElement[] {
  const matches: FakeElement[] = [];
  if (node.nodeType === 1 && node.tagName === tagName) {
    matches.push(node);
  }

  for (const child of node.childNodes) {
    matches.push(...findElementsByTag(child, tagName));
  }

  return matches;
}

export function collectText(node: FakeNode): string {
  if (node.nodeType === 3) {
    return node.textContent;
  }

  if (node.nodeType === 11) {
    return node.childNodes.map(collectText).join("");
  }

  return node.textContent;
}

// Automatically setup global document
globalThis.document = {
  createDocumentFragment: () => new FakeDocumentFragment(),
  createElement: (tagName: string) => new FakeElement(tagName),
  createTextNode: (text: string) => new FakeText(text)
} as unknown as Document;
