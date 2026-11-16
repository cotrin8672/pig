import type {
  ModelSelection,
  SessionInfo,
  Snapshot,
} from "../shared/rpc-schema";

export type ModelPickerSnapshot = ModelSelection &
  Pick<
    Snapshot,
    | "address"
    | "ready"
    | "suspended"
    | "sessionAccounts"
    | "accountSwitchAllowed"
    | "modelCatalog"
  > & {
    info: Pick<SessionInfo, "id" | "cwd">;
  };

/** Memo props contain picker metadata only, never a captured conversation. */
export function createModelPickerSelector() {
  let previous: ModelPickerSnapshot | undefined;
  let signature: string | undefined;
  return (snapshot: Snapshot): ModelPickerSnapshot => {
    const view: ModelPickerSnapshot = {
      address: snapshot.address,
      ready: snapshot.ready,
      suspended: snapshot.suspended,
      info: { id: snapshot.info.id, cwd: snapshot.info.cwd },
      model: snapshot.model,
      accountId: snapshot.accountId,
      effort: snapshot.effort,
      effortLevels: snapshot.effortLevels,
      sessionAccounts: snapshot.sessionAccounts,
      accountSwitchAllowed: snapshot.accountSwitchAllowed,
      modelCatalog: snapshot.modelCatalog,
    };
    // Catalogs can contain thousands of models; compare their immutable identity
    // separately. IPC recreates the small selection/account objects each time.
    const { modelCatalog, ...metadata } = view;
    const nextSignature = JSON.stringify(metadata);
    if (
      previous &&
      previous.modelCatalog === modelCatalog &&
      signature === nextSignature
    )
      return previous;
    signature = nextSignature;
    previous = view;
    return view;
  };
}
