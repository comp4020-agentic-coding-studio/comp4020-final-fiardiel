import { marked } from "marked";
import { layout } from "./pages.ts";

// The README is the author's own file, so its HTML is trusted; it is rendered
// on the server because the shipped check reads /readme/ with no script running.
export function renderReadmePage(markdown: string): string {
  const body = marked.parse(markdown, { async: false });
  return layout("About", `<article>${body}</article>`);
}
