import { io } from "socket.io-client";
import { API_URL } from "./api";

// One connection for the whole app. The auth cookie rides along with the handshake.
export const socket = io(API_URL, { withCredentials: true, autoConnect: false, transports: ["websocket", "polling"] });

export const reconnectSocket = () => {
  socket.disconnect();
  socket.connect();
};
