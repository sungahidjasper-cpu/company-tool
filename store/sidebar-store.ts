import { create } from "zustand";

type SidebarState = {
  isCollapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
};

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: false,
  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
  toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
}));
