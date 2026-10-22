import { createContext, useContext } from "react";

const SessionContext = createContext({ user: null });

export function SessionProvider({ user, children }) {
  return <SessionContext.Provider value={{ user, isAdmin: Boolean(user?.is_admin) }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
