import { configureStore } from "@reduxjs/toolkit";
import auth from "./authSlice";
import sites from "./sitesSlice";
import alerts from "./alertsSlice";
import toasts from "./toastSlice";

export const store = configureStore({ reducer: { auth, sites, alerts, toasts } });
