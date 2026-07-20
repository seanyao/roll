import type {
  ContractResult,
  IssueRepositoryTarget,
  LegacyProjectEventMigrationInput,
  RollEvent,
} from "../src/index.js";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;

const result: ContractResult<string> = { ok: true, value: "typed" };
const resultIsNotAny: AssertFalse<IsAny<ContractResult<string>>> = false;

const read: IssueRepositoryTarget = {
  repoId: "repo-0123456789ab",
  alias: "context",
  access: "read",
  requiredDelivery: false,
};
const write: IssueRepositoryTarget = {
  repoId: "repo-0123456789ac",
  alias: "product",
  access: "write",
  requiredDelivery: true,
  noChangePolicy: "changes_required",
};

// @ts-expect-error read targets cannot require delivery
const invalidRead: IssueRepositoryTarget = { ...read, requiredDelivery: true };
// @ts-expect-error write targets require an explicit no-change policy
const invalidWrite: IssueRepositoryTarget = {
  repoId: "repo-0123456789ad",
  alias: "missing-policy",
  access: "write",
  requiredDelivery: true,
};
// @ts-expect-error DeliverySet is intentionally absent from the public v1 contract
const forbiddenDeliverySet: import("../src/index.js").DeliverySet = {};
declare const migration: LegacyProjectEventMigrationInput;
// @ts-expect-error migration wrappers are deliberately outside the runtime RollEvent union
const runtimeEvent: RollEvent = migration;

void [result, resultIsNotAny, read, write, invalidRead, invalidWrite, forbiddenDeliverySet, runtimeEvent];
