import { makeMicrophoneAtoms } from "./microphones/MicrophoneAtoms.js";
import { makeMixAtoms } from "./mixes/MixAtoms.js";
import { makeProfileAtoms } from "./profiles/ProfileAtoms.js";
import { makeRpcClient, type RpcClientOptions } from "./rpc/RpcClient.js";
import type { StreamingRpcOptions } from "./rpc/StreamingRpcOptions.js";
import { makeShowAtoms } from "./shows/ShowAtoms.js";
import { makeSongAtoms } from "./songs/SongAtoms.js";
import { makeChatAtoms } from "./chats/ChatAtoms.js";
import { makeLivePresenceAtoms } from "./live/LivePresenceAtoms.js";

export interface ShowtimeFrontendOptions extends RpcClientOptions, StreamingRpcOptions {}

export const makeShowtimeFrontend = (options: ShowtimeFrontendOptions) => {
  const RpcClient = makeRpcClient(options);
  const atomOptions = { refreshSignals: options.refreshSignals };

  return {
    RpcClient,
    ...makeShowAtoms(RpcClient, atomOptions),
    ...makeMicrophoneAtoms(RpcClient, atomOptions),
    ...makeMixAtoms(RpcClient, atomOptions),
    ...makeSongAtoms(RpcClient, atomOptions),
    ...makeProfileAtoms(RpcClient, atomOptions),
    ...makeChatAtoms(RpcClient, atomOptions),
    ...makeLivePresenceAtoms(RpcClient),
  } as const;
};

export * from "./live/LiveSongView.js";
export * from "./live/LivePresenceAtoms.js";
export * from "./microphones/MicrophoneAtoms.js";
export * from "./mixes/MixAtoms.js";
export * from "./profiles/ProfileAtoms.js";
export * from "./react/AsyncResult.js";
export * from "./rpc/errors.js";
export * from "./rpc/LatestSnapshot.js";
export * from "./rpc/Reactivity.js";
export * from "./rpc/RpcClient.js";
export * from "./rpc/Mutation.js";
export * from "./rpc/StreamingRpcOptions.js";
export * from "./shows/ShowAtoms.js";
export * from "./songs/SongAtoms.js";
export * from "./chats/ChatAtoms.js";
