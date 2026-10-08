import { Effect } from "effect";
import { SqlClient } from "effect/sql";

const initial = Effect.fn("ShowtimeMigration0001Initial")(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;

  yield* sql`CREATE TABLE app_settings (
    singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
    connections_enabled INTEGER NOT NULL CHECK (connections_enabled IN (0, 1)),
    host_name TEXT NOT NULL,
    default_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT
  )`;
  yield* sql`CREATE INDEX app_settings_default_profile ON app_settings(default_profile_id)`;

  yield* sql`CREATE TABLE connection_clients (
    client_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    capability TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX connection_clients_profile ON connection_clients(profile_id)`;
  yield* sql`CREATE TABLE connection_client_scopes (
    client_id TEXT NOT NULL REFERENCES connection_clients(client_id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('connections:read', 'connections:create', 'connections:delete')),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (client_id, scope),
    UNIQUE (client_id, position)
  )`;

  yield* sql`CREATE TABLE connection_invitations (
    invitation_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX connection_invitations_profile ON connection_invitations(profile_id)`;
  yield* sql`CREATE INDEX connection_invitations_expiry ON connection_invitations(expires_at)`;
  yield* sql`CREATE TABLE connection_invitation_scopes (
    invitation_id TEXT NOT NULL REFERENCES connection_invitations(invitation_id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('connections:read', 'connections:create', 'connections:delete')),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (invitation_id, scope),
    UNIQUE (invitation_id, position)
  )`;

  yield* sql`CREATE TABLE shows (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX shows_name_id ON shows(name COLLATE NOCASE, id)`;

  yield* sql`CREATE TABLE microphones (
    id TEXT PRIMARY KEY NOT NULL,
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    number TEXT NOT NULL,
    color TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (show_id, position)
  )`;
  yield* sql`CREATE INDEX microphones_show_active_order ON microphones(show_id, deleted_at, position)`;

  yield* sql`CREATE TABLE mixes (
    id TEXT NOT NULL,
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    number TEXT NOT NULL,
    color TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (show_id, id),
    UNIQUE (show_id, position)
  )`;
  yield* sql`CREATE INDEX mixes_show_active_order ON mixes(show_id, deleted_at, position)`;

  yield* sql`CREATE TABLE songs (
    id TEXT PRIMARY KEY NOT NULL,
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    name TEXT NOT NULL,
    artist TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (show_id, position)
  )`;
  yield* sql`CREATE INDEX songs_show_active_order ON songs(show_id, deleted_at, position)`;

  yield* sql`CREATE TABLE song_mix_assignments (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    show_id TEXT NOT NULL,
    mix_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (song_id, mix_id),
    UNIQUE (song_id, position),
    FOREIGN KEY (show_id, mix_id) REFERENCES mixes(show_id, id) ON DELETE CASCADE
  )`;
  yield* sql`CREATE INDEX song_mix_assignments_show_mix ON song_mix_assignments(show_id, mix_id)`;
  yield* sql`CREATE INDEX song_mix_assignments_mix ON song_mix_assignments(mix_id)`;
  yield* sql`CREATE TABLE song_mix_assignment_microphones (
    song_id TEXT NOT NULL,
    mix_id TEXT NOT NULL,
    microphone_id TEXT NOT NULL REFERENCES microphones(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (song_id, mix_id, microphone_id),
    UNIQUE (song_id, mix_id, position),
    FOREIGN KEY (song_id, mix_id) REFERENCES song_mix_assignments(song_id, mix_id) ON DELETE CASCADE
  )`;
  yield* sql`CREATE INDEX song_mix_assignment_microphones_microphone
    ON song_mix_assignment_microphones(microphone_id)`;
  yield* sql`CREATE TABLE song_microphone_names (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    microphone_id TEXT NOT NULL REFERENCES microphones(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (song_id, microphone_id),
    UNIQUE (song_id, position)
  )`;
  yield* sql`CREATE INDEX song_microphone_names_microphone ON song_microphone_names(microphone_id)`;
  yield* sql`CREATE TABLE song_mix_names (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    show_id TEXT NOT NULL,
    mix_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (song_id, mix_id),
    UNIQUE (song_id, position),
    FOREIGN KEY (show_id, mix_id) REFERENCES mixes(show_id, id) ON DELETE CASCADE
  )`;
  yield* sql`CREATE INDEX song_mix_names_show_mix ON song_mix_names(show_id, mix_id)`;

  yield* sql`CREATE TABLE chat_channels (
    id TEXT PRIMARY KEY NOT NULL,
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE (show_id, name)
  )`;
  yield* sql`CREATE INDEX chat_channels_show_created ON chat_channels(show_id, created_at, id)`;
  yield* sql`CREATE TABLE chat_messages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_profile_id TEXT NOT NULL,
    body TEXT NOT NULL,
    parts_json TEXT,
    answer_json TEXT,
    reply_to_message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
    sent_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX chat_messages_channel_sequence ON chat_messages(channel_id, sequence)`;
  yield* sql`CREATE INDEX chat_messages_show_sequence ON chat_messages(show_id, sequence)`;
  yield* sql`CREATE INDEX chat_messages_sender_profile ON chat_messages(sender_profile_id)`;
  yield* sql`CREATE INDEX chat_messages_reply ON chat_messages(reply_to_message_id)`;
  yield* sql`CREATE TABLE chat_profile_channel_state (
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
    notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1)),
    PRIMARY KEY (show_id, channel_id, profile_id)
  )`;
  yield* sql`CREATE INDEX chat_profile_channel_state_channel ON chat_profile_channel_state(channel_id)`;
  yield* sql`CREATE INDEX chat_profile_channel_state_profile ON chat_profile_channel_state(profile_id)`;
  yield* sql`CREATE TABLE chat_presets (
    id TEXT PRIMARY KEY NOT NULL,
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    template TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    answer_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (show_id, name)
  )`;
  yield* sql`CREATE INDEX chat_presets_show_updated ON chat_presets(show_id, updated_at DESC)`;
});

export default initial();
