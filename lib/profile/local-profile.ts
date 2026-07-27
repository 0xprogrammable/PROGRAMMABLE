export const PROFILE_STORAGE_PREFIX = "programmable-profile";
export const PROFILE_UPDATED_EVENT = "programmable:profile-updated";
export const MAXIMUM_AVATAR_FILE_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_AVATAR_DATA_URL_CHARACTERS = 1_500_000;
export const MAXIMUM_AVATAR_DIMENSION = 12_000;
export const MAXIMUM_AVATAR_PIXELS = 48_000_000;

export const ACCEPTED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const acceptedAvatarTypes = new Set<string>(ACCEPTED_AVATAR_TYPES);
const ethereumAddressPattern = /^0x[a-f0-9]{40}$/;
const usernamePattern = /^[A-Za-z0-9]{3,12}$/;
const safeAvatarDataUrlPattern =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export type LocalProfile = {
  username: string;
  avatarDataUrl: string;
};

type ProfileStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type AvatarFileMetadata = {
  size: number;
  type: string;
};

type StoredProfile = {
  version: 1;
  username: string;
  avatarDataUrl: string;
};

export const EMPTY_LOCAL_PROFILE: Readonly<LocalProfile> = Object.freeze({
  username: "",
  avatarDataUrl: "",
});

export function getProfileStorageKey(address: string) {
  const normalizedAddress = address.trim().toLowerCase();

  if (!ethereumAddressPattern.test(normalizedAddress)) {
    throw new Error("A valid Ethereum wallet address is required");
  }

  return `${PROFILE_STORAGE_PREFIX}:${normalizedAddress}`;
}

export function normalizeProfileUsername(username: string) {
  return username.trim();
}

export function getProfileUsernameError(username: string) {
  const normalizedUsername = normalizeProfileUsername(username);

  if (!normalizedUsername || usernamePattern.test(normalizedUsername)) {
    return "";
  }

  return "Use 3–12 letters or numbers";
}

export function getAvatarFileError(file: AvatarFileMetadata) {
  if (!acceptedAvatarTypes.has(file.type)) {
    return "Choose a JPG, PNG or WebP image";
  }

  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return "Choose a non-empty image";
  }

  if (file.size > MAXIMUM_AVATAR_FILE_BYTES) {
    return "Keep the image under 8 MB";
  }

  return "";
}

export function getAvatarDimensionsError(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "The image has invalid dimensions";
  }

  if (
    width > MAXIMUM_AVATAR_DIMENSION ||
    height > MAXIMUM_AVATAR_DIMENSION ||
    width * height > MAXIMUM_AVATAR_PIXELS
  ) {
    return "Choose an image under 48 megapixels";
  }

  return "";
}

export function isSafeAvatarDataUrl(value: string) {
  if (!value) return true;

  return (
    value.length <= MAXIMUM_AVATAR_DATA_URL_CHARACTERS &&
    safeAvatarDataUrlPattern.test(value)
  );
}

export function parseLocalProfile(value: string | null): LocalProfile {
  if (!value) return { ...EMPTY_LOCAL_PROFILE };

  try {
    const stored = JSON.parse(value) as Partial<StoredProfile>;
    if (stored.version !== 1) return { ...EMPTY_LOCAL_PROFILE };

    const username =
      typeof stored.username === "string"
        ? normalizeProfileUsername(stored.username)
        : "";
    const avatarDataUrl =
      typeof stored.avatarDataUrl === "string" &&
      isSafeAvatarDataUrl(stored.avatarDataUrl)
        ? stored.avatarDataUrl
        : "";

    return {
      username: getProfileUsernameError(username) ? "" : username,
      avatarDataUrl,
    };
  } catch {
    return { ...EMPTY_LOCAL_PROFILE };
  }
}

export function readLocalProfile(
  storage: ProfileStorage,
  address: string,
): LocalProfile {
  return parseLocalProfile(storage.getItem(getProfileStorageKey(address)));
}

export function writeLocalProfile(
  storage: ProfileStorage,
  address: string,
  profile: LocalProfile,
) {
  const username = normalizeProfileUsername(profile.username);
  const usernameError = getProfileUsernameError(username);

  if (usernameError) {
    throw new Error(usernameError);
  }

  if (!isSafeAvatarDataUrl(profile.avatarDataUrl)) {
    throw new Error("The prepared image is not safe to store");
  }

  const key = getProfileStorageKey(address);

  if (!username && !profile.avatarDataUrl) {
    storage.removeItem(key);
    return;
  }

  const storedProfile: StoredProfile = {
    version: 1,
    username,
    avatarDataUrl: profile.avatarDataUrl,
  };

  storage.setItem(key, JSON.stringify(storedProfile));
}
