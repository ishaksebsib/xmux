import { Result } from "../../src";
import {
  createInMemoryStore,
  type ChatThreadRef,
  type Store,
  type ThreadBinding,
} from "../../src/store";

/**
 * Test-only adapter that simulates legacy/corrupt persisted routing rows.
 * Public store implementations must still reject creating dangling bindings.
 */
export function createStoreWithDanglingBindings(bindings: ReadonlyArray<ThreadBinding>): Store {
  const base = createInMemoryStore();
  const dangling = new Map(
    bindings.map((binding) => [threadKey(binding.thread), cloneBinding(binding)]),
  );

  return {
    ...base,
    threadBindings: {
      async bind(binding) {
        return base.threadBindings.bind(binding);
      },

      async get(thread) {
        const binding = dangling.get(threadKey(thread));
        return binding === undefined
          ? base.threadBindings.get(thread)
          : Result.ok(cloneBinding(binding));
      },

      async delete(thread) {
        dangling.delete(threadKey(thread));
        return base.threadBindings.delete(thread);
      },

      async deleteBySession(ref) {
        for (const [key, binding] of dangling) {
          if (
            binding.sessionRef.harnessId === ref.harnessId &&
            binding.sessionRef.sessionId === ref.sessionId
          ) {
            dangling.delete(key);
          }
        }

        return base.threadBindings.deleteBySession(ref);
      },
    },
  };
}

function threadKey(thread: ChatThreadRef): string {
  return `${thread.chatId}:${thread.threadId}`;
}

function cloneBinding(binding: ThreadBinding): ThreadBinding {
  return {
    ...binding,
    thread: { ...binding.thread },
    sessionRef: { ...binding.sessionRef },
  };
}
