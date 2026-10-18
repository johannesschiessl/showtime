import { ProfileId } from "@showtime/contracts";
import { Schema } from "effect";

export const profileSelectionStorageKey = "showtime.selected-profile.v1";
export const profileSelectionChangedEvent = "showtime-profile-selection";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

const ProfileSelection = Schema.Struct({ version: Schema.Literal(1), profileId: ProfileId });
const decodeProfileSelection = Schema.decodeUnknownSync(ProfileSelection, {
  onExcessProperty: "error",
});

export const readProfileSelection = (storage?: ReadableStorage): ProfileId | undefined => {
  try {
    return decodeProfileSelection(
      JSON.parse(
        (storage ?? localStorage).getItem(profileSelectionStorageKey) ?? "null",
      ) as unknown,
    ).profileId;
  } catch {
    return undefined;
  }
};

export const writeProfileSelection = (
  profileId: ProfileId,
  storage: WritableStorage = localStorage,
) => {
  storage.setItem(profileSelectionStorageKey, JSON.stringify({ version: 1, profileId }));
};
