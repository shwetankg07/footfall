import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../services/api";
import { logout } from "./authSlice";

export const fetchSites = createAsyncThunk("sites/fetch", async () => (await api.get("/api/sites")).sites);

const sitesSlice = createSlice({
  name: "sites",
  initialState: { list: [], status: "idle", error: null },
  reducers: {
    siteChanged: (state, action) => {
      const index = state.list.findIndex((site) => site._id === action.payload._id);
      if (index === -1) state.list.push(action.payload);
      else state.list[index] = { ...state.list[index], ...action.payload };
    },
    siteRemoved: (state, action) => {
      state.list = state.list.filter((site) => site._id !== action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSites.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchSites.fulfilled, (state, action) => {
        state.list = action.payload;
        state.status = "ready";
        state.error = null;
      })
      .addCase(fetchSites.rejected, (state, action) => {
        state.status = "error";
        state.error = action.error.message;
      })
      .addCase(logout.fulfilled, () => ({ list: [], status: "idle", error: null }));
  },
});

export const { siteChanged, siteRemoved } = sitesSlice.actions;
export default sitesSlice.reducer;
