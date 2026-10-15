import mongoose from "mongoose";
import { Server } from "socket.io";
import Site from "./models/site.model.js";
import { userFromToken } from "./middlewares/auth.middleware.js";
import { roleOf } from "./middlewares/site.middleware.js";
import { liveCount, onLiveChange } from "./utils/live.js";

let io = null;

export const emitToSite = (siteId, event, data) => io?.to(`site:${siteId}`).emit(event, data);
export const emitToUser = (userId, event, data) => io?.to(`user:${userId}`).emit(event, data);

const tokenFromCookie = (header = "") => {
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith("token="));
  return pair ? decodeURIComponent(pair.slice("token=".length)) : null;
};

const siteForWatcher = async (user, { siteId, shareToken } = {}) => {
  if (typeof shareToken === "string" && shareToken) {
    return Site.findOne({ shareToken });
  }
  if (!user || !mongoose.isValidObjectId(siteId)) return null;
  const site = await Site.findById(siteId);
  return site && roleOf(site, user._id) ? site : null;
};

export const initSocket = (server, origins) => {
  io = new Server(server, { cors: { origin: origins, credentials: true } });

  // Logged-out sockets are allowed: people opening a public share link watch the live count too.
  io.use(async (socket, next) => {
    socket.data.user = await userFromToken(tokenFromCookie(socket.handshake.headers.cookie));
    next();
  });

  io.on("connection", (socket) => {
    const { user } = socket.data;
    if (user) socket.join(`user:${user._id}`);

    // A dashboard tab watches one site at a time.
    socket.on("watch", async (payload, ack) => {
      try {
        const site = await siteForWatcher(user, payload);
        if (!site) return ack?.({ ok: false });
        for (const room of socket.rooms) {
          if (room.startsWith("site:")) socket.leave(room);
        }
        socket.join(`site:${site._id}`);
        ack?.({ ok: true, live: liveCount(site._id) });
      } catch (error) {
        console.error(error);
        ack?.({ ok: false });
      }
    });
  });

  onLiveChange((siteId, count) => emitToSite(siteId, "live", { siteId, count }));
};
