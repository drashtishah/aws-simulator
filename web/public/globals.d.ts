/* Global type declarations for browser libraries loaded via <script> tags */

declare const marked: {
  setOptions(opts: {
    breaks?: boolean;
    gfm?: boolean;
    highlight?: (code: string, lang: string) => string;
  }): void;
  parse(text: string): string;
};

declare const hljs: {
  getLanguage(lang: string): unknown;
  highlight(code: string, opts: { language: string }): { value: string };
  highlightAuto(code: string): { value: string };
};

declare const mermaid: {
  initialize(opts: { startOnLoad: boolean; theme: string }): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

declare function renderMarkdown(text: string): string;
