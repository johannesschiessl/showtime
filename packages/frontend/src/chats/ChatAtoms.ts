import { Atom } from "effect/reactivity";
import type { ProfileId, ShowId } from "@showtime/contracts";
import type { ShowtimeRpcClient } from "../rpc/RpcClient.js";
import { latestSnapshot } from "../rpc/LatestSnapshot.js";
import type { StreamingRpcOptions } from "../rpc/StreamingRpcOptions.js";

export const makeChatAtoms = (RpcClient: ShowtimeRpcClient, options?: StreamingRpcOptions) => {
  const createChannel = RpcClient.mutation("chats.createChannel");
  const renameChannel = RpcClient.mutation("chats.renameChannel");
  const deleteChannel = RpcClient.mutation("chats.deleteChannel");
  const send = RpcClient.mutation("chats.send");
  const createPreset = RpcClient.mutation("chats.createPreset");
  const updatePreset = RpcClient.mutation("chats.updatePreset");
  const deletePreset = RpcClient.mutation("chats.deletePreset");
  const markRead = RpcClient.mutation("chats.markRead");
  const setNotifications = RpcClient.mutation("chats.setNotifications");
  const byShow = Atom.family((showId: ShowId) =>
    Atom.family((profileId: ProfileId) => ({
      state: latestSnapshot(RpcClient.query("chats.state", { showId, profileId }), options),
      createChannel,
      renameChannel,
      deleteChannel,
      send,
      createPreset,
      updatePreset,
      deletePreset,
      markRead,
      setNotifications,
    })),
  );
  const chatAtoms = (showId: ShowId, profileId: ProfileId) => byShow(showId)(profileId);
  return { chatAtoms } as const;
};
