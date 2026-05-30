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

  contains(node: any): boolean {
    if (node === this) return true;
    for (const child of this.childNodes) {
      if (child === node) return true;
      if (child.nodeType === 1 || child.nodeType === 11) {
        if ((child as any).contains(node)) return true;
      }
    }
    return false;
  }

  querySelector(selector: string): any {
    const results = this.querySelectorAll(selector);
    return results[0] ?? null;
  }

  querySelectorAll(selector: string): any[] {
    const matches: any[] = [];
    const isClass = selector.startsWith(".");
    const target = isClass ? selector.slice(1) : selector.toUpperCase();

    const traverse = (node: any) => {
      if (node.nodeType === 1) {
        if (isClass) {
          if (node.className.split(" ").filter(Boolean).includes(target)) {
            matches.push(node);
          }
        } else {
          if (node.tagName.toUpperCase() === target) {
            matches.push(node);
          }
        }
      }
      for (const child of node.childNodes) {
        traverse(child);
      }
    };

    for (const child of this.childNodes) {
      traverse(child);
    }
    return matches;
  }
}

export class FakeElement extends FakeDocumentFragment {
  override readonly nodeType = 1;
  readonly dataset: Record<string, string> = {};
  className = "";
  innerHTML = "";
  private _textContent = "";
  private listeners: Record<string, Function[]> = {};
  readonly attributes: Record<string, string> = {};

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

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
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

(globalThis as any).window = globalThis;

