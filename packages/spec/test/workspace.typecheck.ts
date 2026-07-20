import type {
  ContractErrorCode,
  ContractResult,
  IssueManifest,
  IssueIdentity,
  IssueRepositoryTarget,
  LegacyProjectEventMigrationInput,
  RepositoryBinding,
  RepositoryIssueIdentity,
  RollEvent,
  WorkspaceManifest,
  WorkspaceIdentity,
} from "../src/index.js";
import {
  parseIssueManifest,
  parseLegacyProjectEventMigrationInput,
  parseRepositoryBinding,
  parseWorkspaceManifest,
} from "../src/index.js";
// @ts-expect-error DeliverySet is intentionally absent from the public v1 contract
import type { DeliverySet } from "../src/index.js";
// @ts-expect-error DeliverySet is intentionally absent from the Workspace v1 module
import type { DeliverySet as WorkspaceDeliverySet } from "../src/types/workspace.js";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;
type ContainsAny<T> = IsAny<T> extends true
  ? true
  : T extends readonly (infer Item)[]
    ? ContainsAny<Item>
    : T extends object
      ? true extends { [Key in keyof T]-?: ContainsAny<T[Key]> }[keyof T]
        ? true
        : false
      : false;

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
const workspaceIsNotAny: AssertFalse<IsAny<WorkspaceManifest>> = false;
const repositoryIsNotAny: AssertFalse<IsAny<RepositoryBinding>> = false;
const issueIsNotAny: AssertFalse<IsAny<IssueManifest>> = false;
const workspaceIdentityIsNotAny: AssertFalse<IsAny<WorkspaceIdentity>> = false;
const issueIdentityIsNotAny: AssertFalse<IsAny<IssueIdentity>> = false;
const repositoryIssueIdentityIsNotAny: AssertFalse<IsAny<RepositoryIssueIdentity>> = false;
const parseWorkspaceResultIsNotAny: AssertFalse<IsAny<ReturnType<typeof parseWorkspaceManifest>>> = false;
const parseRepositoryResultIsNotAny: AssertFalse<IsAny<ReturnType<typeof parseRepositoryBinding>>> = false;
const parseIssueResultIsNotAny: AssertFalse<IsAny<ReturnType<typeof parseIssueManifest>>> = false;
const workspaceRequirementsIsNotAny: AssertFalse<IsAny<WorkspaceManifest["requirements"]>> = false;
const workspaceRequirementIsNotAny: AssertFalse<IsAny<WorkspaceManifest["requirements"][number]>> = false;
const workspaceRepositoriesIsNotAny: AssertFalse<IsAny<WorkspaceManifest["repositories"]>> = false;
const repositoryWorkflowIsNotAny: AssertFalse<IsAny<RepositoryBinding["workflow"]>> = false;
const issueRepositoriesIsNotAny: AssertFalse<IsAny<IssueManifest["repositories"]>> = false;
const issueRepositoryIsNotAny: AssertFalse<IsAny<IssueManifest["repositories"][number]>> = false;
const workspaceContainsNoAny: AssertFalse<ContainsAny<WorkspaceManifest>> = false;
const repositoryContainsNoAny: AssertFalse<ContainsAny<RepositoryBinding>> = false;
const issueContainsNoAny: AssertFalse<ContainsAny<IssueManifest>> = false;
const issueTargetContainsNoAny: AssertFalse<ContainsAny<IssueRepositoryTarget>> = false;
const workspaceIdentityContainsNoAny: AssertFalse<ContainsAny<WorkspaceIdentity>> = false;
const issueIdentityContainsNoAny: AssertFalse<ContainsAny<IssueIdentity>> = false;
const repositoryIssueIdentityContainsNoAny: AssertFalse<ContainsAny<RepositoryIssueIdentity>> = false;
const nestedAnyDetectionProbe: AssertTrue<ContainsAny<{ nested: { value: ReturnType<typeof JSON.parse> } }>> = true;

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
  workspaceIsNotAny,
  repositoryIsNotAny,
  issueIsNotAny,
  workspaceIdentityIsNotAny,
  issueIdentityIsNotAny,
  repositoryIssueIdentityIsNotAny,
  parseWorkspaceResultIsNotAny,
  parseRepositoryResultIsNotAny,
  parseIssueResultIsNotAny,
  workspaceRequirementsIsNotAny,
  workspaceRequirementIsNotAny,
  workspaceRepositoriesIsNotAny,
  repositoryWorkflowIsNotAny,
  issueRepositoriesIsNotAny,
  issueRepositoryIsNotAny,
  workspaceContainsNoAny,
  repositoryContainsNoAny,
  issueContainsNoAny,
  issueTargetContainsNoAny,
  workspaceIdentityContainsNoAny,
  issueIdentityContainsNoAny,
  repositoryIssueIdentityContainsNoAny,
  nestedAnyDetectionProbe,
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
