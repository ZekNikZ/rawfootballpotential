import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface TitleStore {
  override: string | null;
  setOverride: (title: string | null) => void;
}

const PageTitleContext = createContext<TitleStore>({ override: null, setOverride: () => {} });

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<string | null>(null);
  return <PageTitleContext value={{ override, setOverride }}>{children}</PageTitleContext>;
}

export const usePageTitleOverride = () => useContext(PageTitleContext).override;

/** Pages whose title depends on loaded data (a franchise profile) refine the route's title with this. */
export function usePageTitle(title: string | null) {
  const { setOverride } = useContext(PageTitleContext);
  useEffect(() => {
    setOverride(title);
    return () => setOverride(null);
  }, [title, setOverride]);
}
