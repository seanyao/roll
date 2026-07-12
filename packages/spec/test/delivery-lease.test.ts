/**
 * US-DELIV-005 — DeliveryLeaseState vocabulary (design §4).
 *
 * One-card-one-lease: the picker consults deliveryLease before picking; a card
 * held in any lease state is skipped. These tests freeze the lease vocabulary
 * and the picker's "all leased" backlog reason.
 */
import { describe, expect, it } from "vitest";
import { DELIVERY_LEASE_STATES } from "../src/index.js";
import type { BacklogReason, DeliveryLease, DeliveryLeaseState } from "../src/index.js";

describe("US-DELIV-005 — DeliveryLeaseState vocabulary", () => {
  it("is the closed 4-state lease set", () => {
    expect(DELIVERY_LEASE_STATES).toEqual(["in_flight", "awaiting_merge", "ci_red", "delivered"]);
  });

  it("every state is a distinct string", () => {
    expect(new Set(DELIVERY_LEASE_STATES).size).toBe(DELIVERY_LEASE_STATES.length);
  });

  it("DeliveryLease carries storyId, cycleId and state", () => {
    const lease: DeliveryLease = { storyId: "US-X-1", cycleId: "cycle-1", state: "awaiting_merge" };
    const state: DeliveryLeaseState = lease.state;
    expect(state).toBe("awaiting_merge");
  });

  it("BacklogReason admits all_leased", () => {
    const reason: BacklogReason = "all_leased";
    expect(reason).toBe("all_leased");
  });
});
