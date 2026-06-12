import type { UserFromGetMe } from "grammy/types";

type Overrides<T> = Partial<T> & Record<string, unknown>;

export function fakeBotInfo(overrides: Partial<UserFromGetMe> = {}): UserFromGetMe {
  return {
    id: 999,
    is_bot: true,
    first_name: "Xmux",
    username: "xmux_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    ...overrides,
  } as UserFromGetMe;
}

export function telegramUser(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    id: 42,
    is_bot: false,
    first_name: "Alice",
    username: "alice",
    ...overrides,
  };
}

export function telegramChat(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    id: 12345,
    type: "private",
    first_name: "Alice",
    username: "alice",
    ...overrides,
  };
}

export function telegramTextMessage(overrides: Overrides<Record<string, unknown>> = {}) {
  const text = typeof overrides.text === "string" ? overrides.text : "hello";
  return {
    message_id: 10,
    date: 1_700_000_000,
    chat: telegramChat(),
    from: telegramUser(),
    text,
    ...overrides,
  };
}

export function telegramDocumentMessage(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    message_id: 11,
    date: 1_700_000_000,
    chat: telegramChat(),
    from: telegramUser(),
    caption: "document caption",
    document: {
      file_id: "doc-file-id",
      file_unique_id: "doc-file-unique-id",
      file_name: "report.pdf",
      mime_type: "application/pdf",
      file_size: 3,
    },
    ...overrides,
  };
}

export function telegramPhotoMessage(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    message_id: 12,
    date: 1_700_000_000,
    chat: telegramChat(),
    from: telegramUser(),
    photo: [
      { file_id: "photo-small", file_unique_id: "photo-small-unique", width: 10, height: 10 },
      { file_id: "photo-large", file_unique_id: "photo-large-unique", width: 100, height: 100 },
    ],
    ...overrides,
  };
}

export function telegramSentMessage(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    message_id: 100,
    date: 1_700_000_000,
    chat: telegramChat(),
    text: "sent",
    ...overrides,
  };
}

export function telegramCallbackQuery(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    id: "callback-1",
    from: telegramUser({ id: 7, first_name: "Bob", username: "bob" }),
    message: telegramSentMessage({ message_id: 123, chat: telegramChat({ id: 12345 }) }),
    data: JSON.stringify({ actionId: "deployment", value: "approve" }),
    chat_instance: "chat-instance-1",
    ...overrides,
  };
}

export function telegramUpdate(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    update_id: 20,
    message: telegramTextMessage(),
    ...overrides,
  };
}

export function telegramFile(overrides: Overrides<Record<string, unknown>> = {}) {
  return {
    file_id: "doc-file-id",
    file_unique_id: "doc-file-unique-id",
    file_size: 3,
    file_path: "documents/report.pdf",
    ...overrides,
  };
}
