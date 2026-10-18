import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Break every reply edge before either parent starts its foreign-key cascades.
  yield* sql`CREATE TRIGGER show_detach_chat_replies BEFORE DELETE ON shows BEGIN
    UPDATE chat_messages SET reply_to_message_id = NULL
      WHERE show_id = OLD.id AND reply_to_message_id IS NOT NULL;
  END`;
  yield* sql`CREATE TRIGGER channel_detach_chat_replies BEFORE DELETE ON chat_channels BEGIN
    UPDATE chat_messages SET reply_to_message_id = NULL
      WHERE channel_id = OLD.id AND reply_to_message_id IS NOT NULL;
  END`;
});
