import { create } from "zustand";

type ModalState = {
  activeModal: string | null;
  payload: unknown;
  openModal: (id: string, payload?: unknown) => void;
  closeModal: () => void;
};

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  payload: null,
  openModal: (id, payload) => set({ activeModal: id, payload }),
  closeModal: () => set({ activeModal: null, payload: null }),
}));
