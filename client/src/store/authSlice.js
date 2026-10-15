import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../services/api";
import { reconnectSocket, socket } from "../services/socket";

export const fetchMe = createAsyncThunk("auth/me", async () => {
  try {
    return (await api.get("/api/auth/me")).user;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
});

export const login = createAsyncThunk("auth/login", async (form, { rejectWithValue }) => {
  try {
    return (await api.post("/api/auth/login", form)).user;
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const register = createAsyncThunk("auth/register", async (form, { rejectWithValue }) => {
  try {
    return (await api.post("/api/auth/register", form)).user;
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const logout = createAsyncThunk("auth/logout", async () => {
  await api.post("/api/auth/logout");
  socket.disconnect();
});

const signedIn = (state, action) => {
  state.user = action.payload;
  state.status = "ready";
  // The socket authenticates once, at connect, so reconnect with the new cookie.
  if (action.payload) reconnectSocket();
};

const authSlice = createSlice({
  name: "auth",
  initialState: { user: null, status: "loading" },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMe.fulfilled, signedIn)
      .addCase(fetchMe.rejected, (state) => {
        state.status = "offline";
      })
      .addCase(login.fulfilled, signedIn)
      .addCase(register.fulfilled, signedIn)
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
      });
  },
});

export default authSlice.reducer;
