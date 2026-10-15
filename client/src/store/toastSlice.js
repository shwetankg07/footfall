import { createSlice } from "@reduxjs/toolkit";

let nextId = 1;

const toastSlice = createSlice({
  name: "toasts",
  initialState: [],
  reducers: {
    addToast: {
      reducer: (state, action) => {
        state.push(action.payload);
      },
      prepare: (message, tone = "info") => ({ payload: { id: nextId++, message, tone } }),
    },
    removeToast: (state, action) => state.filter((toast) => toast.id !== action.payload),
  },
});

export const { addToast, removeToast } = toastSlice.actions;
export default toastSlice.reducer;
