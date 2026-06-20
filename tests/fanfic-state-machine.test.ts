import { describe, it, expect } from "vitest";
import {
  getNextAllowedAction,
  transitionFanficState,
  type FanficProjectState,
} from "../src/fanfic/state-machine.js";

function state(status: FanficProjectState["status"]): FanficProjectState {
  return {
    storyId: "rain-letter",
    status,
    revision: 0,
    artifacts: {},
    history: [],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

describe("fanfic state machine", () => {
  it("exposes the next allowed action for each workflow status", () => {
    expect(getNextAllowedAction(state("idea_pending_confirm"))).toBe("parse_idea");
    expect(getNextAllowedAction(state("idea_confirmed"))).toBe("generate_plan");
    expect(getNextAllowedAction(state("plan_pending_confirm"))).toBe("approve_plan");
    expect(getNextAllowedAction(state("plan_confirmed"))).toBe("generate_draft");
    expect(getNextAllowedAction(state("draft_pending_confirm"))).toBe("approve_draft");
    expect(getNextAllowedAction(state("review_pending_confirm"))).toBe("run_review");
    expect(getNextAllowedAction(state("rewrite_pending_confirm"))).toBe("generate_rewrite");
    expect(getNextAllowedAction(state("accepted"))).toBeNull();
  });

  it("runs the happy path through accepted", () => {
    let current = state("idea_pending_confirm");

    current = transitionFanficState(current, "parse_idea");
    expect(current.status).toBe("idea_pending_confirm");
    expect(current.artifacts.idea?.status).toBe("drafted");

    current = transitionFanficState(current, "approve_idea");
    expect(current.status).toBe("idea_confirmed");
    expect(current.artifacts.idea?.status).toBe("confirmed");

    current = transitionFanficState(current, "generate_plan");
    expect(current.status).toBe("plan_pending_confirm");

    current = transitionFanficState(current, "approve_plan");
    expect(current.status).toBe("plan_confirmed");

    current = transitionFanficState(current, "generate_draft");
    expect(current.status).toBe("draft_pending_confirm");

    current = transitionFanficState(current, "approve_draft");
    expect(current.status).toBe("review_pending_confirm");

    current = transitionFanficState(current, "run_review");
    expect(current.status).toBe("rewrite_pending_confirm");

    current = transitionFanficState(current, "accept_final");
    expect(current.status).toBe("accepted");
    expect(current.artifacts.final?.status).toBe("accepted");
  });

  it("rejects illegal transitions", () => {
    expect(() => transitionFanficState(state("idea_pending_confirm"), "generate_plan"))
      .toThrow(/not allowed/i);

    const afterIdea = transitionFanficState(
      transitionFanficState(state("idea_pending_confirm"), "parse_idea"),
      "approve_idea",
    );

    expect(() => transitionFanficState(afterIdea, "parse_idea"))
      .toThrow(/not allowed/i);
  });

  it("returns to draft confirmation after rewrite", () => {
    let current = state("idea_pending_confirm");
    for (const command of [
      "parse_idea",
      "approve_idea",
      "generate_plan",
      "approve_plan",
      "generate_draft",
      "approve_draft",
      "run_review",
      "generate_rewrite",
    ] as const) {
      current = transitionFanficState(current, command);
    }

    expect(current.status).toBe("draft_pending_confirm");
    expect(current.artifacts.rewriteDraft?.status).toBe("drafted");
    expect(getNextAllowedAction(current)).toBe("approve_draft");
  });
});
