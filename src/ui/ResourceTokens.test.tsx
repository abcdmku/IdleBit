import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  exactCost,
  exactResourceBag,
} from "../game";
import { ExactResourceAmount, ExactResourceCost } from "./ResourceTokens";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("exact resource tokens", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("keeps the canonical huge amount in title and accessible text", () => {
    const hugePlusOne = amountAdd(amount("1e309"), 1);

    act(() => {
      root.render(
        <ExactResourceAmount
          resource="credits"
          amount={hugePlusOne}
          plus
          compact
        />,
      );
    });

    const token = container.querySelector<HTMLElement>(
      ".resource-token.credits",
    );

    expect(token?.querySelector("strong")?.textContent).toBe("+1…001e309");
    expect(token?.title).toBe(`${hugePlusOne} credits`);
    expect(token?.getAttribute("aria-label")).toBe(
      `+${hugePlusOne} credits`,
    );
  });

  it("dims costs using exact affordability beyond Number range", () => {
    const huge = amount("1e309");
    const hugePlusOne = amountAdd(huge, 1);

    act(() => {
      root.render(
        <ExactResourceCost
          costs={[
            exactCost("credits", hugePlusOne),
            exactCost("data", huge),
          ]}
          resources={exactResourceBag(huge, hugePlusOne)}
        />,
      );
    });

    expect(
      container.querySelector(".resource-token.credits")?.classList,
    ).toContain("dimmed");
    expect(
      container.querySelector(".resource-token.data")?.classList,
    ).not.toContain("dimmed");
  });
});
