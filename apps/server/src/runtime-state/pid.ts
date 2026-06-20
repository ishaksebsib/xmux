/** PID liveness is used only as a stale-file hint, never as sole ownership proof. */
export const isPidAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause) {
      if (cause.code === "ESRCH") return false;
      if (cause.code === "EPERM") return true;
    }
    return false;
  }
};
