import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../services/api";
import { logout } from "./authSlice";

export const fetchAlerts = createAsyncThunk("alerts/fetch", async () => api.get("/api/alerts"));
export const markAlertRead = createAsyncThunk("alerts/read", async (id) => {
  await api.post(`/api/alerts/${id}/read`);
  return id;
});
export const markAllAlertsRead = createAsyncThunk("alerts/readAll", async () => api.post("/api/alerts/read-all"));

const alertsSlice = createSlice({
  name: "alerts",
  initialState: { items: [], unread: 0 },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAlerts.fulfilled, (state, action) => {
        state.items = action.payload.alerts;
        state.unread = action.payload.unread;
      })
      .addCase(markAlertRead.fulfilled, (state, action) => {
        const alert = state.items.find((item) => item._id === action.payload);
        if (alert && !alert.read) {
          alert.read = true;
          state.unread = Math.max(0, state.unread - 1);
        }
      })
      .addCase(markAllAlertsRead.fulfilled, (state) => {
        state.items.forEach((item) => {
          item.read = true;
        });
        state.unread = 0;
      })
      .addCase(logout.fulfilled, () => ({ items: [], unread: 0 }));
  },
});

export default alertsSlice.reducer;
