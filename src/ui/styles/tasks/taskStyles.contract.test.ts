import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesDir = dirname(fileURLToPath(import.meta.url));
const read = (name: string) =>
  readFileSync(join(stylesDir, name), "utf-8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

/** Extract the declaration block for a selector (first occurrence). */
const blockFor = (css: string, selector: string) => {
  const start = css.indexOf(selector);
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
};

describe("task/research style contracts", () => {
  it("keeps catalog task cards unstyled while their task runs (stable catalog)", () => {
    // game-spec: the task list is a stable catalog — no recolor-on-run rule
    // may exist for `.task-card.active`.
    const css = read("task-panel.css");
    expect(blockFor(css, ".task-card.active")).toBeNull();
  });

  it("never dims purchased research text below normal contrast", () => {
    // C-UI-20: purchased cards may dim borders/backgrounds, but a whole-card
    // opacity multiplier would push 0.7-0.82rem text under 4.5:1.
    const css = read("research-panel.css");
    const purchased = blockFor(css, ".research-action.purchased");
    expect(purchased).not.toBeNull();
    expect(purchased).not.toContain("opacity");
  });
});
