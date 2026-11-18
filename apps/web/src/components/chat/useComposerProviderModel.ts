import {
  type DraftId,
  deriveEffectiveComposerModelState,
  useComposerDraftModelState,
} from "../../composerDraftStore";
import { draftModelSelectionApplies } from "../../lib/chatThreadActions";
import {
  type ModelSelection,
  type ProjectId,
  ProviderDriverKind,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  NO_PROVIDER_MODEL_SELECTION,
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type UnifiedSettings } from "@t3tools/contracts/settings";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
import { resolveComposerProviderSelection } from "../ChatView.logic";

const NO_PROVIDER_MODELS: ServerProvider["models"] = [];

/**
 * The provider instances the composer offers, which one is selected, and the model and options
 * the draft resolves to on it. The draft store is read first so every derivation follows the only
 * hook here; in the composer body they would straddle its later hooks and lose their cache.
 */
export function useComposerModelSelection(
  input: Omit<Parameters<typeof resolveComposerProviderSelection>[0], "entries"> & {
    readonly providerStatuses: ReadonlyArray<ServerProvider>;
    readonly settings: UnifiedSettings;
    readonly activeProjectId: ProjectId | null;
    readonly threadRef: ScopedThreadRef | DraftId;
    readonly threadModelSelection: ModelSelection | null | undefined;
    readonly projectModelSelection: ModelSelection | null | undefined;
    readonly threadStarted: boolean;
  },
) {
  const {
    providerStatuses,
    settings,
    activeProjectId,
    threadRef,
    threadModelSelection,
    projectModelSelection,
    candidateInstanceIds,
    lockedProvider,
    lockedInstanceId,
    threadStarted,
  } = input;
  const draftModelState = useComposerDraftModelState(threadRef);
  const providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry> = providerInstanceEntriesFor(
    providerStatuses,
    settings,
    activeProjectId,
  );
  const selection = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: [
      draftModelSelectionApplies(draftModelState, threadStarted)
        ? draftModelState.activeProvider
        : null,
      ...candidateInstanceIds,
    ],
    lockedProvider,
    lockedInstanceId,
  });
  const selectedInstanceId =
    selection.selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const selectedProvider: ProviderDriverKind =
    selection.selectedProviderEntry?.driverKind ?? selection.requestedDriverKind;
  const modelState = deriveEffectiveComposerModelState({
    draft: draftModelState,
    threadStarted,
    providers: providerStatuses,
    selectedProvider,
    selectedInstanceId,
    requestedInstanceId: selection.requestedInstanceId,
    threadModelSelection,
    projectModelSelection,
    settings,
  });
  return {
    ...selection,
    providerInstanceEntries,
    selectedInstanceId,
    selectedProvider,
    selectedModel: modelState.selectedModel,
    composerModelOptions: modelState.modelOptions,
  };
}

export function useComposerProviderModel(
  input: Parameters<typeof useComposerModelSelection>[0] & {
    readonly promptInjectionState: ReturnType<typeof getComposerPromptInjectionState>;
  },
) {
  const selection = useComposerModelSelection(input);
  const selectedProviderModels = selection.selectedProviderEntry?.models ?? NO_PROVIDER_MODELS;
  const composerProviderState = getComposerProviderState({
    provider: selection.selectedProvider,
    model: selection.selectedModel,
    models: selectedProviderModels,
    promptInjectionState: input.promptInjectionState,
    modelOptions: selection.composerModelOptions?.[selection.selectedInstanceId],
  });
  return { ...selection, selectedProviderModels, composerProviderState };
}
