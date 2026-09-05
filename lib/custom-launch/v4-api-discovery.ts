import activation from "../../docs/operations/releases/custom-launch-v4.1/api-activation.json";
import binding from "../../docs/operations/releases/custom-launch-v4.1/cli-release-binding.json";
import coordinate from "../../docs/operations/releases/custom-launch-v4.1/clean-room-release-coordinate.json";
import { projectV4ApiActivation } from "./v41-api-activation.mjs";

export const V4_API_DISCOVERY = projectV4ApiActivation(activation, binding, coordinate);

export const V4_API_PROFILE_VERSION = binding.releaseIdentity.profile.profileVersion;
