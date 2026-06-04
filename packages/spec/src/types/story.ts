/** Backlog contracts (BC1, I9). */
export type StoryId = string;

export type TaskLevel = "epic" | "feature" | "story" | "action";

export type StoryStatus = "todo" | "in_progress" | "done" | "hold";

export type StoryType = "US" | "FIX" | "REFACTOR" | "IDEA";

export interface Story {
  id: StoryId;
  description: string;
  status: StoryStatus;
  /** IDs that must be done before this story may be picked. */
  dependsOn: StoryId[];
  /** Picker must skip these outright (human-reserved). */
  manualOnly?: boolean;
}
