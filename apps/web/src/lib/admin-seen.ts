const KEY = "rfp-admin-seen";

/** Whether this browser has signed in to the admin before (a convenience for the nav link, not a security check). */
export function adminSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markAdminSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // storage blocked: the link just does not appear
  }
}
