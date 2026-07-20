import type {
  ContractErrorCode,
  ContractResult,
  IssueIdentity,
  IssueRepositoryTarget,
  LegacyProjectEventMigrationInput,
  RepositoryIssueIdentity,
  RollEvent,
  WorkspaceIdentity,
} from "../src/index.js";
import { parseLegacyProjectEventMigrationInput } from "../src/index.js";
// @ts-expect-error DeliverySet is intentionally absent from the public v1 contract
import type { DeliverySet } from "../src/index.js";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;

const result: ContractResult<string> = { ok: true, value: "typed" };
const resultIsNotAny: AssertFalse<IsAny<ContractResult<string>>> = false;
const failure: ContractResult<string> = {
  ok: false,
  errors: [{ code: "invalid_type", path: "workspaceId", message: "typed" }],
};
type Failure = Extract<ContractResult<string>, { ok: false }>;
type FailureError = Failure["errors"][number];
const failureErrorIsNotAny: AssertFalse<IsAny<FailureError>> = false;
const failureCode: ContractErrorCode = failure.errors[0]!.code;

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
declare const migration: LegacyProjectEventMigrationInput;
// @ts-expect-error migration wrappers are deliberately outside the runtime RollEvent union
const runtimeEvent: RollEvent = migration;

declare const workspaceIdentity: WorkspaceIdentity;
declare const issueIdentity: IssueIdentity;
declare const repositoryIssueIdentity: RepositoryIssueIdentity;

void [
  result,
  resultIsNotAny,
  failure,
  failureErrorIsNotAny,
  failureCode,
  read,
  write,
  invalidRead,
  invalidWrite,
  runtimeEvent,
  workspaceIdentity,
  issueIdentity,
  repositoryIssueIdentity,
  parseLegacyProjectEventMigrationInput,
];
